import { describeColor } from './color';
import type { AutoAnalysis, DesignSpec, PaletteColor } from './types';

/**
 * Names a design after what it looks like.
 *
 * A catalog full of "Pasted design — Aug 21, 02:45" or
 * "Screenshot 2026-08-21 at 10.32.14" is unsearchable and unscannable, so a
 * title is built from the features the analyzer already measured: the colour
 * scheme, the kind of screen, and the accent colour that carries it.
 */

const CATEGORY_LABELS: Record<string, string> = {
  'Web app / dashboard': 'dashboard',
  'Web landing page': 'landing page',
  'Marketing site': 'marketing site',
  'Mobile app screen': 'mobile screen',
  'Full-page web capture': 'page capture',
  'UI component / detail': 'UI detail',
};

/** The colour a person would say the design "is" — its accent, not its background. */
function signatureColor(palette: PaletteColor[]): PaletteColor | null {
  const accent = palette.find((c) => c.role === 'accent');
  if (accent) return accent;

  // No assigned accent: fall back to the most chromatic swatch that covers
  // enough of the canvas to have been a deliberate choice.
  const chromatic = palette
    .filter((c) => c.hsl[1] >= 25 && c.share >= 0.015 && c.hsl[2] > 10 && c.hsl[2] < 94)
    .sort((a, b) => b.hsl[1] * Math.sqrt(b.share) - a.hsl[1] * Math.sqrt(a.share));
  return chromatic[0] ?? null;
}

export function describeDesign(auto: AutoAnalysis, spec: DesignSpec): string {
  const scheme =
    auto.colorScheme === 'dark' ? 'Dark' : auto.colorScheme === 'light' ? 'Light' : '';
  const kind =
    CATEGORY_LABELS[spec.category] ?? spec.category.toLowerCase() ?? 'design';
  const color = signatureColor(auto.palette);

  const words = [scheme];
  // "Dark greyscale dashboard" says more than "Dark dashboard" when the design
  // genuinely has no colour in it.
  if (!color) words.push('greyscale');
  words.push(kind);

  let title = words.filter(Boolean).join(' ');
  if (color) {
    // Avoid "Light mobile screen in light orange": the scheme word already
    // said it, so drop the repeat from the colour's description.
    const name = describeColor(color.hsl).replace(
      new RegExp(`^${scheme.toLowerCase()} `),
      '',
    );
    title += ` in ${name}`;
  }

  return title.charAt(0).toUpperCase() + title.slice(1);
}

/** Filename noise that says nothing about the design. */
const NOISE =
  /\b(screen[ _-]?shot|screen[ _-]?capture|screenshot|cleanshot|lightshot|snip|snap|grab|capture|image|img|photo|pic|picture|pasted|paste|clipboard|untitled|unnamed|document|copy|final|draft|new|at|on|am|pm|utc|gmt|png|jpe?g|jpg|webp|avif|gif|bmp|screen|desktop|monitor|display)\b/gi;

/**
 * True when a filename carries no meaning worth keeping — a camera roll id, a
 * timestamped screenshot, an export counter. Those get a described title
 * instead; a name someone actually chose is always kept.
 */
export function isGenericFileName(name: string): boolean {
  const stripped = separatorsToSpaces(name.replace(/\.[^.]+$/, ''))
    .replace(NOISE, ' ')
    .replace(/[0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Whatever survives must contain a real word, not stray letters like the "x"
  // of "@2x" or the "v" of a version suffix.
  const meaningful = stripped
    .split(' ')
    .filter((word) => word.length >= 3)
    .join('');
  return meaningful.length < 3;
}

/** `_`, `-`, `.` and friends all read as spaces in a filename. */
function separatorsToSpaces(text: string): string {
  return text.replace(/[_\-.:@()[\]{}#+~,]+/g, ' ');
}

export function titleFromFileName(name: string): string {
  const cleaned = separatorsToSpaces(
    name
      .replace(/\.[^.]+$/, '')
      // Retina export suffixes are noise in a title.
      .replace(/@[0-9]+x$/i, ''),
  )
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/**
 * Two screenshots of the same kind of screen describe identically, and a
 * catalog with four "Dark dashboard in vivid blue" entries is no better than
 * four timestamps. Numbers them instead.
 */
export function uniqueTitle(base: string, taken: Set<string>): string {
  if (!taken.has(base)) {
    taken.add(base);
    return base;
  }
  for (let n = 2; ; n++) {
    const candidate = `${base} ${n}`;
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
}
