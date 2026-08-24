import { useCallback, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react';

/**
 * Pinch to zoom a picture, and drag it around once it is zoomed.
 *
 * The preview had one gesture: a click that jumped between fit and full size.
 * That is a mouse's idea of looking closer. On a tablet the natural thing is
 * to pinch, and the natural thing was doing nothing at all.
 *
 * The gestures are handled here rather than left to the browser because the
 * browser's own pinch zooms the whole page — including the drawer, the chrome
 * and the toolbar — when what is wanted is a closer look at one screenshot.
 * That also means taking responsibility for the one-finger case: with
 * `touch-action: none` the pane no longer scrolls by itself, so a single
 * finger at rest is passed back to the scroller by hand. The alternative,
 * letting the browser keep one-finger panning, hands it the two-finger case
 * as well and there is no way to have only half of it.
 */

const MIN = 1;
const MAX = 8;

export interface Zoom {
  scale: number;
  x: number;
  y: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * The nearest ancestor that actually scrolls.
 *
 * Naming one by selector does not survive the layout changing under it: the
 * drawer scrolls as a whole under a thumb and pane by pane with a mouse, and
 * a `closest('.overlay, .detail-preview')` picked whichever came first rather
 * than whichever moves. A drag over the picture then went to a pane with
 * nothing to scroll and the drawer sat still.
 */
export function scrollerAbove(el: HTMLElement | null): HTMLElement | null {
  for (let node = el; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    const scrolls = /(auto|scroll)/.test(style.overflowY);
    if (scrolls && node.scrollHeight - node.clientHeight > 1) return node;
  }
  return null;
}

export function usePinchZoom(scrollerFor: (target: HTMLElement) => HTMLElement | null) {
  const [zoom, setZoom] = useState<Zoom>({ scale: 1, x: 0, y: 0 });
  const points = useRef(new Map<number, { x: number; y: number }>());
  /**
   * The pinch as it stood when the second finger landed: the spread, the
   * transform, the midpoint, and where the picture's own centre sits on
   * screen. That last one is what lets the maths be exact — a transform of
   * `translate(t) scale(s)` turns about the element's centre, so knowing where
   * that centre is turns "keep the point between the fingers still" into one
   * line rather than an approximation.
   */
  const anchor = useRef<
    { dist: number; zoom: Zoom; cx: number; cy: number; ox: number; oy: number } | null
  >(null);
  const lastTap = useRef(0);
  /**
   * The scroller this gesture is driving, resolved once when it starts.
   *
   * Finding it walks up the ancestors calling getComputedStyle and reading
   * scrollHeight against clientHeight — both of which force layout — and that
   * was happening on every pointermove, immediately before writing scrollTop.
   * Read, write, read again at up to 120Hz, in the handler whose whole purpose
   * is to make dragging over the picture feel smooth. It cannot change
   * mid-gesture, so it is looked up on the way down and forgotten on the way
   * up.
   */
  const scroller = useRef<HTMLElement | null>(null);

  const reset = useCallback(() => setZoom({ scale: 1, x: 0, y: 0 }), []);

  const centre = () => {
    const all = [...points.current.values()];
    return {
      x: all.reduce((s, p) => s + p.x, 0) / all.length,
      y: all.reduce((s, p) => s + p.y, 0) / all.length,
    };
  };
  const spread = () => {
    const [a, b] = [...points.current.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    const el = event.currentTarget;
    el.setPointerCapture(event.pointerId);
    if (points.current.size === 0) scroller.current = scrollerFor(el);
    points.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (points.current.size === 2) {
      // The transformed box keeps its centre at (origin + translation), so the
      // origin falls out of the rectangle the browser reports.
      const box = el.getBoundingClientRect();
      const mid = centre();
      anchor.current = {
        dist: spread(),
        zoom,
        cx: mid.x,
        cy: mid.y,
        ox: box.left + box.width / 2 - zoom.x,
        oy: box.top + box.height / 2 - zoom.y,
      };
    }
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const previous = points.current.get(event.pointerId);
    if (!previous) return;
    const now = { x: event.clientX, y: event.clientY };
    points.current.set(event.pointerId, now);

    if (points.current.size >= 2) {
      const start = anchor.current;
      if (!start) return;
      const scale = clamp((spread() / start.dist) * start.zoom.scale, MIN, MAX);
      const here = centre();
      /*
         The point of the picture that was between the fingers stays between
         them. Read that point out of the old transform, then solve for the
         translation that puts it back under the new midpoint at the new scale.
      */
      const ratio = scale / start.zoom.scale;
      setZoom({
        scale,
        x: here.x - start.ox - (start.cx - start.ox - start.zoom.x) * ratio,
        y: here.y - start.oy - (start.cy - start.oy - start.zoom.y) * ratio,
      });
      return;
    }

    const dx = now.x - previous.x;
    const dy = now.y - previous.y;
    if (zoom.scale > 1) {
      setZoom((z) => ({ ...z, x: z.x + dx, y: z.y + dy }));
    } else if (event.pointerType !== 'mouse') {
      /*
         At rest a finger on the picture should still scroll the drawer. The
         pane cannot do it itself — `touch-action: none` is what lets the pinch
         be ours — so the movement is handed to the scroller directly.
      */
      if (scroller.current) scroller.current.scrollTop -= dy;
    }
  };

  const release = (event: ReactPointerEvent<HTMLElement>) => {
    points.current.delete(event.pointerId);
    if (points.current.size < 2) anchor.current = null;
    if (points.current.size === 0) scroller.current = null;
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLElement>) => {
    // Two taps in quick succession: in for a closer look, out again.
    if (points.current.size === 1 && event.pointerType !== 'mouse') {
      const now = Date.now();
      if (now - lastTap.current < 300) {
        setZoom((z) => (z.scale > 1 ? { scale: 1, x: 0, y: 0 } : { scale: 2.5, x: 0, y: 0 }));
        lastTap.current = 0;
      } else {
        lastTap.current = now;
      }
    }
    release(event);
  };

  /** A trackpad pinch and ctrl+wheel both arrive here. */
  const onWheel = (event: ReactWheelEvent<HTMLElement>) => {
    if (!event.ctrlKey) return;
    event.preventDefault();
    setZoom((z) => {
      const scale = clamp(z.scale * (1 - event.deltaY / 200), MIN, MAX);
      return scale === 1 ? { scale: 1, x: 0, y: 0 } : { ...z, scale };
    });
  };

  return {
    zoom,
    reset,
    zoomed: zoom.scale > 1,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: release,
      onWheel,
    },
  };
}
