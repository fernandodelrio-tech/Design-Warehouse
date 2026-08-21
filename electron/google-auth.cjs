'use strict';

/**
 * Google OAuth for the packaged app, using the loopback flow.
 *
 * All of it runs in the main process: the renderer is sandboxed and never sees
 * the client secret or the refresh token, only a short-lived access token. The
 * consent screen opens in the user's real browser rather than an embedded
 * window, which is both what Google requires and what lets them see the URL
 * they are trusting.
 */

const { app, safeStorage, shell } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
const USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v3/userinfo';
const TIMEOUT_MS = 5 * 60 * 1000;
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

/**
 * The refresh token is held in the OS keychain — DPAPI on Windows, Keychain on
 * macOS, libsecret on Linux — rather than as readable JSON. File permissions
 * alone would leave it in the clear to anything running as this user.
 */
const encryptedFile = () => path.join(app.getPath('userData'), 'google-auth.bin');
const legacyFile = () => path.join(app.getPath('userData'), 'google-auth.json');

function encryptionAvailable() {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    // Called before the app is ready, or no keyring on this system.
    return false;
  }
}

function readStore() {
  if (encryptionAvailable()) {
    try {
      const decrypted = safeStorage.decryptString(fs.readFileSync(encryptedFile()));
      return JSON.parse(decrypted);
    } catch {
      // Not written yet, or written by a different OS user or machine, in
      // which case it is unreadable here and a fresh sign-in is the fix.
    }
  }
  // A store from before this was encrypted, or a system with no keyring.
  let legacy = null;
  try {
    legacy = JSON.parse(fs.readFileSync(legacyFile(), 'utf8'));
  } catch {
    return null;
  }

  // Re-home it into the keychain and take the plaintext off disk. Deliberately
  // not by re-reading afterwards: if the keyring reports itself available but
  // then fails to encrypt, writeStore falls back to the same legacy file and a
  // recursive read would loop forever. The value is already in hand.
  if (legacy && encryptionAvailable()) writeStore(legacy);
  return legacy;
}

function removeQuietly(file) {
  try {
    fs.unlinkSync(file);
  } catch {
    // Not there. Nothing to remove.
  }
}

function writeStore(value) {
  if (value === null) {
    removeQuietly(encryptedFile());
    removeQuietly(legacyFile());
    return;
  }

  if (encryptionAvailable()) {
    try {
      fs.writeFileSync(encryptedFile(), safeStorage.encryptString(JSON.stringify(value)), {
        mode: 0o600,
      });
      // Never leave the old readable copy behind once an encrypted one exists.
      removeQuietly(legacyFile());
      return;
    } catch {
      // A keyring that reports itself available can still fail to serve a key —
      // a locked login keyring, say. Falling back beats refusing to sign in.
    }
  }

  // No keyring, or it would not encrypt. Say so through status() so the app can
  // be honest about it rather than implying protection it does not have.
  fs.writeFileSync(legacyFile(), JSON.stringify(value), { mode: 0o600 });
  removeQuietly(encryptedFile());
}

const base64url = (buffer) => buffer.toString('base64url');

function closingPage(message) {
  return `<!doctype html><meta charset="utf-8"><title>Design Warehouse</title>
<body style="font-family:system-ui;background:#0b0d12;color:#e8ecf5;display:grid;place-items:center;height:100vh;margin:0">
<div style="text-align:center"><h1 style="font-size:18px;margin:0 0 8px">${message}</h1>
<p style="color:#99a3b8;margin:0">You can close this tab and go back to Design Warehouse.</p></div>`;
}

/** Lets the renderer abandon a consent flow the user walked away from. */
let pendingFlow = null;

function cancel() {
  if (pendingFlow) {
    pendingFlow.abort(new Error('Sign-in was cancelled.'));
    pendingFlow = null;
  }
  return { cancelled: true };
}

/**
 * Records the OAuth client for this device, without a sign-in.
 *
 * The secret goes straight into the keychain store and is never handed back;
 * the renderer can ask whether one is set, not what it is.
 */
function setCredentials({ clientId, clientSecret }) {
  const store = readStore() ?? {};
  writeStore({
    ...store,
    clientId: clientId ?? store.clientId ?? '',
    clientSecret: clientSecret ?? store.clientSecret ?? '',
  });
  return { ok: true };
}

/** Runs the consent flow and stores the refresh token. */
async function authorize({ clientId, clientSecret, scope }) {
  const saved = readStore() ?? {};
  clientId = clientId || saved.clientId;
  // Prefer the stored secret so the renderer never has to hold one.
  clientSecret = clientSecret || saved.clientSecret || '';
  if (!clientId) throw new Error('A Google client ID is required.');
  // Only one consent flow at a time; a second would strand the first server.
  cancel();

  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  const state = base64url(crypto.randomBytes(16));

  const server = http.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  const redirectUri = `http://127.0.0.1:${port}`;

  const pending = new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Timed out waiting for Google. Try connecting again.')),
      TIMEOUT_MS,
    );
    pendingFlow = {
      abort: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    };
    server.on('request', (request, response) => {
      const url = new URL(request.url, redirectUri);
      const params = url.searchParams;
      const finish = (body) => {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end(body);
      };

      if (params.get('error')) {
        finish(closingPage('Access was not granted.'));
        clearTimeout(timer);
        reject(new Error(`Google returned "${params.get('error')}".`));
        return;
      }
      if (!params.get('code')) {
        finish(closingPage('Waiting for Google…'));
        return;
      }
      // The state check is what stops another page on this machine from
      // feeding us a code of its own.
      if (params.get('state') !== state) {
        finish(closingPage('That response did not match this request.'));
        clearTimeout(timer);
        reject(new Error('The response from Google did not match this request.'));
        return;
      }
      finish(closingPage('Design Warehouse is connected.'));
      clearTimeout(timer);
      resolve(params.get('code'));
    });
  });

  const authUrl = new URL(AUTH_ENDPOINT);
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', scope);
  authUrl.searchParams.set('code_challenge', challenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('state', state);
  // Without these Google hands back no refresh token on a repeat consent, and
  // the connection would quietly stop working an hour later.
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent');

  await shell.openExternal(authUrl.toString());

  let code;
  try {
    code = await pending;
  } finally {
    pendingFlow = null;
    server.close();
  }

  const body = new URLSearchParams({
    code,
    client_id: clientId,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
    code_verifier: verifier,
  });
  if (clientSecret) body.set('client_secret', clientSecret);

  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const tokens = await response.json();
  if (!response.ok) {
    throw new Error(tokens.error_description || tokens.error || 'Google rejected the sign-in.');
  }
  if (!tokens.refresh_token) {
    throw new Error('Google did not return a refresh token; try removing the app under your Google account permissions and connecting again.');
  }

  // Google grants scopes individually, and the Drive tick box is not on by
  // default. Catch a short grant here rather than letting the first sync fail
  // with "insufficient authentication scopes", which explains nothing.
  const granted = String(tokens.scope || '').split(/\s+/);
  if (!granted.includes(DRIVE_SCOPE)) {
    throw new Error(
      'Signed in, but Drive access was not granted. Google asks for it as a separate ' +
        'tick box on the consent screen — connect again and allow the app to see and ' +
        'manage the files it creates in your Drive.',
    );
  }

  const profile = await fetchProfile(tokens.access_token);

  writeStore({
    clientId,
    clientSecret: clientSecret || '',
    refreshToken: tokens.refresh_token,
    accessToken: tokens.access_token,
    expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
    profile,
  });
  return { connected: true, profile };
}

/** Who signed in. `sub` is Google's stable id for the account. */
async function fetchProfile(accessToken) {
  const response = await fetch(USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error('Signed in, but Google would not say which account it was.');
  }
  const info = await response.json();
  if (!info.sub) throw new Error('Google returned no account id.');
  return {
    sub: info.sub,
    email: info.email ?? '',
    name: info.name ?? info.email ?? '',
    picture: info.picture ?? '',
  };
}

/** A valid access token, refreshed when the stored one is close to expiring. */
async function accessToken() {
  const store = readStore();
  if (!store?.refreshToken) return null;
  if (store.accessToken && store.expiresAt - 60_000 > Date.now()) return store.accessToken;

  const body = new URLSearchParams({
    client_id: store.clientId,
    refresh_token: store.refreshToken,
    grant_type: 'refresh_token',
  });
  if (store.clientSecret) body.set('client_secret', store.clientSecret);

  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const tokens = await response.json();
  if (!response.ok) {
    // A revoked or expired grant cannot be recovered from; clear it so the UI
    // asks to reconnect rather than retrying forever.
    if (tokens.error === 'invalid_grant') writeStore(null);
    throw new Error(tokens.error_description || tokens.error || 'Could not refresh the Google session.');
  }

  writeStore({
    ...store,
    accessToken: tokens.access_token,
    expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
  });
  return tokens.access_token;
}

async function disconnect() {
  const store = readStore();
  if (store?.refreshToken) {
    try {
      await fetch(REVOKE_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: store.refreshToken }),
      });
    } catch {
      // Offline, or already revoked. Dropping the local copy is what matters.
    }
  }
  writeStore(null);
  return { connected: false };
}

function status() {
  const store = readStore();
  return {
    connected: !!store?.refreshToken,
    clientId: store?.clientId ?? '',
    /** Whether a client secret is on file — never the secret itself. */
    hasSecret: !!store?.clientSecret,
    profile: store?.profile ?? null,
    /** True only if the token really is in the keychain, not merely that one exists. */
    tokenEncrypted: fs.existsSync(encryptedFile()),
  };
}

module.exports = {
  authorize,
  accessToken,
  disconnect,
  status,
  cancel,
  setCredentials,
  // Exposed so the storage layer can be tested against a real keyring without
  // standing up a whole OAuth round trip.
  _store: { readStore, writeStore, encryptionAvailable, encryptedFile, legacyFile },
};
