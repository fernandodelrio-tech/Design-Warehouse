import type { DesignBlobs, DesignRecord } from './types';

/**
 * IndexedDB persistence. Metadata and blobs live in separate stores so
 * listing the catalog never pulls megabytes of image data into memory.
 */

const DB_NAME = 'design-warehouse';
const DB_VERSION = 2;
const STORE_DESIGNS = 'designs';
const STORE_BLOBS = 'blobs';
const STORE_TOMBSTONES = 'tombstones';
const STORE_META = 'meta';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
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

export async function listDesigns(): Promise<DesignRecord[]> {
  const records = await tx([STORE_DESIGNS], 'readonly', (t) =>
    request(t.objectStore(STORE_DESIGNS).getAll() as IDBRequest<DesignRecord[]>),
  );
  return records.sort((a, b) => b.createdAt - a.createdAt);
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

export async function deleteDesign(id: string): Promise<void> {
  await tx([STORE_DESIGNS, STORE_BLOBS, STORE_TOMBSTONES], 'readwrite', (t) => {
    t.objectStore(STORE_DESIGNS).delete(id);
    t.objectStore(STORE_BLOBS).delete(id);
    t.objectStore(STORE_TOMBSTONES).put({ id, deletedAt: Date.now() });
  });
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
