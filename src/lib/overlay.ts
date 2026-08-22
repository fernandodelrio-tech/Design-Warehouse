import { useEffect } from 'react';
import type { RefObject } from 'react';

/**
 * What an overlay has to do beyond covering the page.
 *
 * Three things were missing, and on a phone the first of them made the drawer
 * barely usable: opening it did not stop the page behind it scrolling. A drag
 * anywhere the inner pane could not consume — its head, the padding, or the
 * pane already at its end — chained straight through to the document, so the
 * catalog moved under the drawer while the drawer sat still. On a mouse it is
 * a curiosity; on a touchscreen, where every scroll is a drag that starts
 * wherever your thumb lands, it reads as the overlay being frozen.
 *
 * The other two are the rest of the dialog contract this app's own export now
 * hands out: focus belongs inside a modal while it is open and back where it
 * came from when it closes, and Tab must not walk out of it into the page
 * underneath.
 */

/*
   Hidden, NOT taken out of flow.

   The first version set `position: fixed` on the body, which is the usual
   recipe and is the one thing here that must not be done: on iOS Safari a
   fixed body stops `overflow: auto` scrolling inside a fixed overlay as well.
   The lock takes the drawer's own scrolling with it, and the result is a modal
   that cannot be scrolled at all — the background stops moving and so does
   everything else, which is worse than what it fixed.

   So the page is held by `overflow: hidden` on the root and the body, and the
   chaining a fixed body was there to stop is stopped by
   `overscroll-behavior: contain` on the overlay instead. That is what the
   property is for, and no scroller inside the overlay is affected by it.

   Counted rather than boolean, because the sync panel can open over the detail
   drawer and the inner one closing must not unlock the page under the outer.
*/
let locks = 0;

/*
   The overlay's height, MEASURED rather than expressed in a unit.

   Every CSS answer to "how tall is the screen" has been tried against an iPad
   and been wrong. `inset: 0` and `100vh` resolve against a layout viewport
   that includes the strip behind Safari's toolbars, so the panel stretches
   taller than what can be shown and its lower half — the half that scrolls —
   sits under the chrome, cut off. `100dvh` is meant to fix exactly that and
   reportedly still did not.

   `visualViewport.height` is not a unit with semantics to argue about. It is
   the browser reporting the pixels a person can actually see, it updates when
   the toolbars slide or a keyboard opens, and iOS has supported it since 13.
   Read it, put it in a custom property, and let the CSS use that.
*/
function measureViewport() {
  const vv = window.visualViewport;
  const height = vv ? vv.height : window.innerHeight;
  document.documentElement.style.setProperty('--overlay-h', `${Math.round(height)}px`);
}

function watchViewport(): () => void {
  measureViewport();
  const vv = window.visualViewport;
  vv?.addEventListener('resize', measureViewport);
  // The toolbars slide on scroll, which changes the visible height without
  // firing a resize.
  vv?.addEventListener('scroll', measureViewport);
  window.addEventListener('resize', measureViewport);
  window.addEventListener('orientationchange', measureViewport);
  return () => {
    vv?.removeEventListener('resize', measureViewport);
    vv?.removeEventListener('scroll', measureViewport);
    window.removeEventListener('resize', measureViewport);
    window.removeEventListener('orientationchange', measureViewport);
    document.documentElement.style.removeProperty('--overlay-h');
  };
}

function lockScroll() {
  if (locks++ > 0) return;
  document.documentElement.style.overflow = 'hidden';
  document.body.style.overflow = 'hidden';
}

function unlockScroll() {
  if (locks > 0) locks--;
  if (locks > 0) return;
  document.documentElement.style.overflow = '';
  document.body.style.overflow = '';
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

export function useOverlay(ref: RefObject<HTMLElement | null>, onClose: () => void): void {
  useEffect(() => {
    lockScroll();
    const stopWatching = watchViewport();
    return () => {
      stopWatching();
      unlockScroll();
    };
  }, []);

  useEffect(() => {
    const node = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    /*
       The container, not the first control. Focusing the first control means
       focusing a text input, and on a phone that throws the keyboard up over
       the thing the person just opened. The container carries tabindex="-1"
       so it can take focus without joining the tab order.
    */
    node?.focus({ preventScroll: true });

    const visible = (el: HTMLElement) => el.offsetWidth > 0 || el.offsetHeight > 0;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !node) return;
      const stops = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(visible);
      if (!stops.length) return;
      const first = stops[0];
      const last = stops[stops.length - 1];
      const active = document.activeElement;
      // Wrapping at both ends, and from the container itself, which is where
      // focus starts — without that first case Tab left the dialog on the
      // very first press.
      if (event.shiftKey && (active === first || active === node)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      // Back where it came from: the card that opened the drawer, so the
      // catalog can be walked from where it was left rather than from the top.
      previous?.focus?.({ preventScroll: true });
    };
  }, [onClose, ref]);
}
