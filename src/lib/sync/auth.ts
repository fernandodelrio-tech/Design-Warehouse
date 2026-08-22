import { clearMeta } from '../db';
import {
  assertClientNotShared,
  bindClientId,
  currentAccount,
  setCurrentAccount,
} from '../accounts';
import type { Account } from '../accounts';
import { AUTH_SCOPES, DRIVE_SCOPE } from './drive';

/**
 * Google lets people approve scopes individually, and the Drive checkbox is not
 * ticked by default. Sign-in then succeeds with identity alone and the first
 * Drive call fails with "insufficient authentication scopes", which says
 * nothing about what to do. Checking the granted scopes here turns that into an
 * error naming the box that needs ticking.
 */
class MissingDriveScopeError extends Error {
  constructor() {
    super(
      'Signed in, but Drive access was not granted. Google asks for it as a separate ' +
        'tick box on the consent screen — sign in again and allow the app to see and ' +
        'manage the files it creates in your Drive.',
    );
    this.name = 'MissingDriveScopeError';
  }
}

/**
 * Google's token client asks for consent in a POPUP WINDOW, and a browser only
 * opens one for a page that a person has just interacted with. Every failure to
 * meet that rule arrives as the same unhelpful string — "Failed to open popup
 * window" — which reads as a bug in the app rather than as a blocked window.
 */
class PopupBlockedError extends Error {
  constructor() {
    super(
      'The browser blocked Google\u2019s sign-in window. Allow pop-ups for this site, then ' +
        'press Sync now \u2014 Google can only ask for access from a window opened by a click.',
    );
    this.name = 'PopupBlockedError';
  }
}

/**
 * Raised instead of opening a popup that cannot be opened.
 *
 * Access tokens live for about an hour and are held in memory only; there is no
 * refresh token to renew them with, because renewing one needs a client secret
 * and there is no server here to keep it in. Renewal therefore means asking
 * Google again, which means a popup, which means a click. A sync that no one
 * clicked cannot have one, so it says so rather than firing a window the
 * browser will block.
 */
export class NeedsSignInError extends Error {
  constructor() {
    super('Google access has expired. Press Sync now to renew it.');
    this.name = 'NeedsSignInError';
  }
}

function grantsDrive(granted: string | undefined): boolean {
  return (granted ?? '').split(/\s+/).includes(DRIVE_SCOPE);
}

/**
 * Signing in to Google from the browser.
 *
 * The app has no server, so there is nowhere to keep a client secret and
 * nothing to receive a redirect. Google Identity Services covers exactly that
 * case: it hands back a short-lived access token, held in memory only, from a
 * "Web application" client that needs no secret at all.
 */

export interface GoogleSettings {
  /** "Web application" client from your own Google Cloud project. */
  webClientId: string;
  autoSync: boolean;
  /** Delete this device's copy of the catalog when signing out. */
  forgetOnSignOut: boolean;
}

export const DEFAULT_SETTINGS: GoogleSettings = {
  webClientId: '',
  autoSync: true,
  forgetOnSignOut: false,
};

const SETTINGS_KEY = 'dw-google-settings';

/**
 * Settings live in localStorage, not in the catalog database.
 *
 * They describe this device — which OAuth client it uses, whether it syncs —
 * not the catalog. Held per catalog, the client ID typed while signed out would
 * vanish the moment signing in swapped the database underneath it.
 */
export async function readSettings(): Promise<GoogleSettings> {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return { ...DEFAULT_SETTINGS, ...(raw ? (JSON.parse(raw) as Partial<GoogleSettings>) : {}) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function writeSettings(settings: GoogleSettings): Promise<void> {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Private browsing or a full quota; the session keeps working regardless.
  }
}

// --- browser: Google Identity Services ------------------------------------

interface TokenClient {
  requestAccessToken(options?: { prompt?: string }): void;
}

interface GoogleIdentity {
  accounts: {
    oauth2: {
      initTokenClient(config: {
        client_id: string;
        scope: string;
        prompt?: string;
        callback: (response: {
          access_token?: string;
          expires_in?: number;
          /** Space-delimited list of the scopes actually granted. */
          scope?: string;
          error?: string;
        }) => void;
        error_callback?: (error: { type?: string; message?: string }) => void;
      }): TokenClient;
      revoke(token: string, done: () => void): void;
    };
  };
}

declare global {
  interface Window {
    google?: GoogleIdentity;
  }
}

const GIS_SRC = 'https://accounts.google.com/gsi/client';
let gisLoading: Promise<GoogleIdentity> | null = null;

function loadIdentityServices(): Promise<GoogleIdentity> {
  if (window.google?.accounts?.oauth2) return Promise.resolve(window.google);
  if (gisLoading) return gisLoading;

  const loading = new Promise<GoogleIdentity>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = GIS_SRC;
    script.async = true;
    script.onload = () =>
      window.google?.accounts?.oauth2
        ? resolve(window.google)
        : reject(new Error('Google sign-in loaded but did not initialise.'));
    script.onerror = () =>
      reject(new Error('Could not reach Google sign-in. Check the network and try again.'));
    document.head.appendChild(script);
  }).catch((error: unknown) => {
    // Let a later attempt retry rather than caching the failure forever.
    gisLoading = null;
    throw error;
  });
  gisLoading = loading;
  return loading;
}

/**
 * Fetches Google's script ahead of the click that needs it.
 *
 * Loading it inside the click is what broke: the script comes over the network,
 * and by the time it arrives the browser no longer counts the page as one the
 * person just interacted with, so the popup it then opens is blocked. Called at
 * launch, the script is already there and the popup opens in the same breath as
 * the click. Failure here is not worth reporting — the sign-in path reports it
 * properly, and there may be nothing to sign in to.
 */
export function warmUpAuth(): void {
  void readSettings().then((settings) => {
    if (settings.webClientId) void loadIdentityServices().catch(() => undefined);
  });
}

/** Browser tokens are short-lived and held in memory only. */
let webToken: { value: string; expiresAt: number } | null = null;

/** Whether a token is in hand, so a sync can run without asking for one. */
export function hasFreshToken(): boolean {
  return webToken !== null && webToken.expiresAt - 60_000 > Date.now();
}

function requestWebToken(clientId: string, prompt: string): Promise<string> {
  return loadIdentityServices().then(
    (google) =>
      new Promise<string>((resolve, reject) => {
        const client = google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: AUTH_SCOPES,
          callback: (response) => {
            if (response.error || !response.access_token) {
              reject(new Error(response.error ?? 'Google did not return a token.'));
              return;
            }
            if (!grantsDrive(response.scope)) {
              reject(new MissingDriveScopeError());
              return;
            }
            webToken = {
              value: response.access_token,
              expiresAt: Date.now() + (response.expires_in ?? 3600) * 1000,
            };
            resolve(response.access_token);
          },
          error_callback: (error) =>
            reject(
              error.type === 'popup_failed_to_open'
                ? new PopupBlockedError()
                : new Error(
                    error.type === 'popup_closed'
                      ? 'Google\u2019s sign-in window was closed before access was granted.'
                      : (error.message ?? 'Google sign-in was dismissed.'),
                  ),
            ),
        });
        client.requestAccessToken({ prompt });
      }),
  );
}

// --- shared surface --------------------------------------------------------

const USERINFO = 'https://www.googleapis.com/oauth2/v3/userinfo';

/** Reads the signed-in identity from an access token. */
async function fetchProfile(token: string): Promise<Omit<Account, 'clientId'>> {
  const response = await fetch(USERINFO, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) {
    throw new Error('Signed in, but Google would not say which account it was.');
  }
  const info = (await response.json()) as {
    sub?: string;
    email?: string;
    name?: string;
    picture?: string;
  };
  if (!info.sub) throw new Error('Google returned no account id.');
  return {
    sub: info.sub,
    email: info.email ?? '',
    name: info.name ?? info.email ?? '',
    picture: info.picture ?? '',
  };
}

export interface ConnectionStatus {
  connected: boolean;
  /** Set when the platform has no client ID configured yet. */
  needsSetup: boolean;
  account: Account | null;
}

export async function connectionStatus(): Promise<ConnectionStatus> {
  const settings = await readSettings();
  const account = currentAccount();
  // In a browser the token lives in memory, so there is none at launch even
  // though the account is still signed in. Identity and "has a usable token
  // right now" are different questions, and only the second gates syncing.
  return {
    connected: hasFreshToken() && account !== null,
    needsSetup: !settings.webClientId,
    account,
  };
}

/**
 * Signs in with Google. Resolves with the account once consent is granted.
 *
 * The client ID is claimed for that account: a different person signing in on
 * this device has to bring their own, rather than reusing the first person's.
 */
export async function connect(): Promise<Account> {
  const settings = await readSettings();
  const clientId = settings.webClientId;
  if (!clientId) throw new Error('Add a web client ID first.');
  // 'consent' the first time so the user sees exactly what is being granted.
  const token = await requestWebToken(clientId, 'consent');
  const profile = await fetchProfile(token);
  try {
    assertClientNotShared(clientId, profile.sub);
  } catch (error) {
    webToken = null;
    throw error;
  }
  const account: Account = { ...profile, clientId };
  bindClientId(clientId, account.sub);
  setCurrentAccount(account);
  return account;
}

export async function disconnect(): Promise<void> {
  setCurrentAccount(null);
  const token = webToken?.value;
  webToken = null;
  if (token && window.google?.accounts?.oauth2) {
    await new Promise<void>((resolve) => window.google!.accounts.oauth2.revoke(token, resolve));
  }
}

/**
 * A valid access token for Drive. Asks Google for a fresh one without
 * prompting, which works for as long as the Google session lasts.
 */
export async function accessToken(interactive = true): Promise<string> {
  if (hasFreshToken()) return webToken!.value;
  if (!interactive) throw new NeedsSignInError();

  const account = currentAccount();
  /*
     Nothing is awaited before the popup where it can be helped. A browser
     allows a popup only for a short window after a click, and every await
     between the click and the request spends part of it; reading the settings
     is only needed when there is no account to take the client ID from.
  */
  const clientId = account?.clientId || (await readSettings()).webClientId;
  if (!clientId) throw new Error('Not signed in to Google.');
  let token: string;
  try {
    token = await requestWebToken(clientId, '');
  } catch (error) {
    // A silent renewal returns only what was granted before, so a missing Drive
    // scope has to be asked for explicitly rather than retried quietly.
    if (error instanceof MissingDriveScopeError) token = await requestWebToken(clientId, 'consent');
    else throw error;
  }

  // A silent renewal can come back for a different Google account if the
  // browser session changed underneath us; that must not write into this
  // catalog or this Drive folder.
  if (account) {
    const profile = await fetchProfile(token);
    if (profile.sub !== account.sub) {
      webToken = null;
      throw new Error(
        `The Google session is now ${profile.email || 'a different account'}. Sign in again.`,
      );
    }
  }
  return token;
}

export async function forgetFolder(): Promise<void> {
  await clearMeta('drive-folder-id');
}
