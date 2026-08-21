import { desktop } from '../desktop';
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

function grantsDrive(granted: string | undefined): boolean {
  return (granted ?? '').split(/\s+/).includes(DRIVE_SCOPE);
}

/**
 * Signing in to Google, by whichever route the platform allows.
 *
 * The desktop app uses a loopback redirect handled in the main process, which
 * is the flow Google requires for installed apps. The browser build cannot
 * listen on a port, so it uses Google Identity Services, which hands back a
 * short-lived access token and no secret at all.
 *
 * The two need different OAuth client types, so they are configured separately.
 */

export interface GoogleSettings {
  /** "Web application" client for the browser build. */
  webClientId: string;
  /** "Desktop app" client for the packaged app. */
  desktopClientId: string;
  autoSync: boolean;
  /** Delete this device's copy of the catalog when signing out. */
  forgetOnSignOut: boolean;
}

export const DEFAULT_SETTINGS: GoogleSettings = {
  webClientId: '',
  desktopClientId: '',
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

/** Browser tokens are short-lived and held in memory only. */
let webToken: { value: string; expiresAt: number } | null = null;

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
            reject(new Error(error.message ?? 'Google sign-in was dismissed.')),
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
  let account = currentAccount();
  if (desktop) {
    const status = await desktop.google.status();
    // The grant lives in the main process and the account in localStorage; if
    // the latter is lost, recover it from the former rather than showing a
    // signed-out app that still holds a live Google session.
    if (status.connected && status.profile && !account) {
      account = { ...status.profile, clientId: status.clientId };
      setCurrentAccount(account);
    }
    if (!status.connected && account) {
      setCurrentAccount(null);
      account = null;
    }
    return {
      connected: status.connected && account !== null,
      needsSetup: !settings.desktopClientId,
      account,
    };
  }
  // In a browser the token lives in memory, so there is none at launch even
  // though the account is still signed in. Identity and "has a usable token
  // right now" are different questions, and only the second gates syncing.
  return {
    connected: webToken !== null && account !== null,
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

  if (desktop) {
    const clientId = settings.desktopClientId;
    if (!clientId) throw new Error('Add a desktop client ID first.');
    // No secret passed: the main process holds it and never gives it back.
    const result = await desktop.google.authorize({ clientId, scope: AUTH_SCOPES });
    if (!result.profile) throw new Error('Google did not return an account.');
    // Checked after consent because the account is only known once it is given;
    // the grant is dropped again immediately if the client is someone else's.
    try {
      assertClientNotShared(clientId, result.profile.sub);
    } catch (error) {
      await desktop.google.disconnect();
      throw error;
    }
    const account: Account = { ...result.profile, clientId };
    bindClientId(clientId, account.sub);
    setCurrentAccount(account);
    return account;
  }

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

/** Abandons a consent flow that is still waiting on the browser. */
export async function cancelConnect(): Promise<void> {
  if (desktop) await desktop.google.cancel();
}

export async function disconnect(): Promise<void> {
  setCurrentAccount(null);
  if (desktop) {
    await desktop.google.disconnect();
    return;
  }
  const token = webToken?.value;
  webToken = null;
  if (token && window.google?.accounts?.oauth2) {
    await new Promise<void>((resolve) => window.google!.accounts.oauth2.revoke(token, resolve));
  }
}

/**
 * A valid access token for Drive. On the desktop this refreshes silently from
 * the stored grant; in a browser it asks Google for a fresh one without
 * prompting, which works for as long as the Google session lasts.
 */
export async function accessToken(): Promise<string> {
  if (desktop) {
    const token = await desktop.google.token();
    if (!token) throw new Error('Not signed in to Google.');
    // Guard the same way as the browser: never write into one account's Drive
    // with another account's token.
    const account = currentAccount();
    const status = await desktop.google.status();
    if (account && status.profile && status.profile.sub !== account.sub) {
      throw new Error(
        `The stored Google session is ${status.profile.email || 'a different account'}. Sign in again.`,
      );
    }
    return token;
  }
  if (webToken && webToken.expiresAt - 60_000 > Date.now()) return webToken.value;

  const account = currentAccount();
  const settings = await readSettings();
  const clientId = account?.clientId || settings.webClientId;
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
