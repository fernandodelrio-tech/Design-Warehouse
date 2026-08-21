import { currentDatabase, moveCatalogTo, useDatabase } from './db';
import { databaseFor } from './accounts';
import type { Account } from './accounts';
import { releaseAllImages } from '../hooks/useImageUrl';

/**
 * Switching who is signed in.
 *
 * Each account has its own catalog database, so the switch has to close the old
 * connection and drop every object URL built from it — a cached thumbnail from
 * the previous account would otherwise still be on screen.
 */

export async function openCatalogFor(account: Account | null): Promise<void> {
  const target = databaseFor(account);
  if (target === currentDatabase()) return;
  releaseAllImages();
  await useDatabase(target);
}

/**
 * Moves a signed-out catalog into the account that just signed in.
 *
 * Without this, a first sign-in looks like the app lost everything: the designs
 * are still there, but in the database for "nobody".
 */
export async function adoptLocalCatalog(account: Account): Promise<number> {
  await useDatabase(databaseFor(null));
  const moved = await moveCatalogTo(databaseFor(account));
  releaseAllImages();
  await useDatabase(databaseFor(account));
  return moved;
}

/**
 * Deletes this device's copy of an account's catalog.
 *
 * The database is closed first — IndexedDB will not delete one that is still
 * open, and a blocked delete reports success while leaving the data behind.
 */
export async function forgetCatalog(account: Account): Promise<boolean> {
  const name = databaseFor(account);
  if (currentDatabase() === name) await useDatabase(databaseFor(null));
  releaseAllImages();

  return new Promise<boolean>((resolve) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve(true);
    request.onerror = () => resolve(false);
    // Another tab still holds it open, so nothing was removed.
    request.onblocked = () => resolve(false);
  });
}

export async function countLocalCatalog(): Promise<number> {
  const previous = currentDatabase();
  await useDatabase(databaseFor(null));
  const { listDesigns } = await import('./db');
  const count = (await listDesigns()).length;
  await useDatabase(previous);
  return count;
}
