import { analyzeBlob, seedSpec } from './analyze';
import { saveDesign } from './db';
import { nameDesign } from './naming';
import { isGenericFileName, titleFromFileName, uniqueTitle } from './title';
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

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `d_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export interface IngestOptions {
  source: IngestSource;
  fileName?: string;
  /** Relative path when the file came from a folder pick. */
  folderPath?: string;
  /**
   * Titles already in the catalog, so a described title can be numbered rather
   * than repeated. Mutated as titles are handed out, which also keeps a single
   * batch of imports from colliding with itself.
   */
  takenTitles?: Set<string>;
}

export async function ingestBlob(
  blob: Blob,
  options: IngestOptions,
): Promise<DesignRecord> {
  const { image, auto, thumb } = await analyzeBlob(blob);
  const spec = seedSpec(image, auto);
  const taken = options.takenTitles ?? new Set<string>();
  // A name someone chose is worth keeping; a camera-roll id or a timestamped
  // screenshot is not, so those are named after what the design looks like.
  const named =
    options.fileName && !isGenericFileName(options.fileName)
      ? uniqueTitle(titleFromFileName(options.fileName), taken)
      : nameDesign(auto, spec, taken);

  const now = Date.now();
  const record: DesignRecord = {
    id: newId(),
    createdAt: now,
    updatedAt: now,
    title: named,
    source: options.source,
    fileName: options.folderPath || options.fileName || '',
    sourceUrl: '',
    notes: '',
    tags: [],
    favorite: false,
    image,
    auto,
    spec,
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
  takenTitles?: Set<string>,
): Promise<IngestReport> {
  const report: IngestReport = { added: [], skipped: [], failed: [] };
  const taken = takenTitles ?? new Set<string>();
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
        takenTitles: taken,
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
