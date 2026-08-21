import { desktop } from '../desktop';
import { readMeta, writeMeta, clearMeta } from '../db';
import { DRIVE_SCOPE } from './drive';

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
  /** Google issues one for desktop clients; it is not treated as confidential. */
  desktopClientSecret: string;
  autoSync: boolean;
}

export const DEFAULT_SETTINGS: GoogleSettings = {
  webClientId: '',
  desktopClientId: '',
  desktopClientSecret: '',
  autoSync: true,
};

const SETTINGS_KEY = 'google-settings';

export async function readSettings(): Promise<GoogleSettings> {
  const stored = await readMeta<Partial<GoogleSettings>>(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...stored };
}

export async function writeSettings(settings: GoogleSettings): Promise<void> {
  await writeMeta(SETTINGS_KEY, settings);
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
        callback: (response: { access_token?: string; expires_in?: number; error?: string }) => void;
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
          scope: DRIVE_SCOPE,
          callback: (response) => {
            if (response.error || !response.access_token) {
              reject(new Error(response.error ?? 'Google did not return a token.'));
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

export interface ConnectionStatus {
  connected: boolean;
  /** Set when the platform has no client ID configured yet. */
  needsSetup: boolean;
}

export async function connectionStatus(): Promise<ConnectionStatus> {
  const settings = await readSettings();
  if (desktop) {
    const status = await desktop.google.status();
    return { connected: status.connected, needsSetup: !settings.desktopClientId };
  }
  return { connected: webToken !== null, needsSetup: !settings.webClientId };
}

/** Opens the consent screen. Resolves once the account is connected. */
export async function connect(): Promise<void> {
  const settings = await readSettings();
  if (desktop) {
    if (!settings.desktopClientId) throw new Error('Add a desktop client ID first.');
    await desktop.google.authorize({
      clientId: settings.desktopClientId,
      clientSecret: settings.desktopClientSecret,
      scope: DRIVE_SCOPE,
    });
    return;
  }
  if (!settings.webClientId) throw new Error('Add a web client ID first.');
  // 'consent' the first time so the user sees exactly what is being granted.
  await requestWebToken(settings.webClientId, 'consent');
}

/** Abandons a consent flow that is still waiting on the browser. */
export async function cancelConnect(): Promise<void> {
  if (desktop) await desktop.google.cancel();
}

export async function disconnect(): Promise<void> {
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
    if (!token) throw new Error('Not connected to Google Drive.');
    return token;
  }
  if (webToken && webToken.expiresAt - 60_000 > Date.now()) return webToken.value;

  const settings = await readSettings();
  if (!settings.webClientId) throw new Error('Not connected to Google Drive.');
  return requestWebToken(settings.webClientId, '');
}

export async function forgetFolder(): Promise<void> {
  await clearMeta('drive-folder-id');
}
