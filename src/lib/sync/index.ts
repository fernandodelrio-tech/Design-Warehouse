import { readMeta, writeMeta } from '../db';
import { accessToken } from './auth';
import { createDriveStore, ensureFolder } from './drive';
import { syncWith } from './engine';
import type { SyncOptions } from './engine';
import type { SyncSummary } from './types';

export * from './auth';
export type { SyncProgress, SyncSummary } from './types';

const FOLDER_KEY = 'drive-folder-id';
const LAST_SYNC_KEY = 'drive-last-sync';

/** Resolved once and remembered; creating it every sync would be a wasted round trip. */
async function folderId(): Promise<string> {
  const cached = await readMeta<string>(FOLDER_KEY);
  if (cached) return cached;
  const id = await ensureFolder(accessToken);
  await writeMeta(FOLDER_KEY, id);
  return id;
}

export interface RunOptions extends SyncOptions {
  /**
   * Whether this run may ask Google for access. False for a sync no one
   * clicked: it has no click to open a popup with, so it stops rather than
   * firing a window the browser will block.
   */
  interactive?: boolean;
}

let running: Promise<SyncSummary> | null = null;

/**
 * Runs a two-way sync against the Drive folder.
 *
 * Calls collapse onto one in-flight run: an auto-sync firing while a manual one
 * is still going would otherwise have both halves reading the same listing and
 * uploading the same records twice.
 */
export async function runSync(options: RunOptions = {}): Promise<SyncSummary> {
  if (running) return running;

  running = (async () => {
    /*
       The token is asked for FIRST, before the folder lookup and before any
       Drive call, because asking for one opens a popup and a browser only
       opens a popup for a page that was just clicked on. Asking for it where
       Drive first needed it — after an IndexedDB read and a round trip — was
       late enough that the click had stopped counting, and the sync failed
       with Google's "Failed to open popup window" instead of syncing.
    */
    await accessToken(options.interactive ?? true);
    const store = createDriveStore(accessToken, await folderId());
    const summary = await syncWith(store, options);
    await writeMeta(LAST_SYNC_KEY, Date.now());
    return summary;
  })().finally(() => {
    running = null;
  });

  return running;
}

export function syncInFlight(): boolean {
  return running !== null;
}

export async function lastSyncAt(): Promise<number | null> {
  return (await readMeta<number>(LAST_SYNC_KEY)) ?? null;
}
