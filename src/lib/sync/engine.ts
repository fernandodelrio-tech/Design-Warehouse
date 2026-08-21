import { analyzeBlob } from '../analyze';
import {
  getBlobs,
  listDesigns,
  listTombstones,
  putTombstone,
  saveDesign,
} from '../db';
import type { DesignRecord } from '../types';
import type { RemoteEntry, RemoteStore, SyncProgress, SyncSummary } from './types';

/**
 * Two-way sync, last edit wins.
 *
 * Every record carries `updatedAt` and every deletion leaves a tombstone, so
 * both sides can be reconciled by comparing timestamps without a server holding
 * a lock. There is no shared manifest file to race over: the remote is a flat
 * set of per-design files, so two devices writing at once touch different
 * objects.
 */

interface RemoteState {
  records: Map<string, RemoteEntry>;
  images: Map<string, RemoteEntry>;
  tombstones: Map<string, RemoteEntry>;
}

function indexRemote(entries: RemoteEntry[]): RemoteState {
  const state: RemoteState = { records: new Map(), images: new Map(), tombstones: new Map() };
  for (const entry of entries) {
    const target =
      entry.kind === 'record'
        ? state.records
        : entry.kind === 'image'
          ? state.images
          : state.tombstones;
    // A duplicate can only come from two devices writing at once; the newer
    // write is the one to believe.
    const existing = target.get(entry.designId);
    if (!existing || entry.stamp > existing.stamp) target.set(entry.designId, entry);
  }
  return state;
}

export interface SyncOptions {
  onProgress?: (progress: SyncProgress) => void;
  /** Lets a caller stop a long sync — checked between designs. */
  signal?: AbortSignal;
}

export async function syncWith(
  remote: RemoteStore,
  options: SyncOptions = {},
): Promise<SyncSummary> {
  const summary: SyncSummary = {
    pulled: 0,
    pushed: 0,
    deletedLocally: 0,
    deletedRemotely: 0,
    failed: [],
  };
  const report = (phase: SyncProgress['phase'], done: number, total: number) =>
    options.onProgress?.({ phase, done, total });

  report('listing', 0, 1);
  const [entries, localRecords, localTombstones] = await Promise.all([
    remote.list(),
    listDesigns(),
    listTombstones(),
  ]);

  const state = indexRemote(entries);
  const localById = new Map(localRecords.map((record) => [record.id, record]));
  const tombstoneById = new Map(localTombstones.map((t) => [t.id, t]));

  const stop = () => options.signal?.aborted === true;

  // --- remote wins: pull records that are newer there, apply remote deletions.

  const incoming = [...state.records.values()].filter((entry) => {
    const local = localById.get(entry.designId);
    const tombstone = tombstoneById.get(entry.designId);
    // A local delete that happened after the remote edit still wins.
    if (tombstone && tombstone.deletedAt > entry.stamp) return false;
    return !local || entry.stamp > local.updatedAt;
  });

  const remoteDeletes = [...state.tombstones.values()].filter((entry) => {
    const local = localById.get(entry.designId);
    return local != null && entry.stamp > local.updatedAt;
  });

  let done = 0;
  const pullTotal = incoming.length + remoteDeletes.length;

  for (const entry of remoteDeletes) {
    if (stop()) return summary;
    await putTombstone({ id: entry.designId, deletedAt: entry.stamp });
    summary.deletedLocally++;
    report('pulling', ++done, pullTotal);
  }

  for (const entry of incoming) {
    if (stop()) return summary;
    try {
      const pulled = await remote.readRecord(entry.fileId);
      // Trust whichever stamp is later. They agree when the other device wrote
      // the file, but a clock skew between machines would otherwise leave this
      // record looking permanently newer there and re-pulling on every sync.
      const record: DesignRecord = {
        ...pulled,
        updatedAt: Math.max(pulled.updatedAt ?? 0, entry.stamp),
      };
      // Metadata can change without the image ever changing, so only fetch the
      // bytes when they are genuinely missing here.
      const existingBlobs = await getBlobs(record.id);
      if (existingBlobs) {
        await saveDesign(record);
      } else {
        const imageEntry = state.images.get(record.id);
        if (!imageEntry) throw new Error('its image is missing from the shared folder');
        const full = await remote.readImage(imageEntry.fileId);
        const { thumb } = await analyzeBlob(full);
        await saveDesign(record, { id: record.id, full, thumb });
      }
      summary.pulled++;
    } catch (error) {
      summary.failed.push({
        id: entry.designId,
        reason: error instanceof Error ? error.message : 'could not be pulled',
      });
    }
    report('pulling', ++done, pullTotal);
  }

  // --- local wins: push records newer here, and deletions made here.

  const outgoing = localRecords.filter((record) => {
    const entry = state.records.get(record.id);
    const tombstone = state.tombstones.get(record.id);
    if (tombstone && tombstone.stamp > record.updatedAt) return false;
    return !entry || record.updatedAt > entry.stamp;
  });

  const localDeletes = localTombstones.filter((tombstone) => {
    const entry = state.records.get(tombstone.id);
    return entry != null && tombstone.deletedAt > entry.stamp;
  });

  done = 0;
  const pushTotal = outgoing.length + localDeletes.length;

  for (const record of outgoing) {
    if (stop()) return summary;
    try {
      await pushOne(remote, state, record);
      summary.pushed++;
    } catch (error) {
      summary.failed.push({
        id: record.id,
        reason: error instanceof Error ? error.message : 'could not be pushed',
      });
    }
    report('pushing', ++done, pushTotal);
  }

  for (const tombstone of localDeletes) {
    if (stop()) return summary;
    const record = state.records.get(tombstone.id);
    const image = state.images.get(tombstone.id);
    if (record) await remote.remove(record.fileId);
    if (image) await remote.remove(image.fileId);
    await remote.writeTombstone({
      designId: tombstone.id,
      kind: 'tombstone',
      stamp: tombstone.deletedAt,
    });
    summary.deletedRemotely++;
    report('pushing', ++done, pushTotal);
  }

  report('done', pushTotal, pushTotal);
  return summary;
}

async function pushOne(
  remote: RemoteStore,
  state: RemoteState,
  record: DesignRecord,
): Promise<void> {
  // The image is immutable once catalogued, so it is uploaded once and then
  // only the record is rewritten as the spec is edited.
  if (!state.images.has(record.id)) {
    const blobs = await getBlobs(record.id);
    if (!blobs) throw new Error('its image is missing locally');
    await remote.writeImage({ designId: record.id, kind: 'image', stamp: record.createdAt }, blobs.full);
  }

  const existing = state.records.get(record.id);
  if (existing) await remote.remove(existing.fileId);
  await remote.writeRecord(
    { designId: record.id, kind: 'record', stamp: record.updatedAt },
    record,
  );
}
