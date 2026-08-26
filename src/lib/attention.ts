/**
 * Which tile is being attended to, on a device with no pointer to say so.
 *
 * The overlay is meant for one tile at a time — that is the composition. With
 * a mouse, hover and focus say which one. A touch screen has neither, and the
 * first answer here was to show every sheet at once, which is not "data on
 * demand": it put 150px of slab on every one of two hundred tiles and gave the
 * wall back to metadata, the exact arrangement the sheet was built to replace.
 *
 * So scrolling is the gesture. The tile holding the middle of the viewport is
 * the one being looked at, and it is the one that opens. Attention moves as the
 * thumb moves, one tile at a time, and a tap still opens a design rather than
 * being spent on revealing a spec.
 *
 * The second answer was a narrow horizontal band across the viewport, lighting
 * whatever intersected it. That is one tile only where the grid is one column
 * wide. On an iPad the same band lit an entire ROW of five, and lit two rows —
 * ten tiles — through every handover, so scrolling flashed rows on and off.
 * Reproduced at 1180×820 with touch emulation: five lit at rest, ten mid-swap,
 * nine such states over a 1400px scroll. A band cannot express "one tile",
 * because a band is a shape and the answer is a ranking.
 *
 * So the observer stops deciding and starts gathering. It keeps the set of
 * tiles that are on screen at all — cheap, and the only part worth a callback —
 * and the winner is the one whose centre lies nearest the centre of the
 * viewport, recomputed on a frame boundary while the wall moves. Exactly one
 * tile is lit whenever any tile is visible, and attention hands from that tile
 * to the next rather than switching a row off and another on.
 *
 * One observer for the whole wall rather than one per tile, and none at all on
 * a device that has a pointer.
 */
import { useEffect, useState } from 'react';
import { subscribeStage } from './stage';

type Listener = (attended: boolean) => void;

let observer: IntersectionObserver | null = null;

/** Every mounted tile, so the winner can be told apart from the last winner. */
const listeners = new Map<Element, Listener>();

/** The tiles on screen — the only ones whose boxes are worth measuring. */
const onScreen = new Set<Element>();

let winner: Element | null = null;
let frame = 0;

/**
 * How much closer a challenger must be before attention moves, in pixels.
 *
 * Two tiles are equidistant from the middle at every handover, and without a
 * margin a rubber-band scroll or a pixel of jitter sits on that tie and flips
 * the sheet back and forth. Small enough that a deliberate scroll hands over
 * when it looks like it should.
 */
const HOLD = 24;

/** Distance from a tile's centre to the middle of the viewport. */
function offCentre(node: Element): number {
  const r = node.getBoundingClientRect();
  const dx = r.left + r.width / 2 - window.innerWidth / 2;
  const dy = r.top + r.height / 2 - window.innerHeight / 2;
  return Math.hypot(dx, dy);
}

function elect(): void {
  frame = 0;

  let next: Element | null = null;
  let best = Infinity;
  for (const node of onScreen) {
    const d = offCentre(node);
    if (d < best) {
      best = d;
      next = node;
    }
  }

  if (next === winner) return;
  // The incumbent keeps it until it is beaten by more than the tie margin, so
  // a handover happens once rather than twice.
  if (winner && onScreen.has(winner) && offCentre(winner) - best < HOLD) return;

  const previous = winner;
  winner = next;
  if (previous) listeners.get(previous)?.(false);
  if (next) listeners.get(next)?.(true);
}

/** Coalesce scroll, resize and intersection into one measurement per frame. */
function schedule(): void {
  if (frame) return;
  frame = requestAnimationFrame(elect);
}

function shared(): IntersectionObserver | null {
  if (observer) return observer;
  if (typeof IntersectionObserver === 'undefined') return null;
  observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) onScreen.add(entry.target);
      else onScreen.delete(entry.target);
    }
    schedule();
  });
  addEventListener('scroll', schedule, { passive: true });
  addEventListener('resize', schedule);
  // Changing the Size control resizes every tile without moving the page, so
  // the ranking changes with nothing else to announce it.
  subscribeStage(schedule);
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
    schedule();
    return () => {
      io.unobserve(node);
      listeners.delete(node);
      onScreen.delete(node);
      // Filtering the catalog can unmount the tile that held attention; the
      // election has to be told, or the wall stays dark until the next scroll.
      if (winner === node) {
        winner = null;
        schedule();
      }
      setAttended(false);
    };
  }, [node]);

  return attended;
}
