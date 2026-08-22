/** Canvas plumbing: decoding, thumbnailing, and pixel sampling. */

export interface Bitmap {
  width: number;
  height: number;
  source: CanvasImageSource;
  close(): void;
}

export async function loadBitmap(blob: Blob): Promise<Bitmap> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(blob);
      return {
        width: bmp.width,
        height: bmp.height,
        source: bmp,
        close: () => bmp.close(),
      };
    } catch {
      // Fall through to the <img> path — some formats decode there instead.
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Could not decode this image.'));
      el.src = url;
    });
    return {
      width: img.naturalWidth,
      height: img.naturalHeight,
      source: img,
      close: () => URL.revokeObjectURL(url),
    };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

function drawScaled(bitmap: Bitmap, maxEdge: number): HTMLCanvasElement {
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D is unavailable in this browser.');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap.source, 0, 0, width, height);
  return canvas;
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not encode thumbnail.'))),
      type,
      quality,
    );
  });
}

/** A grid-sized copy so the catalog never decodes full screenshots. */
export async function makeThumbnail(bitmap: Bitmap, maxEdge = 720): Promise<Blob> {
  const canvas = drawScaled(bitmap, maxEdge);
  try {
    return await canvasToBlob(canvas, 'image/webp', 0.85);
  } catch {
    return canvasToBlob(canvas, 'image/jpeg', 0.85);
  }
}

/** Downsampled pixels for the analyzer. Small on purpose: it runs on the UI thread. */
export function samplePixels(bitmap: Bitmap, maxEdge = 320): ImageData {
  const canvas = drawScaled(bitmap, maxEdge);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D is unavailable in this browser.');
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

export interface DetailSample extends ImageData {
  /** Multiply a measurement in this sample by `scale` to get source pixels. */
  scale: number;
}

/**
 * A second, much finer sample for measuring fine detail.
 *
 * The 320px sample the palette and layout run on is far too coarse for this: a
 * 1px hairline in a 1024-wide capture survives it as three tenths of a pixel.
 * Geometry needs something close to native, so this scales by a pixel budget
 * rather than by the longest edge — a very tall full-page capture keeps its
 * horizontal resolution, which is where borders and corners live.
 */
export function sampleDetail(bitmap: Bitmap, maxPixels = 4_000_000): DetailSample {
  const total = bitmap.width * bitmap.height;
  const scale = total > maxPixels ? Math.sqrt(maxPixels / total) : 1;
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D is unavailable in this browser.');
  // Nearest-neighbour: smoothing would blur a hairline into the two regions it
  // separates, which is precisely the thing being measured.
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(bitmap.source, 0, 0, width, height);
  const data = ctx.getImageData(0, 0, width, height) as DetailSample;
  data.scale = bitmap.width / width;
  return data;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** "16:9" when it lands near a familiar ratio, "1.62:1" otherwise. */
export function describeAspect(width: number, height: number): string {
  const common: Array<[number, number]> = [
    [16, 9], [9, 16], [4, 3], [3, 4], [3, 2], [2, 3],
    [1, 1], [21, 9], [5, 4], [16, 10], [10, 16], [19.5, 9],
  ];
  const ratio = width / height;
  for (const [w, h] of common) {
    if (Math.abs(ratio - w / h) < 0.02) return `${w}:${h}`;
  }
  const divisor = gcd(width, height);
  if (divisor > 1 && width / divisor <= 40 && height / divisor <= 40) {
    return `${width / divisor}:${height / divisor}`;
  }
  return `${ratio.toFixed(2)}:1`;
}
