import type { ContrastPair } from './types';

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function toHex(r: number, g: number, b: number): string {
  const h = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

export function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '').trim();
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean.padEnd(6, '0').slice(0, 6);
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn:
        h = (gn - bn) / d + (gn < bn ? 6 : 0);
        break;
      case gn:
        h = (bn - rn) / d + 2;
        break;
      default:
        h = (rn - gn) / d + 4;
    }
    h /= 6;
  }
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

/** Relative luminance per WCAG 2.1. */
export function luminance(r: number, g: number, b: number): number {
  const chan = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
}

export function contrastRatio(a: string, b: string): number {
  const la = luminance(...hexToRgb(a));
  const lb = luminance(...hexToRgb(b));
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export function ratingFor(ratio: number): ContrastPair['rating'] {
  if (ratio >= 7) return 'AAA';
  if (ratio >= 4.5) return 'AA';
  if (ratio >= 3) return 'AA Large';
  return 'Fail';
}

/** Perceptual-ish distance in a weighted RGB space. Cheap and good enough for grouping. */
export function colorDistance(
  a: [number, number, number],
  b: [number, number, number],
): number {
  const rmean = (a[0] + b[0]) / 2;
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(
    (2 + rmean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rmean) / 256) * db * db,
  );
}

const HUE_NAMES: Array<[number, string]> = [
  [15, 'red'],
  [45, 'orange'],
  [70, 'yellow'],
  [100, 'lime'],
  [150, 'green'],
  [180, 'teal'],
  [200, 'cyan'],
  [240, 'blue'],
  [280, 'indigo'],
  [310, 'purple'],
  [345, 'pink'],
  [360, 'red'],
];

/** A short human label like "deep blue" or "off-white". */
export function describeColor(hsl: [number, number, number]): string {
  const [h, s, l] = hsl;
  if (l >= 96) return 'white';
  if (l <= 5) return 'black';
  if (s <= 8) {
    if (l >= 88) return 'off-white';
    if (l >= 70) return 'light grey';
    if (l >= 40) return 'grey';
    if (l >= 18) return 'charcoal';
    return 'near-black';
  }
  const hue = HUE_NAMES.find(([max]) => h <= max)?.[1] ?? 'red';
  const tone =
    l >= 82 ? 'pale ' : l >= 62 ? 'light ' : l >= 38 ? '' : l >= 20 ? 'deep ' : 'dark ';
  const chroma = s >= 75 ? 'vivid ' : s <= 25 ? 'muted ' : '';
  return `${tone}${chroma}${hue}`.trim().replace(/\s+/g, ' ');
}

export function isLight(hex: string): boolean {
  return luminance(...hexToRgb(hex)) > 0.45;
}

/**
 * Black or white, whichever actually reads better on this colour.
 *
 * A luminance threshold gets mid-tones wrong: a mid green sits just under the
 * midpoint, so it was handed white at 2.28:1 when black would have given 7.6:1.
 * Comparing the two ratios is the same cost and never picks the worse one.
 */
export function readableOn(hex: string): string {
  return contrastRatio(hex, '#111111') >= contrastRatio(hex, '#ffffff') ? '#111111' : '#ffffff';
}
