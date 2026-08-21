import { analyzeBlob } from './analyze';
import { getBlobs, saveDesign } from './db';
import type { DesignRecord } from './types';

/** Clipboard, downloads, and whole-catalog backup files. */

export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  try {
    document.execCommand('copy');
  } finally {
    document.body.removeChild(area);
  }
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadText(filename: string, text: string, mime = 'text/plain'): void {
  downloadBlob(filename, new Blob([text], { type: `${mime};charset=utf-8` }));
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBlob(base64: string, type: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

interface BackupFile {
  format: 'design-warehouse-backup';
  version: 1;
  exportedAt: number;
  designs: Array<DesignRecord & { imageData: string }>;
}

/**
 * A single self-contained file with the images inlined. Big, but it is the only
 * copy of a catalog that otherwise lives inside one browser profile.
 */
export async function exportCatalog(records: DesignRecord[]): Promise<Blob> {
  const designs: BackupFile['designs'] = [];
  for (const record of records) {
    const blobs = await getBlobs(record.id);
    if (!blobs) continue;
    designs.push({ ...record, imageData: await blobToBase64(blobs.full) });
  }
  const payload: BackupFile = {
    format: 'design-warehouse-backup',
    version: 1,
    exportedAt: Date.now(),
    designs,
  };
  return new Blob([JSON.stringify(payload)], { type: 'application/json' });
}

export async function importCatalog(file: File): Promise<number> {
  const parsed = JSON.parse(await file.text()) as Partial<BackupFile>;
  if (parsed.format !== 'design-warehouse-backup' || !Array.isArray(parsed.designs)) {
    throw new Error('That file is not a Design Warehouse backup.');
  }
  let restored = 0;
  for (const entry of parsed.designs) {
    const { imageData, ...record } = entry;
    if (!imageData) continue;
    const full = base64ToBlob(imageData, record.image?.mimeType || 'image/png');
    // Thumbnails are cheap to rebuild, so backups do not carry them.
    const { thumb } = await analyzeBlob(full);
    await saveDesign({ ...record, updatedAt: Date.now() } as DesignRecord, {
      id: record.id,
      full,
      thumb,
    });
    restored++;
  }
  return restored;
}
