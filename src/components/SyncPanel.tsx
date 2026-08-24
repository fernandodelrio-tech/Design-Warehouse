import { useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { useOverlay } from '../lib/overlay';
import { adoptLocalCatalog, countLocalCatalog } from '../lib/session';
import type { Account } from '../lib/accounts';
import {
  connect,
  connectionStatus,
  readSettings,
  writeSettings,
} from '../lib/sync';
import type { GoogleSettings, SyncSummary } from '../lib/sync';
import { useNotify } from './Toast';
import { Field, Section, TextField } from './SpecFields';
import { IconClose, IconRefresh } from './Icons';

interface Props {
  onClose: () => void;
  onSync: () => void;
  syncing: boolean;
  lastSync: number | null;
  lastSummary: SyncSummary | null;
  account: Account | null;
  onAccountChange: (account: Account | null) => Promise<void>;
  onSignOut: () => Promise<void>;
  onConnectionChange: () => void;
}

export function SyncPanel({
  onClose,
  onSync,
  syncing,
  lastSync,
  lastSummary,
  account,
  onAccountChange,
  onSignOut,
  onConnectionChange,
}: Props) {
  const notify = useNotify();
  const [settings, setSettings] = useState<GoogleSettings | null>(null);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [strayCount, setStrayCount] = useState(0);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Re-read after every sync as well as at launch: a token lasts about an hour,
  // and the panel saying "connected" while the token behind it has expired is
  // how a paused sync goes unnoticed.
  useEffect(() => {
    void readSettings().then(setSettings);
    void connectionStatus().then((status) => setConnected(status.connected));
  }, [syncing, account]);

  // Designs catalogued before signing in sit in the signed-out catalog; offer
  // to bring them across rather than letting them look lost.
  useEffect(() => {
    if (!account) {
      setStrayCount(0);
      return;
    }
    void countLocalCatalog().then(setStrayCount);
  }, [account]);

  // Scroll lock, focus trap, Escape and focus restore — see lib/overlay.
  // This must stay above every early return: it is a hook, so calling it
  // conditionally would change the hook count between renders.
  useOverlay(overlayRef, onClose);

  /*
     The shell renders before the settings do.

     useOverlay reads ref.current once, in an effect whose deps never change.
     Returning null here — as this did — meant the overlay div did not exist on
     the render that effect fired after, so it captured null and the focus trap
     never ran for the life of the panel. Escape kept working, because it is
     checked before the node guard, and that is what hid the bug: the panel
     behaved like a modal from the keyboard's point of view right up until you
     pressed Tab and walked out into the catalog behind it.

     So the frame with no settings yet still renders the dialog, and the ref has
     something to hold.
  */

  const update = (changes: Partial<GoogleSettings>) => {
    // Only reachable once the panel has its settings — the shell render below
    // has no controls to call this from — but the guard is what tells the
    // compiler that, now that the early return sits underneath.
    if (!settings) return;
    const next = { ...settings, ...changes };
    setSettings(next);
    void writeSettings(next);
  };

  const handleConnect = async () => {
    setBusy(true);
    try {
      const signedIn = await connect();
      setConnected(true);
      await onAccountChange(signedIn);
      onConnectionChange();
      notify(`Signed in as ${signedIn.email || signedIn.name}.`, 'success');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not sign in.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    setBusy(true);
    try {
      await onSignOut();
      setConnected(false);
      onConnectionChange();
    } finally {
      setBusy(false);
    }
  };

  const handleAdopt = async () => {
    if (!account) return;
    setBusy(true);
    try {
      const moved = await adoptLocalCatalog(account);
      setStrayCount(0);
      await onAccountChange(account);
      notify(`Moved ${moved} design(s) into this account.`, 'success');
    } catch {
      notify('Could not move those designs.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const shell = {
    className: 'overlay',
    role: 'dialog',
    'aria-modal': true,
    'aria-label': 'Google Drive sync',
    ref: overlayRef,
    tabIndex: -1,
    onMouseDown: (event: ReactMouseEvent<HTMLDivElement>) => {
      if (event.target === event.currentTarget) onClose();
    },
  } as const;

  if (!settings) {
    return (
      <div {...shell}>
        <div className="sync-panel">
          <p className="sync-loading">Loading sync settings…</p>
        </div>
      </div>
    );
  }

  return (
    <div {...shell}>
      <div className="sync-panel">
        <header className="detail-head">
          <div className="detail-head-row">
            <h2 style={{ flex: 1, margin: 0, fontSize: 'var(--t-lede)', letterSpacing: '-0.015em' }}>
              Shared catalog
            </h2>
            <button type="button" className="btn btn-ghost btn-icon" onClick={onClose} title="Close">
              <IconClose />
            </button>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: 'var(--t-small)', margin: '8px 0 0' }}>
            Keeps this catalog in step with a <strong>Design Warehouse</strong> folder in your
            own Google Drive, so every browser you sign in from shows the same designs. Where
            the same design was edited in two places, the most recent edit wins.
          </p>

          <div className="detail-actions">
            {account ? (
              <span className="account-avatar account-initial">
                {(account.email || account.name || '?').charAt(0).toUpperCase()}
              </span>
            ) : (
              <span className={`sync-dot${connected ? ' on' : ''}`} />
            )}
            <span style={{ fontSize: 'var(--t-small)', marginRight: 'auto' }}>
              {account ? (
                <>
                  <strong>{account.email || account.name}</strong>
                  {lastSync ? ` · last synced ${new Date(lastSync).toLocaleString()}` : ''}
                  {connected ? '' : ' · Google access has expired — press Sync now to renew it'}
                </>
              ) : (
                'Not signed in'
              )}
            </span>
            {/*
              Keyed on the account, not on holding a live token: in a browser the
              token lives in memory, so after a reload you are signed in with no
              token yet — and gating this on `connected` left no way to sign out.
            */}
            {account ? (
              <>
                <button type="button" className="btn btn-primary" onClick={onSync} disabled={syncing}>
                  <IconRefresh /> {syncing ? 'Syncing…' : 'Sync now'}
                </button>
                <button type="button" className="btn" onClick={handleDisconnect} disabled={busy}>
                  Sign out
                </button>
              </>
            ) : (
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleConnect}
                disabled={busy}
              >
                {busy ? 'Signing in…' : 'Sign in with Google'}
              </button>
            )}
          </div>

          {strayCount > 0 && (
            <div className="sync-summary">
              {strayCount} design{strayCount === 1 ? '' : 's'} catalogued before you signed in
              {' '}
              {strayCount === 1 ? 'is' : 'are'} still in the signed-out catalog.{' '}
              <button
                type="button"
                className="btn"
                style={{ marginLeft: 4 }}
                onClick={handleAdopt}
                disabled={busy}
              >
                Move into this account
              </button>
            </div>
          )}

          {lastSummary && (
            <div className="sync-summary">
              {lastSummary.pulled} pulled · {lastSummary.pushed} pushed ·{' '}
              {lastSummary.deletedLocally + lastSummary.deletedRemotely} deletions applied
              {lastSummary.failed.length > 0 && (
                <span style={{ color: 'var(--danger)' }}>
                  {' '}
                  · {lastSummary.failed.length} could not be synced
                </span>
              )}
            </div>
          )}
        </header>

        <div className="detail-body">
          <Section title="Setup" defaultOpen={!connected}>
            <p style={{ color: 'var(--text-muted)', fontSize: 'var(--t-label)', margin: 0 }}>
              Sync needs a <strong>Web application</strong> OAuth client from your own Google
              Cloud project — there is no server in the middle, so the app signs in as you.
              README → <em>Sharing a catalog across devices</em> has the steps.
            </p>

            <TextField
              label="Web client ID"
              value={settings.webClientId}
              placeholder="123456789-abc.apps.googleusercontent.com"
              onChange={(value) => update({ webClientId: value.trim() })}
            />

            <Field label="This device">
              <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 'var(--t-small)' }}>
                <input
                  type="checkbox"
                  checked={settings.forgetOnSignOut}
                  onChange={(event) => update({ forgetOnSignOut: event.target.checked })}
                  style={{ width: 16, height: 16, marginTop: 2, accentColor: 'var(--accent-strong)' }}
                />
                <span>
                  Delete this device&rsquo;s copy when I sign out
                  <span style={{ display: 'block', color: 'var(--text-faint)', fontSize: 'var(--t-label)' }}>
                    Your designs stay in Drive and come back when you sign in again. Anything
                    unsynced is pushed first, and sign-out is abandoned if that fails.
                  </span>
                </span>
              </label>
            </Field>

            <Field label="Automatic sync">
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 'var(--t-small)' }}>
                <input
                  type="checkbox"
                  checked={settings.autoSync}
                  onChange={(event) => update({ autoSync: event.target.checked })}
                  style={{ width: 16, height: 16, accentColor: 'var(--accent-strong)' }}
                />
                Sync on launch, and whenever a design is added, edited or removed
              </label>
            </Field>
          </Section>

          <Section title="What gets shared">
            <div className="readout">
              <dt>Scope</dt>
              <dd>
                Only files this app creates. It cannot see anything else in your Drive.
              </dd>
              <dt>Folder</dt>
              <dd>“Design Warehouse” at the top level of My Drive.</dd>
              <dt>Contents</dt>
              <dd>One image and one spec file per design, plus a marker per deletion.</dd>
              <dt>Conflicts</dt>
              <dd>The most recently edited copy replaces the other.</dd>
              <dt>On this device</dt>
              <dd>
                Designs are stored unencrypted in this browser&rsquo;s storage. Anyone who can
                use this browser profile can read them; the separation between accounts keeps
                catalogs apart in the app, not from someone inspecting storage directly.
              </dd>
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
