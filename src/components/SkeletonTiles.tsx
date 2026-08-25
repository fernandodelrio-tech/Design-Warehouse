import type { DesignRecord } from '../lib/types';

/**
 * Placeholders for images still being analysed.
 *
 * The tile is a fixed height whatever the screenshot is, so a stand-in costs
 * nothing to draw and lands exactly where the real card will. What it buys is
 * the thing an import was missing: somewhere for the eye to rest that says
 * work is happening and how much of it is left. Before this, dropping a folder
 * of two hundred screenshots left the page reading "your catalog is empty"
 * with a 2px line at the top of the viewport as the only sign of life.
 *
 * Not animated. A shimmer across a wall of tiles is a lot of motion for a
 * screen someone is already waiting on, and the count in the masthead and the
 * bar across the top are both already moving.
 */

export type Cell =
  | { kind: 'record'; record: DesignRecord }
  | { kind: 'pending'; index: number };

/** How many placeholders to draw at most, however large the import is. */
const MAX_PENDING = 12;

/**
 * The catalog and the images still coming, as one list.
 *
 * They share a grid so the placeholders continue the row the real cards are
 * on. Drawing every one of two hundred would be a page of empty tiles nobody
 * scrolls, so the tail is capped — the masthead is what carries the true
 * remaining count.
 */
export function pendingCells(
  records: DesignRecord[],
  progress: { done: number; total: number } | null,
): Cell[] {
  const cells: Cell[] = records.map((record) => ({ kind: 'record', record }));
  if (!progress) return cells;
  const remaining = Math.min(MAX_PENDING, Math.max(0, progress.total - progress.done));
  for (let i = 0; i < remaining; i++) cells.push({ kind: 'pending', index: i });
  return cells;
}

export function SkeletonTile() {
  return (
    <article className="card card-skeleton" aria-hidden="true">
      <div className="card-image skeleton-block" />
      <div className="card-skeleton-body">
        <span className="skeleton-line skeleton-line-title" />
        <span className="skeleton-line skeleton-line-meta" />
        <span className="skeleton-line skeleton-line-strip" />
        <span className="skeleton-line skeleton-line-row" />
        <span className="skeleton-line skeleton-line-row" />
      </div>
    </article>
  );
}
