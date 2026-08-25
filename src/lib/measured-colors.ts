/**
 * The grounds a measurement is drawn on.
 *
 * Two places now draw the measured geometry rather than describing it — the
 * drawer's `MeasuredDetail` and the wall's `CardOverlay` — and a radius that
 * looked one way in the tile and another way in the drawer would be a third
 * thing to reconcile rather than the same fact seen twice. These are the rules
 * both obey.
 */
import { contrastRatio, isLight } from './color';
import type { PaletteColor } from './types';

/** The page the design sat on. */
export function groundOf(palette: PaletteColor[]): string {
  return palette.find((c) => c.role === 'background')?.hex ?? '#ffffff';
}

/**
 * The fill for a sample: the design's own surface.
 *
 * Not the highest-contrast colour in the palette — that picks the text ink and
 * draws a black slab, which is not what a radius was measured off. A card on
 * its ground is, so the sample is the surface on the background, exactly as
 * the capture had it.
 */
export function surfaceOf(palette: PaletteColor[]): string {
  return (
    palette.find((c) => c.role === 'surface')?.hex ??
    palette.find((c) => c.role === 'background')?.hex ??
    '#ffffff'
  );
}

/**
 * Surface and background are routinely within a point of each other on a dark
 * design, which leaves the sample invisible. A hairline of the ground's own
 * ink keeps the shape readable without pretending to be a measurement — the
 * measured border is reported separately, with its own figure.
 */
export function edgeFor(bg: string, fill: string): string {
  if (contrastRatio(bg, fill) >= 1.25) return 'transparent';
  return isLight(bg) ? 'rgb(0 0 0 / 0.22)' : 'rgb(255 255 255 / 0.28)';
}
