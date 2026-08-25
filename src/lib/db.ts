import type { DesignBlobs, DesignRecord } from './types';

/**
 * IndexedDB persistence. Metadata and blobs live in separate stores so
 * listing the catalog never pulls megabytes of image data into memory.
 */

const DB_VERSION = 2;
const STORE_DESIGNS = 'designs';
const STORE_BLOBS = 'blobs';
const STORE_TOMBSTONES = 'tombstones';
const STORE_META = 'meta';

let dbName = 'design-warehouse';
let dbPromise: Promise<IDBDatabase> | null = null;

/**
 * Points every later call at a different database.
 *
 * Each signed-in account gets its own, so switching accounts cannot leave one
 * person looking at another's designs. The open connection is closed first —
 * an old handle would keep serving the previous account's data.
 */
export async function useDatabase(name: string): Promise<void> {
  if (name === dbName) return;
  const previous = dbPromise;
  dbName = name;
  dbPromise = null;
  if (previous) {
    try {
      (await previous).close();
    } catch {
      // Already closed, or it never opened. Either way it is not in use now.
    }
  }
}

export function currentDatabase(): string {
  return dbName;
}

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  const opening = dbName;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(opening, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_DESIGNS)) {
        const store = db.createObjectStore(STORE_DESIGNS, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt');
      }
      if (!db.objectStoreNames.contains(STORE_BLOBS)) {
        db.createObjectStore(STORE_BLOBS, { keyPath: 'id' });
      }
      // A deletion has to be recorded, not just applied: without a tombstone the
      // next sync sees the design still present on the other device and pulls it
      // back, and a delete never sticks.
      if (!db.objectStoreNames.contains(STORE_TOMBSTONES)) {
        db.createObjectStore(STORE_TOMBSTONES, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open the catalog.'));
  });
  return dbPromise;
}

/** Empties a catalog outright. Unlike clearCatalog this leaves no tombstones. */
async function wipeCatalogData(): Promise<void> {
  await tx([STORE_DESIGNS, STORE_BLOBS], 'readwrite', (t) => {
    t.objectStore(STORE_DESIGNS).clear();
    t.objectStore(STORE_BLOBS).clear();
  });
}

/**
 * Moves an entire catalog into another database, for adopting a signed-out one
 * on first sign-in.
 *
 * The source is emptied only once every record has landed in the target, and
 * emptied it must be: designs left behind stay adoptable by whoever signs in
 * next, which would hand one person's catalog to another.
 */
export async function moveCatalogTo(target: string): Promise<number> {
  const records = await listDesigns();
  if (records.length === 0) return 0;

  const payload: Array<{ record: DesignRecord; blobs: DesignBlobs | undefined }> = [];
  for (const record of records) {
    payload.push({ record, blobs: await getBlobs(record.id) });
  }

  const source = dbName;
  await useDatabase(target);
  let written = 0;
  try {
    for (const { record, blobs } of payload) {
      await saveDesign(record, blobs);
      written++;
    }
  } finally {
    await useDatabase(source);
  }

  // A partial copy is left alone rather than half-deleted.
  if (written === payload.length) await wipeCatalogData();
  return written;
}

function tx<T>(
  stores: string[],
  mode: IDBTransactionMode,
  run: (transaction: IDBTransaction) => Promise<T> | T,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(stores, mode);
        let result: T;
        transaction.oncomplete = () => resolve(result);
        transaction.onerror = () => reject(transaction.error ?? new Error('Storage error.'));
        transaction.onabort = () => reject(transaction.error ?? new Error('Storage aborted.'));
        Promise.resolve(run(transaction)).then(
          (value) => {
            result = value;
          },
          (err) => {
            reject(err);
            try {
              transaction.abort();
            } catch {
              /* already settled */
            }
          },
        );
      }),
  );
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Storage request failed.'));
  });
}

/**
 * The catalog, without anything in the bin.
 *
 * Every caller that matters reads through here — the app, the account switch,
 * and the sync engine's push — so filtering in this one place is what keeps a
 * binned design out of the grid, out of exports and off the wire, without each
 * of them having to remember to ask.
 */
export async function listDesigns(): Promise<DesignRecord[]> {
  const records = await tx([STORE_DESIGNS], 'readonly', (t) =>
    request(t.objectStore(STORE_DESIGNS).getAll() as IDBRequest<DesignRecord[]>),
  );
  return records.filter((r) => r.deletedAt == null).sort((a, b) => b.createdAt - a.createdAt);
}

/** Everything in the bin, newest deletion first. */
export async function listDeleted(): Promise<DesignRecord[]> {
  const records = await tx([STORE_DESIGNS], 'readonly', (t) =>
    request(t.objectStore(STORE_DESIGNS).getAll() as IDBRequest<DesignRecord[]>),
  );
  return records
    .filter((r) => r.deletedAt != null)
    .sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0));
}

export async function saveDesign(record: DesignRecord, blobs?: DesignBlobs): Promise<void> {
  const stores = blobs ? [STORE_DESIGNS, STORE_BLOBS] : [STORE_DESIGNS];
  try {
    await tx(stores, 'readwrite', (t) => {
      t.objectStore(STORE_DESIGNS).put(record);
      if (blobs) t.objectStore(STORE_BLOBS).put(blobs);
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'QuotaExceededError') {
      throw new Error(
        'The browser is out of storage for this catalog. Back it up, then delete some designs.',
      );
    }
    throw err;
  }
}

export async function getBlobs(id: string): Promise<DesignBlobs | undefined> {
  return tx([STORE_BLOBS], 'readonly', (t) =>
    request(t.objectStore(STORE_BLOBS).get(id) as IDBRequest<DesignBlobs | undefined>),
  );
}

/**
 * Hard delete: the record, its blobs, and a tombstone so the deletion sticks
 * instead of being pulled back by the next sync. Used by the bin when a
 * staged deletion ages out, and by nothing else.
 */
export async function deleteDesign(id: string): Promise<void> {
  await tx([STORE_DESIGNS, STORE_BLOBS, STORE_TOMBSTONES], 'readwrite', (t) => {
    t.objectStore(STORE_DESIGNS).delete(id);
    t.objectStore(STORE_BLOBS).delete(id);
    t.objectStore(STORE_TOMBSTONES).put({ id, deletedAt: Date.now() });
  });
}

/**
 * Stages a deletion: stops listing the design and writes its tombstone, but
 * keeps the record and the image on this machine so it can be put back.
 *
 * The tombstone goes out now rather than at purge because the alternative is
 * a delete that does not reach the other devices for a month.
 */
export async function binDesign(id: string): Promise<DesignRecord | undefined> {
  const at = Date.now();
  return tx([STORE_DESIGNS, STORE_TOMBSTONES], 'readwrite', async (t) => {
    const store = t.objectStore(STORE_DESIGNS);
    const record = await request(store.get(id) as IDBRequest<DesignRecord | undefined>);
    if (!record) return undefined;
    const binned = { ...record, deletedAt: at };
    store.put(binned);
    t.objectStore(STORE_TOMBSTONES).put({ id, deletedAt: at });
    return binned;
  });
}

/**
 * Puts a binned design back, and clears the tombstone that took it away.
 *
 * `updatedAt` moves to now deliberately: the sync engine reconciles on
 * timestamps, so a restore has to be newer than the deletion it undoes or the
 * next round would simply delete it again.
 */
export async function restoreDesign(id: string): Promise<DesignRecord | undefined> {
  return tx([STORE_DESIGNS, STORE_TOMBSTONES], 'readwrite', async (t) => {
    const store = t.objectStore(STORE_DESIGNS);
    const record = await request(store.get(id) as IDBRequest<DesignRecord | undefined>);
    if (!record) return undefined;
    const { deletedAt: _binned, ...rest } = record;
    const restored = { ...rest, updatedAt: Date.now() } as DesignRecord;
    store.put(restored);
    t.objectStore(STORE_TOMBSTONES).delete(id);
    return restored;
  });
}

/** How long a staged deletion can be undone for. */
export const BIN_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Applies the deletions that have aged out. Their tombstones already exist,
 * so this only reclaims the space the kept copies were holding.
 */
export async function purgeBin(maxAgeMs = BIN_RETENTION_MS): Promise<number> {
  const cutoff = Date.now() - maxAgeMs;
  const expired = (await listDeleted()).filter((r) => (r.deletedAt ?? 0) <= cutoff);
  if (!expired.length) return 0;
  await tx([STORE_DESIGNS, STORE_BLOBS], 'readwrite', (t) => {
    for (const record of expired) {
      t.objectStore(STORE_DESIGNS).delete(record.id);
      t.objectStore(STORE_BLOBS).delete(record.id);
    }
  });
  return expired.length;
}

export interface Tombstone {
  id: string;
  deletedAt: number;
}

export async function listTombstones(): Promise<Tombstone[]> {
  return tx([STORE_TOMBSTONES], 'readonly', (t) =>
    request(t.objectStore(STORE_TOMBSTONES).getAll() as IDBRequest<Tombstone[]>),
  );
}

export async function putTombstone(tombstone: Tombstone): Promise<void> {
  await tx([STORE_DESIGNS, STORE_BLOBS, STORE_TOMBSTONES], 'readwrite', (t) => {
    t.objectStore(STORE_DESIGNS).delete(tombstone.id);
    t.objectStore(STORE_BLOBS).delete(tombstone.id);
    t.objectStore(STORE_TOMBSTONES).put(tombstone);
  });
}

/** Small key/value corner for sync bookkeeping: folder id, tokens, last run. */
export async function readMeta<T>(key: string): Promise<T | undefined> {
  const row = await tx([STORE_META], 'readonly', (t) =>
    request(t.objectStore(STORE_META).get(key) as IDBRequest<{ key: string; value: T } | undefined>),
  );
  return row?.value;
}

export async function writeMeta<T>(key: string, value: T): Promise<void> {
  await tx([STORE_META], 'readwrite', (t) => {
    t.objectStore(STORE_META).put({ key, value });
  });
}

export async function clearMeta(key: string): Promise<void> {
  await tx([STORE_META], 'readwrite', (t) => {
    t.objectStore(STORE_META).delete(key);
  });
}

export async function clearCatalog(): Promise<void> {
  const existing = await listDesigns();
  const now = Date.now();
  await tx([STORE_DESIGNS, STORE_BLOBS, STORE_TOMBSTONES], 'readwrite', (t) => {
    t.objectStore(STORE_DESIGNS).clear();
    t.objectStore(STORE_BLOBS).clear();
    // Clearing is a deletion too, and has to survive the next sync.
    const tombstones = t.objectStore(STORE_TOMBSTONES);
    for (const record of existing) tombstones.put({ id: record.id, deletedAt: now });
  });
}

export interface StorageUsage {
  usage: number;
  quota: number;
}

export async function estimateStorage(): Promise<StorageUsage | null> {
  if (!navigator.storage?.estimate) return null;
  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  return { usage, quota };
}

/** Ask the browser not to evict the catalog under storage pressure. */
export async function requestPersistence(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
