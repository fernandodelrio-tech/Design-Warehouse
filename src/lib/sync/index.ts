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

let running: Promise<SyncSummary> | null = null;

/**
 * Runs a two-way sync against the Drive folder.
 *
 * Calls collapse onto one in-flight run: an auto-sync firing while a manual one
 * is still going would otherwise have both halves reading the same listing and
 * uploading the same records twice.
 */
export async function runSync(options: SyncOptions = {}): Promise<SyncSummary> {
  if (running) return running;

  running = (async () => {
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
