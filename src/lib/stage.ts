/**
 * How large a tile's picture is on screen, in real pixels.
 *
 * The analyzer measures in source pixels and the thumbnail is the source at a
 * quarter scale or less, so anything drawn onto the picture needs the ratio
 * between the two. Percentages of the picture's own box get some of the way
 * there and no further: a percentage height resolves against height while a
 * percentage width resolves against width, so one ratio applied to both drew
 * the specimen as a rectangle and its corner as an ellipse — a drawing that
 * scaled with the picture and misstated its shape. Border width and blur
 * radius take no percentage at all, which left the measured hairline and the
 * measured elevation undrawable.
 *
 * One number fixes all of it. Every tile in the grid is the same size, so one
 * ResizeObserver on one stage is the whole cost, and the figure it publishes
 * lets each overlay work in the same units the measurements are in.
 */
import { useSyncExternalStore } from 'react';

export interface StageSize {
  w: number;
  h: number;
}

let size: StageSize = { w: 0, h: 0 };
const subscribers = new Set<() => void>();

let observer: ResizeObserver | null = null;
let target: Element | null = null;

/**
 * Adopt a tile's stage as the one that is measured.
 *
 * Held until it leaves the document — filtering the catalog unmounts tiles,
 * and an observer pointed at a detached node stops reporting.
 */
export function registerStage(node: Element | null): void {
  if (!node || node === target) return;
  if (typeof ResizeObserver === 'undefined') return;
  if (target && target.isConnected) return;

  target = node;
  observer?.disconnect();
  observer = new ResizeObserver((entries) => {
    const rect = entries[0]?.contentRect;
    if (!rect) return;
    // Sub-pixel jitter during a resize would otherwise wake every tile.
    if (Math.abs(rect.width - size.w) < 0.5 && Math.abs(rect.height - size.h) < 0.5) return;
    size = { w: rect.width, h: rect.height };
    for (const notify of subscribers) notify();
  });
  observer.observe(node);
}

const subscribe = (notify: () => void) => {
  subscribers.add(notify);
  return () => {
    subscribers.delete(notify);
  };
};

/**
 * The same signal outside React.
 *
 * Attention ranks tiles by how near their centres are to the middle of the
 * viewport, and the Size control changes every one of those centres without
 * scrolling the page or resizing the window — so the ranking would go stale
 * with nothing to announce it. This is the announcement.
 */
export const subscribeStage = subscribe;

/** The stage's rendered size. `{0, 0}` until the first observation lands. */
export function useStageSize(): StageSize {
  return useSyncExternalStore(subscribe, () => size, () => size);
}

/**
 * Source pixels to screen pixels, for a picture drawn with `object-fit:
 * cover`. Zero before the stage has been measured, which callers read as
 * "not yet known" rather than as a scale.
 */
export function coverScale(stage: StageSize, srcW: number, srcH: number): number {
  if (!stage.w || !stage.h || !srcW || !srcH) return 0;
  return Math.max(stage.w / srcW, stage.h / srcH);
}
