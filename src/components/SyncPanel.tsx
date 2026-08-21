import { useEffect, useState } from 'react';
import { isDesktop } from '../lib/desktop';
import { adoptLocalCatalog, countLocalCatalog } from '../lib/session';
import type { Account } from '../lib/accounts';
import {
  cancelConnect,
  connect,
  connectionStatus,
  disconnect,
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
  onConnectionChange,
}: Props) {
  const notify = useNotify();
  const [settings, setSettings] = useState<GoogleSettings | null>(null);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [strayCount, setStrayCount] = useState(0);

  useEffect(() => {
    void readSettings().then(setSettings);
    void connectionStatus().then((status) => setConnected(status.connected));
  }, []);

  // Designs catalogued before signing in sit in the signed-out catalog; offer
  // to bring them across rather than letting them look lost.
  useEffect(() => {
    if (!account) {
      setStrayCount(0);
      return;
    }
    void countLocalCatalog().then(setStrayCount);
  }, [account]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!settings) return null;

  const update = (changes: Partial<GoogleSettings>) => {
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
      await disconnect();
      setConnected(false);
      await onAccountChange(null);
      onConnectionChange();
      notify('Signed out. Your designs stay in Drive and on this device.', 'success');
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

  return (
    <div
      className="overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Google Drive sync"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="sync-panel">
        <header className="detail-head">
          <div className="detail-head-row">
            <h2 style={{ flex: 1, margin: 0, fontSize: 17, letterSpacing: '-0.015em' }}>
              Shared catalog
            </h2>
            <button type="button" className="btn btn-ghost btn-icon" onClick={onClose} title="Close">
              <IconClose />
            </button>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '8px 0 0' }}>
            Keeps this catalog in step with a <strong>Design Warehouse</strong> folder in your
            own Google Drive, so the web and desktop apps show the same designs. Where the same
            design was edited in both places, the most recent edit wins.
          </p>

          <div className="detail-actions">
            {account?.picture ? (
              <img className="account-avatar" src={account.picture} alt="" />
            ) : (
              <span className={`sync-dot${connected ? ' on' : ''}`} />
            )}
            <span style={{ fontSize: 13, marginRight: 'auto' }}>
              {account ? (
                <>
                  <strong>{account.email || account.name}</strong>
                  {lastSync ? ` · last synced ${new Date(lastSync).toLocaleString()}` : ''}
                </>
              ) : (
                'Not signed in'
              )}
            </span>
            {connected ? (
              <>
                <button type="button" className="btn btn-primary" onClick={onSync} disabled={syncing}>
                  <IconRefresh /> {syncing ? 'Syncing…' : 'Sync now'}
                </button>
                <button type="button" className="btn" onClick={handleDisconnect} disabled={busy}>
                  Sign out
                </button>
              </>
            ) : busy ? (
              <>
                <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                  Finish signing in in your browser…
                </span>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    void cancelConnect();
                    setBusy(false);
                  }}
                >
                  Cancel
                </button>
              </>
            ) : (
              <button type="button" className="btn btn-primary" onClick={handleConnect}>
                Sign in with Google
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
            <p style={{ color: 'var(--text-muted)', fontSize: 12.5, margin: 0 }}>
              Sync needs an OAuth client from your own Google Cloud project — there is no
              server in the middle, so the app signs in as you. The two builds need different
              client types; README → <em>Sharing a catalog across devices</em> has the steps.
            </p>

            {isDesktop ? (
              <>
                <TextField
                  label="Desktop client ID"
                  value={settings.desktopClientId}
                  placeholder="123456789-abc.apps.googleusercontent.com"
                  onChange={(value) => update({ desktopClientId: value.trim() })}
                />
                <TextField
                  label="Desktop client secret"
                  value={settings.desktopClientSecret}
                  placeholder="GOCSPX-…"
                  onChange={(value) => update({ desktopClientSecret: value.trim() })}
                />
                <p style={{ color: 'var(--text-faint)', fontSize: 11.5, margin: 0 }}>
                  Google issues a secret for desktop clients and documents it as not
                  confidential. It is stored on this computer only and never reaches the page.
                </p>
              </>
            ) : (
              <TextField
                label="Web client ID"
                value={settings.webClientId}
                placeholder="123456789-abc.apps.googleusercontent.com"
                onChange={(value) => update({ webClientId: value.trim() })}
              />
            )}

            <Field label="Automatic sync">
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={settings.autoSync}
                  onChange={(event) => update({ autoSync: event.target.checked })}
                  style={{ width: 16, height: 16, accentColor: 'var(--accent-strong)' }}
                />
                Sync on launch, and shortly after anything changes
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
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
