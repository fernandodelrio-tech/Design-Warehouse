/**
 * Which tile is showing its measurement sheet, on a device with no pointer.
 *
 * The overlay is meant for one tile at a time — that is the composition. With
 * a mouse, hover and focus say which one. A touch screen has neither, and this
 * is the third answer to that.
 *
 * The first showed every sheet at once, which is not "data on demand": it put
 * 150px of slab on every one of two hundred tiles and gave the wall back to
 * metadata, the exact arrangement the sheet was built to replace.
 *
 * The second let scrolling decide — whichever tile held the middle of the
 * viewport carried the sheet. It read well in principle and badly in the hand.
 * Attention arrived unasked while the thumb was somewhere else entirely, so a
 * sheet you did not call up covered a picture you were trying to look at, and
 * the wall changed under you as you moved through it. Scrolling is how you
 * look at a wall, not how you ask it a question.
 *
 * So the tap asks. A tap on a tile paints its sheet; a second tap on the same
 * tile opens the design; a tap anywhere else puts the sheet away. Nothing
 * appears that was not asked for, and the wall stays pictures until it is.
 *
 * The cost is honest and worth naming: opening a design on touch is now two
 * taps rather than one. The contract calls opening the primary action, and
 * this demotes it half a step. It buys the thing the contract wanted more —
 * "he picks without opening anything" — because the sheet is what decides, and
 * a sheet you can call up on demand is worth more than one taken for granted.
 *
 * A pointer device never enters any of this. Hover and focus already say what
 * is being attended to, and this store stays empty there.
 */
import { useCallback, useEffect, useSyncExternalStore } from 'react';

/** The tile showing its sheet, by record id. At most one, ever. */
let attended: string | null = null;

const subscribers = new Set<() => void>();

function publish(): void {
  for (const notify of subscribers) notify();
}

const subscribe = (notify: () => void) => {
  subscribers.add(notify);
  return () => {
    subscribers.delete(notify);
  };
};

/*
   Whether this device is one that taps.

   Watched rather than read once: an iPad with a keyboard case attached gains a
   pointer mid-session, and a tile that still wanted two taps after the trackpad
   arrived would be a tile that ignores the hardware in front of it.
*/
const coarseQuery = typeof matchMedia === 'undefined' ? null : matchMedia('(hover: none)');
let coarse = coarseQuery?.matches ?? false;

coarseQuery?.addEventListener('change', (event) => {
  coarse = event.matches;
  // A sheet held open by a tap has no way to be dismissed once hover takes
  // over, so gaining a pointer clears it.
  if (!coarse) attended = null;
  publish();
});

const readCoarse = () => coarse;

/** True where a tap is what reveals a sheet, rather than a pointer. */
export function useTapReveals(): boolean {
  return useSyncExternalStore(subscribe, readCoarse, () => false);
}

/*
   A tap outside every tile puts the sheet away.

   Capture phase, so it is decided before the tile's own handler runs and
   cannot be swallowed by anything in between. Bound once, on the first tile to
   mount on a touch device, and never on a pointer device at all.
*/
let dismissBound = false;

function bindDismiss(): void {
  if (dismissBound || typeof document === 'undefined') return;
  dismissBound = true;
  document.addEventListener(
    'pointerdown',
    (event) => {
      if (!attended) return;
      const target = event.target;
      // Inside any tile is that tile's business: it either moves attention to
      // itself or opens, and either way this is not the one to decide.
      if (target instanceof Element && target.closest('.card')) return;
      attended = null;
      publish();
    },
    true,
  );
}

/** Show this tile's sheet, and put away whichever one was up. */
export function attend(id: string): void {
  if (attended === id) return;
  attended = id;
  publish();
}

/** Put away whatever sheet is up. */
export function dismiss(): void {
  if (attended === null) return;
  attended = null;
  publish();
}

/** True when this tile is the one showing its sheet. */
export function useAttention(id: string): boolean {
  const read = useCallback(() => attended === id, [id]);
  const isAttended = useSyncExternalStore(subscribe, read, () => false);

  useEffect(() => {
    if (!coarse) return;
    bindDismiss();
    return () => {
      // Filtering the catalog unmounts tiles, and a sheet belonging to a tile
      // that is no longer on the wall would keep the store pointing at nothing.
      if (attended === id) {
        attended = null;
        publish();
      }
    };
  }, [id]);

  return isAttended;
}
