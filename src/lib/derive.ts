/**
 * What the pixels could not say, worked out from what they did.
 *
 * A bitmap holds no font name, and a page whose palette is five greys holds no
 * accent — so those fields came out of the analyzer empty, and the exporter
 * drops an empty field. The result was a spec that said nothing where it could
 * have said something useful, and a design applied from it inherited the gap:
 * no accent, no type character, a base size the target had to guess.
 *
 * Blank is honest and it is not the only honest option. A value derived from
 * the measurements, labelled as derived, is more useful than silence and
 * exactly as truthful — which is why PRODUCT.md lists "leave it blank rather
 * than guess" as a current choice and not a commitment.
 *
 * Everything here is DERIVED, never measured, and every string it produces
 * says so. That is the second product principle doing its job: the reader has
 * to be able to tell a reading from a recommendation at a glance.
 */
import { contrastRatio, hexToRgb, rgbToHsl, toHex } from './color';
import type { AutoAnalysis, PaletteColor } from './types';

/** How a value came to be. Measured and estimated are the analyzer's; this is ours. */
export const DERIVED = 'derived, not measured';

/* --- an accent, where the capture holds none ------------------------------ */

function hsl(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHsl(r, g, b);
}

function fromHsl(h: number, s: number, l: number): string {
  // Standard HSL -> RGB, kept local so lib/color stays the measuring surface.
  const c = (1 - Math.abs((2 * l) / 100 - 1)) * (s / 100);
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l / 100 - c / 2;
  const [r, g, b] =
    h < 60 ? [c, x, 0] :
    h < 120 ? [x, c, 0] :
    h < 180 ? [0, c, x] :
    h < 240 ? [0, x, c] :
    h < 300 ? [x, 0, c] : [c, 0, x];
  return toHex(Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255));
}

export interface DerivedAccent {
  hex: string;
  /** The reasoning, in one sentence, for the exported spec. */
  why: string;
  /** Its ratio against the page, so the reader can spend it correctly. */
  onBackground: number;
}

/**
 * An accent for a palette that has none.
 *
 * Not a colour off a wheel in the abstract — the hue is taken from the page's
 * own dominant colour and turned to its complement, which is the one relation
 * guaranteed to sit apart from everything already there. Lightness is then
 * walked until the result clears 3:1 on the background, because an accent that
 * cannot be told from the page is not an accent, and 3:1 is what a non-text
 * mark needs.
 *
 * On a neutral page — five greys, no hue to complement — the wheel has nothing
 * to say, so the hue comes from the warm end of the spectrum at a restrained
 * saturation. That is a convention and the sentence says so.
 */
export function deriveAccent(palette: PaletteColor[], background: string): DerivedAccent | null {
  if (palette.some((c) => c.role === 'accent')) return null;
  if (!background) return null;

  const bgL = hsl(background)[2];
  // Enough chroma anywhere in the palette to have a hue worth answering?
  const chromatic = palette.filter((c) => hsl(c.hex)[1] >= 12);
  const neutral = chromatic.length === 0;

  const source = neutral
    ? null
    : chromatic.reduce((best, c) => (hsl(c.hex)[1] > hsl(best.hex)[1] ? c : best));
  const hue = neutral ? 24 : (hsl(source!.hex)[0] + 180) % 360;
  const sat = neutral ? 62 : Math.min(78, Math.max(45, hsl(source!.hex)[1] + 10));

  // Walk lightness away from the page until the mark can be seen on it.
  let hex = fromHsl(hue, sat, bgL > 50 ? 42 : 62);
  for (let step = 0; step < 24; step++) {
    if (contrastRatio(hex, background) >= 3) break;
    const l = bgL > 50 ? 42 - step * 2 : 62 + step * 2;
    if (l < 8 || l > 92) break;
    hex = fromHsl(hue, sat, l);
  }

  const ratio = Math.round(contrastRatio(hex, background) * 100) / 100;
  return {
    hex,
    onBackground: ratio,
    why: neutral
      ? `${hex} — ${DERIVED}. This capture holds no hue to answer: every colour in it is ` +
        `neutral, so the wheel has nothing to say and this is a convention rather than a ` +
        `derivation — a restrained warm mark, walked to ${ratio}:1 on the page so it can be ` +
        `seen. Treat it as a suggestion the design never made, and replace it if the product ` +
        `has a colour of its own.`
      : `${hex} — ${DERIVED}. The capture names no accent, so this is the complement of its ` +
        `most saturated colour (${source!.hex}), walked in lightness until it reads ${ratio}:1 ` +
        `on the page. It is the one hue guaranteed to sit apart from what is already there. ` +
        `Spend it as a fill and a mark; check it against text before writing in it.`,
  };
}

/* --- a type recommendation, where the bitmap holds no name ---------------- */

export interface DerivedType {
  heading: string;
  body: string;
  mono: string;
  baseSize: string;
  why: string;
}

/**
 * Faces the measurements argue for, rather than a house favourite.
 *
 * Three things in the capture decide it, and each is measured: how much of the
 * canvas carries detail, how far the type ladder travels from its body to its
 * top, and whether the page is warm or cool. A dense page with a short ladder
 * is an application and wants a workhorse; a sparse page with a long ladder is
 * a document and can afford a face with an opinion at the top of it.
 *
 * The base size is derived from the measured body ink rather than guessed: ink
 * height understates the em by roughly a third across common faces, so the body
 * is the measured ink taken back up and rounded to the nearest even pixel.
 */
export function deriveType(auto: AutoAnalysis, bodyInk: number | null): DerivedType {
  const dense = auto.layout.densityLabel === 'dense';
  const steps = auto.detail?.text?.steps ?? [];
  const top = steps.length ? Math.max(...steps.map((s) => s.px)) : 0;
  const ladder = bodyInk && top ? top / bodyInk : 0;
  const expressive = !dense && ladder >= 3;
  const warm = auto.palette.some((c) => {
    const [h, s] = hsl(c.hex);
    return s >= 15 && (h <= 60 || h >= 330);
  });

  /*
     Ink height understates the em: a line with no ascenders has none to
     measure, and across the faces this app is likely to meet the shortfall
     runs about a third. So the body is the ink taken up by 1.45 and rounded to
     an even pixel, which lands a 9px ink on 14 and an 11px ink on 16.
  */
  const base = bodyInk ? Math.max(12, Math.round((bodyInk * 1.45) / 2) * 2) : 16;

  const heading = expressive
    ? warm
      ? "'Fraunces', 'Iowan Old Style', Georgia, serif"
      : "'Newsreader', 'Iowan Old Style', Georgia, serif"
    : "'Public Sans', 'Inter', system-ui, sans-serif";
  const body = expressive
    ? "'Public Sans', 'Inter', system-ui, sans-serif"
    : "'Public Sans', 'Inter', system-ui, sans-serif";

  return {
    heading,
    body,
    mono: "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
    baseSize: `${base}px`,
    why:
      `Families are ${DERIVED} — a bitmap holds no font name, so nothing here read one. ` +
      `What IS measured is the case for them: this page is ${auto.layout.densityLabel} ` +
      `(${Math.round(auto.layout.density * 100)}% of the canvas carries detail)` +
      (ladder ? ` and its type ladder travels ${ladder.toFixed(1)}x from body to top` : '') +
      `, which reads as ${expressive ? 'a document that can afford a display face with an opinion at its top' : 'an application, where a workhorse that holds up at label sizes matters more than character'}. ` +
      `The base size is derived from the measured body ink${bodyInk ? ` of ${bodyInk}px` : ''}, ` +
      `taken back up because ink height understates the em. Replace any of it the moment the ` +
      `real faces are known — these are an argument from the measurements, not a reading of them.`,
  };
}
