/**
 * The analyzer, off the page.
 *
 * A single 2880×1800 screenshot took the main thread for about 1.8 seconds
 * here — one long task, a hundred-odd dropped frames — during which nothing on
 * the page could be clicked, scrolled or typed into. On a phone that reads as
 * a crash rather than as work.
 *
 * Nothing in analyzeBlob touches the DOM: it works on an ImageBitmap and on
 * typed arrays, so it moves across whole. What does not move is the <img>
 * decode fallback for formats createImageBitmap refuses — chiefly SVG — and
 * that is what `unsupported` reports, so the caller can run the same analysis
 * on the page for those.
 */
import { analyzeBlob } from './analyze';

export interface AnalyzeRequest {
  id: number;
  blob: Blob;
}

export type AnalyzeResponse =
  | { id: number; ok: true; image: unknown; auto: unknown; thumb: Blob }
  | { id: number; ok: false; unsupported: boolean; message: string };

self.onmessage = async (event: MessageEvent<AnalyzeRequest>) => {
  const { id, blob } = event.data;
  try {
    const result = await analyzeBlob(blob);
    const response: AnalyzeResponse = {
      id,
      ok: true,
      image: result.image,
      auto: result.auto,
      thumb: result.thumb,
    };
    self.postMessage(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not analyse this image.';
    /*
       "Could not decode this image" out here means the worker has no Image to
       fall back to, not that the file is broken — the page can still read it.
       Anything else is a real failure and is reported as one, so a genuinely
       corrupt file is not silently retried at full cost on the main thread.
    */
    const response: AnalyzeResponse = {
      id,
      ok: false,
      unsupported: message === 'Could not decode this image.',
      message,
    };
    self.postMessage(response);
  }
};
