import { useEffect, useState } from 'react';
import { getBlobs } from '../lib/db';

/**
 * Object URLs for stored blobs.
 *
 * Thumbnails are cached for the life of the session — cards mount and unmount
 * constantly as the grid filters, and re-reading IndexedDB every time makes the
 * catalog flicker. Full-size images are not cached; they are large and only one
 * is on screen at a time.
 */

const thumbUrls = new Map<string, string>();
const inFlight = new Map<string, Promise<string | null>>();

async function loadThumb(id: string): Promise<string | null> {
  const cached = thumbUrls.get(id);
  if (cached) return cached;
  const existing = inFlight.get(id);
  if (existing) return existing;

  const promise = getBlobs(id)
    .then((blobs) => {
      if (!blobs) return null;
      const url = URL.createObjectURL(blobs.thumb);
      thumbUrls.set(id, url);
      return url;
    })
    .catch(() => null)
    .finally(() => inFlight.delete(id));

  inFlight.set(id, promise);
  return promise;
}

export function releaseImage(id: string): void {
  const url = thumbUrls.get(id);
  if (url) {
    URL.revokeObjectURL(url);
    thumbUrls.delete(id);
  }
}

export function releaseAllImages(): void {
  for (const url of thumbUrls.values()) URL.revokeObjectURL(url);
  thumbUrls.clear();
}

export function useThumbUrl(id: string): string | null {
  const [url, setUrl] = useState<string | null>(() => thumbUrls.get(id) ?? null);

  useEffect(() => {
    if (thumbUrls.has(id)) {
      setUrl(thumbUrls.get(id)!);
      return;
    }
    let active = true;
    loadThumb(id).then((result) => {
      if (active) setUrl(result);
    });
    return () => {
      active = false;
    };
  }, [id]);

  return url;
}

export function useFullImageUrl(id: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      setUrl(null);
      return;
    }
    let active = true;
    let created: string | null = null;
    getBlobs(id).then((blobs) => {
      if (!blobs) return;
      if (!active) return;
      created = URL.createObjectURL(blobs.full);
      setUrl(created);
    });
    return () => {
      active = false;
      setUrl(null);
      if (created) URL.revokeObjectURL(created);
    };
  }, [id]);

  return url;
}
