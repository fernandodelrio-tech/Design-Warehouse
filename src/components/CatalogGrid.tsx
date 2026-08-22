import type { ReactNode } from 'react';

/**
 * The catalog grid: one row-major column track per card, every tile the same
 * height.
 *
 * This replaced a masonry layout that sized each tile to its screenshot. Design
 * screenshots vary wildly in aspect — a mobile mock next to a dashboard — and
 * the ragged result made the footers, which are the point of the app, hard to
 * scan across. Tiles are now uniform and crop the screenshot; opening one shows
 * it at full length.
 *
 * `min()` on the track floor is what makes this work on a phone: a bare
 * `minmax(300px, 1fr)` cannot fit 300px into a 340px viewport minus padding and
 * overflows the page sideways, so the floor has to collapse to the column width
 * when the column is the narrower of the two.
 */

interface Props<T> {
  items: T[];
  keyFor: (item: T) => string;
  /** Preferred tile width; the real width stretches to fill the row. */
  minWidth: number;
  children: (item: T) => ReactNode;
}

export function CatalogGrid<T>({ items, keyFor, minWidth, children }: Props<T>) {
  return (
    <div className="catalog-grid" style={{ ['--card-min' as string]: `${minWidth}px` }}>
      {items.map((item) => (
        <div className="catalog-cell" key={keyFor(item)}>
          {children(item)}
        </div>
      ))}
    </div>
  );
}
