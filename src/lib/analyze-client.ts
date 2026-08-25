/**
 * Runs the analyzer in a worker, and on the page when it cannot.
 *
 * One worker, one image at a time. The analysis is already CPU-bound and a
 * folder import is a queue rather than a race, so a pool would contend for the
 * same cores and finish no sooner — what matters is that the queue is not the
 * main thread.
 *
 * Every reason the worker might not be there is treated the same way: no
 * Worker constructor, a module worker the browser will not build, a format it
 * cannot decode, or a crash mid-analysis. Each falls back to the identical
 * function running on the page, so the app is never worse off than it was
 * before the worker existed — only slower for that one image.
 */
import { analyzeBlob } from './analyze';
import type { AnalysisResult } from './analyze';
import type { AnalyzeResponse } from './analyze.worker';

let worker: Worker | null = null;
let broken = false;
let nextId = 1;

const pending = new Map<number, (response: AnalyzeResponse) => void>();

function ensureWorker(): Worker | null {
  if (broken) return null;
  if (worker) return worker;
  if (typeof Worker === 'undefined') {
    broken = true;
    return null;
  }
  try {
    worker = new Worker(new URL('./analyze.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<AnalyzeResponse>) => {
      const resolve = pending.get(event.data.id);
      if (resolve) {
        pending.delete(event.data.id);
        resolve(event.data);
      }
    };
    /*
       A worker that dies takes every request waiting on it with it. Failing
       them all here rather than leaving their promises unsettled is what stops
       an import hanging on an image that will never come back.
    */
    worker.onerror = () => {
      broken = true;
      const waiting = [...pending.entries()];
      pending.clear();
      worker = null;
      for (const [id, resolve] of waiting) {
        resolve({ id, ok: false, unsupported: true, message: 'The analyzer worker stopped.' });
      }
    };
    return worker;
  } catch {
    broken = true;
    return null;
  }
}

/** Serialises requests: the analyzer is CPU-bound, so overlapping them helps nothing. */
let queue: Promise<unknown> = Promise.resolve();

export function analyzeInWorker(blob: Blob): Promise<AnalysisResult> {
  const run = async (): Promise<AnalysisResult> => {
    const active = ensureWorker();
    if (!active) return analyzeBlob(blob);

    const id = nextId++;
    const response = await new Promise<AnalyzeResponse>((resolve) => {
      pending.set(id, resolve);
      active.postMessage({ id, blob });
    });

    if (response.ok) {
      return {
        image: response.image,
        auto: response.auto,
        thumb: response.thumb,
      } as AnalysisResult;
    }
    // A format the worker could not decode is one the page still can.
    if (response.unsupported) return analyzeBlob(blob);
    throw new Error(response.message);
  };

  const result = queue.then(run, run);
  // The queue advances on failure as well as success, or one bad file would
  // stop every image behind it.
  queue = result.catch(() => undefined);
  return result;
}
