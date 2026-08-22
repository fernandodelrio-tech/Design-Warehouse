/**
 * What the copied prompt should be applied to.
 *
 * The prompt a design produces is an instruction to restyle something, so it
 * needs a target. Rather than making you type one into the chat every time,
 * the app remembers it here and bakes it into the text on the clipboard.
 *
 * This lives on the device, not in the catalog and not in Drive. A target
 * describes the project you happen to have open — "the admin dashboard", "this
 * repo's UI" — not the design, so attaching it to a record would sync one
 * machine's working context to every other one and put it in the spec that
 * Claude reads. Held per device, it is right far more often than not: you
 * usually apply several designs to the same thing in a row.
 */

const CURRENT_KEY = 'dw-apply-target';
const RECENT_KEY = 'dw-apply-recent';
const MAX_RECENT = 8;
/** Long enough for a sentence of context, short enough to stay a target. */
export const MAX_TARGET = 160;

function read(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    // Private browsing, or storage is full. The prompt falls back to asking.
    return '';
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Nothing to do: the target is a convenience, never the only way through.
  }
}

export function normalizeTarget(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, MAX_TARGET);
}

/** The target as it stands, ready to prefill the field. */
export function currentTarget(): string {
  return normalizeTarget(read(CURRENT_KEY));
}

/** Called as the field is edited; does not touch the recent list. */
export function setCurrentTarget(value: string): void {
  write(CURRENT_KEY, normalizeTarget(value));
}

/** Targets that have actually been used, most recent first. */
export function recentTargets(): string[] {
  try {
    const raw = JSON.parse(read(RECENT_KEY) || '[]') as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter((v): v is string => typeof v === 'string' && v.length > 0);
  } catch {
    return [];
  }
}

/**
 * Records a target as used. Only called when a prompt is copied, so the list
 * holds things you actually applied a design to rather than every keystroke on
 * the way to typing one.
 */
export function rememberTarget(value: string): void {
  const target = normalizeTarget(value);
  if (!target) return;
  setCurrentTarget(target);
  const next = [target, ...recentTargets().filter((t) => t !== target)].slice(0, MAX_RECENT);
  write(RECENT_KEY, JSON.stringify(next));
}
