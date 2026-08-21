import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

/**
 * Row-major masonry.
 *
 * CSS `column-count` would be a one-liner but it orders items down each column,
 * so the second-newest design lands under the newest instead of beside it.
 * Measuring each card and spanning implicit 8px rows keeps reading order intact.
 */

const ROW = 8;
const GAP = 20;

function MasonryItem({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [span, setSpan] = useState(30);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const height = element.getBoundingClientRect().height;
      if (height > 0) setSpan(Math.ceil((height + GAP) / ROW));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="masonry-item" style={{ gridRowEnd: `span ${span}` }}>
      <div className="masonry-inner" ref={ref}>
        {children}
      </div>
    </div>
  );
}

interface Props<T> {
  items: T[];
  keyFor: (item: T) => string;
  minWidth: number;
  children: (item: T) => ReactNode;
}

export function MasonryGrid<T>({ items, keyFor, minWidth, children }: Props<T>) {
  return (
    <div
      className="masonry"
      style={{ ['--card-min' as string]: `${minWidth}px` }}
    >
      {items.map((item) => (
        <MasonryItem key={keyFor(item)}>{children(item)}</MasonryItem>
      ))}
    </div>
  );
}
