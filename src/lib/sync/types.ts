import type { DesignRecord } from '../types';

/**
 * What the sync engine needs from a remote store.
 *
 * Deliberately narrow, and deliberately not Google-shaped: the engine is
 * written against this and tested against an in-memory implementation, so its
 * behaviour can be verified without credentials or a network.
 */

export type RemoteKind = 'record' | 'image' | 'tombstone';

export interface RemoteEntry {
  /** The store's own id for the file. */
  fileId: string;
  /** The design this file belongs to. */
  designId: string;
  kind: RemoteKind;
  /** `updatedAt` for a record, `deletedAt` for a tombstone. */
  stamp: number;
}

export interface RemoteStore {
  /** Every file this app has put in the catalog folder. */
  list(): Promise<RemoteEntry[]>;
  readRecord(fileId: string): Promise<DesignRecord>;
  readImage(fileId: string): Promise<Blob>;
  writeRecord(entry: Omit<RemoteEntry, 'fileId'>, record: DesignRecord): Promise<void>;
  writeImage(entry: Omit<RemoteEntry, 'fileId'>, image: Blob): Promise<void>;
  writeTombstone(entry: Omit<RemoteEntry, 'fileId'>): Promise<void>;
  remove(fileId: string): Promise<void>;
}

export interface SyncSummary {
  pulled: number;
  pushed: number;
  deletedLocally: number;
  deletedRemotely: number;
  /** Designs skipped because their image could not be read or written. */
  failed: Array<{ id: string; reason: string }>;
}

export interface SyncProgress {
  phase: 'listing' | 'pulling' | 'pushing' | 'done';
  done: number;
  total: number;
}
