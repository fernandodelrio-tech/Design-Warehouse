/**
 * Which tile is being attended to, on a device with no pointer to say so.
 *
 * The overlay is meant for one tile at a time — that is the composition. With
 * a mouse, hover and focus say which one. A touch screen has neither, and the
 * first answer here was to show every sheet at once, which is not "data on
 * demand": it put 150px of slab on every one of two hundred tiles and gave the
 * wall back to metadata, the exact arrangement the sheet was built to replace.
 *
 * So scrolling is the gesture. The tile crossing the middle of the viewport is
 * the one being looked at, and it is the one that opens. Attention moves as the
 * thumb moves, one tile at a time, and a tap still opens a design rather than
 * being spent on revealing a spec.
 *
 * One observer for the whole wall rather than one per tile, and none at all on
 * a device that has a pointer.
 */
import { useEffect, useState } from 'react';

type Listener = (attended: boolean) => void;

let observer: IntersectionObserver | null = null;
const listeners = new WeakMap<Element, Listener>();

/**
 * A narrow band across the middle of the viewport. Narrow on purpose: a wide
 * band lights two tiles at once and the wall reads as noise again.
 */
const BAND = '-46% 0px -46% 0px';

function shared(): IntersectionObserver | null {
  if (observer) return observer;
  if (typeof IntersectionObserver === 'undefined') return null;
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) listeners.get(entry.target)?.(entry.isIntersecting);
    },
    { rootMargin: BAND },
  );
  return observer;
}

/** True when this element holds the middle of the viewport on a touch device. */
export function useAttention(node: Element | null): boolean {
  const [attended, setAttended] = useState(false);

  useEffect(() => {
    if (!node) return;
    // A device with a pointer says what it is attending to by pointing at it.
    if (typeof matchMedia === 'undefined' || !matchMedia('(hover: none)').matches) return;
    const io = shared();
    if (!io) return;
    listeners.set(node, setAttended);
    io.observe(node);
    return () => {
      io.unobserve(node);
      listeners.delete(node);
      setAttended(false);
    };
  }, [node]);

  return attended;
}
