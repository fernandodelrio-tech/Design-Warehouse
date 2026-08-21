import { analyzeBlob, seedSpec } from './analyze';
import { saveDesign } from './db';
import type { DesignBlobs, DesignRecord, IngestSource } from './types';

export const SUPPORTED_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/bmp',
  'image/svg+xml',
];

export function isSupportedImage(file: { type: string; name?: string }): boolean {
  if (SUPPORTED_TYPES.includes(file.type)) return true;
  // Some folder pickers hand over an empty MIME type; fall back to the extension.
  return !!file.name && /\.(png|jpe?g|webp|gif|avif|bmp|svg)$/i.test(file.name);
}

function titleFromFileName(name: string): string {
  const base = name.replace(/\.[^.]+$/, '');
  const cleaned = base
    .replace(/[_-]+/g, ' ')
    .replace(/\b(screen ?shot|screen capture|capture|image|img|pasted)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned || /^\d[\d\s.:-]*$/.test(cleaned)) {
    return base.replace(/[_-]+/g, ' ').trim() || 'Untitled design';
  }
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `d_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function pastedTitle(): string {
  const now = new Date();
  const stamp = now.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  return `Pasted design — ${stamp}`;
}

export interface IngestOptions {
  source: IngestSource;
  fileName?: string;
  /** Relative path when the file came from a folder pick. */
  folderPath?: string;
}

export async function ingestBlob(
  blob: Blob,
  options: IngestOptions,
): Promise<DesignRecord> {
  const { image, auto, thumb } = await analyzeBlob(blob);
  const now = Date.now();
  const record: DesignRecord = {
    id: newId(),
    createdAt: now,
    updatedAt: now,
    title: options.fileName ? titleFromFileName(options.fileName) : pastedTitle(),
    source: options.source,
    fileName: options.folderPath || options.fileName || '',
    sourceUrl: '',
    notes: '',
    tags: [],
    favorite: false,
    image,
    auto,
    spec: seedSpec(image, auto),
  };
  const blobs: DesignBlobs = { id: record.id, full: blob, thumb };
  await saveDesign(record, blobs);
  return record;
}

export interface IngestReport {
  added: DesignRecord[];
  skipped: string[];
  failed: Array<{ name: string; reason: string }>;
}

export async function ingestFiles(
  files: File[],
  source: IngestSource,
  onProgress?: (done: number, total: number) => void,
): Promise<IngestReport> {
  const report: IngestReport = { added: [], skipped: [], failed: [] };
  const candidates = files.filter((f) => {
    if (isSupportedImage(f)) return true;
    report.skipped.push(f.name);
    return false;
  });

  let done = 0;
  for (const file of candidates) {
    try {
      const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
      const record = await ingestBlob(file, {
        source,
        fileName: file.name,
        folderPath: relative || undefined,
      });
      report.added.push(record);
    } catch (err) {
      report.failed.push({
        name: file.name,
        reason: err instanceof Error ? err.message : 'Unknown error',
      });
    }
    done++;
    onProgress?.(done, candidates.length);
    // Yield so the grid can paint between images on a big folder import.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return report;
}

/** Pull images out of a paste event. Returns [] when the clipboard held only text. */
export function imagesFromClipboard(event: ClipboardEvent): File[] {
  const items = event.clipboardData?.items;
  if (!items) return [];
  const files: File[] = [];
  for (const item of Array.from(items)) {
    if (item.kind !== 'file') continue;
    const file = item.getAsFile();
    if (file && isSupportedImage(file)) files.push(file);
  }
  return files;
}

/** Explicit "Paste" button path — needs the clipboard-read permission. */
export async function readClipboardImages(): Promise<Blob[]> {
  if (!navigator.clipboard?.read) {
    throw new Error('This browser cannot read the clipboard on demand — press Ctrl/Cmd+V instead.');
  }
  const items = await navigator.clipboard.read();
  const blobs: Blob[] = [];
  for (const item of items) {
    const type = item.types.find((t) => t.startsWith('image/'));
    if (type) blobs.push(await item.getType(type));
  }
  return blobs;
}

/** Walk a drag-and-drop payload, including dropped folders. */
export async function filesFromDataTransfer(dt: DataTransfer): Promise<File[]> {
  const entries = Array.from(dt.items)
    .filter((item) => item.kind === 'file')
    .map((item) =>
      'webkitGetAsEntry' in item ? (item.webkitGetAsEntry() as FileSystemEntry | null) : null,
    );

  if (entries.every((entry) => entry === null)) return Array.from(dt.files);

  const files: File[] = [];
  const walk = async (entry: FileSystemEntry | null): Promise<void> => {
    if (!entry) return;
    if (entry.isFile) {
      const file = await new Promise<File | null>((resolve) =>
        (entry as FileSystemFileEntry).file(resolve, () => resolve(null)),
      );
      if (file) files.push(file);
      return;
    }
    if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      // readEntries only returns a page at a time; keep going until it is empty.
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((resolve) =>
          reader.readEntries(resolve, () => resolve([])),
        );
        if (batch.length === 0) break;
        for (const child of batch) await walk(child);
      }
    }
  };

  for (const entry of entries) await walk(entry);
  return files;
}
