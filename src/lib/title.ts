/**
 * Decides whether a filename is worth keeping as a title.
 *
 * A name someone chose says more than anything generated; a camera-roll id or a
 * timestamped screenshot says nothing, and those get named by `naming.ts`
 * instead.
 */

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
