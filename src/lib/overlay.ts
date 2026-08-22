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
   `overflow: hidden` on the body is not enough on iOS — Safari scrolls the
   document anyway — so the body is taken out of flow at its current offset and
   put back afterwards. Counted rather than boolean, because the sync panel can
   open over the detail drawer and the inner one closing must not unlock the
   page under the outer one.
*/
let locks = 0;
let savedScroll = 0;

function lockScroll() {
  if (locks++ > 0) return;
  savedScroll = window.scrollY;
  const { style } = document.body;
  style.position = 'fixed';
  style.top = `-${savedScroll}px`;
  style.left = '0';
  style.right = '0';
  style.width = '100%';
  style.overflow = 'hidden';
}

function unlockScroll() {
  if (locks > 0) locks--;
  if (locks > 0) return;
  const { style } = document.body;
  style.position = '';
  style.top = '';
  style.left = '';
  style.right = '';
  style.width = '';
  style.overflow = '';
  // Taking the body out of flow loses the scroll position; putting it back
  // without this drops the reader at the top of a catalog they had scrolled
  // halfway down.
  window.scrollTo(0, savedScroll);
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

export function useOverlay(ref: RefObject<HTMLElement | null>, onClose: () => void): void {
  useEffect(() => {
    lockScroll();
    return unlockScroll;
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
