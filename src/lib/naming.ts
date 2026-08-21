import type { AutoAnalysis, DesignSpec, PaletteColor } from './types';

/**
 * Gives a design a name worth remembering.
 *
 * "Dark dashboard in vivid red" is accurate and forgettable — it reads as a row
 * of fields, and a catalog of them is hard to hold in your head. The name here
 * is evocative instead ("Ember Console", "Glacier Overture"), and the factual
 * line under it on the card keeps carrying the measurements.
 *
 * Everything is deterministic: the same design always earns the same name, with
 * no model call, so this works offline and in the packaged app.
 */

/** Hue bucket → words that feel like that hue. Upper bound of each bucket, in degrees. */
const HUE_WORDS: Array<[number, string[]]> = [
  [15, ['Ember', 'Crimson', 'Scarlet', 'Vermilion', 'Cinnabar', 'Poppy']],
  [45, ['Amber', 'Marigold', 'Copper', 'Apricot', 'Tangerine', 'Ochre']],
  [70, ['Saffron', 'Honey', 'Citrine', 'Gilt', 'Chamomile']],
  [100, ['Chartreuse', 'Lichen', 'Meadow', 'Verdant']],
  [150, ['Fern', 'Jade', 'Moss', 'Juniper', 'Clover', 'Basil']],
  [180, ['Verdigris', 'Seafoam', 'Cypress', 'Eucalypt']],
  [200, ['Lagoon', 'Glacier', 'Tidewater', 'Cyan']],
  [240, ['Cobalt', 'Azure', 'Sapphire', 'Harbour', 'Marine']],
  [280, ['Indigo', 'Iris', 'Ultramarine', 'Twilight', 'Periwinkle']],
  [310, ['Amethyst', 'Orchid', 'Mulberry', 'Heliotrope', 'Violet']],
  [345, ['Rose', 'Blossom', 'Peony', 'Coral', 'Fuchsia']],
  [360, ['Ember', 'Crimson', 'Scarlet', 'Vermilion']],
];

const DARK_NEUTRALS = ['Onyx', 'Obsidian', 'Graphite', 'Basalt', 'Ink', 'Charcoal'];
const LIGHT_NEUTRALS = ['Linen', 'Ivory', 'Chalk', 'Porcelain', 'Alabaster', 'Pearl'];
const MID_NEUTRALS = ['Slate', 'Pewter', 'Flint', 'Dove', 'Ash'];

/** Category → what to call the thing. */
const CATEGORY_NOUNS: Record<string, string[]> = {
  'Web app / dashboard': ['Console', 'Cockpit', 'Bridge', 'Observatory', 'Control Room', 'Panel'],
  'Web landing page': ['Overture', 'Marquee', 'Threshold', 'Frontispiece', 'Invitation', 'Prospect'],
  'Marketing site': ['Showcase', 'Pavilion', 'Billboard', 'Gallery', 'Parade'],
  'Mobile app screen': ['Pocket', 'Companion', 'Handheld', 'Palmtop', 'Pane'],
  'Full-page web capture': ['Broadsheet', 'Scroll', 'Panorama', 'Longform', 'Expanse'],
  'UI component / detail': ['Fragment', 'Vignette', 'Inlay', 'Facet', 'Detail'],
  'Design system page': ['Almanac', 'Codex', 'Lexicon', 'Compendium'],
  'Email template': ['Dispatch', 'Missive', 'Bulletin', 'Letter'],
  'Onboarding flow': ['Welcome', 'Doorway', 'Onramp', 'Prologue'],
  'Settings / preferences': ['Workshop', 'Dials', 'Cabinet', 'Switchboard'],
  'Pricing page': ['Ledger', 'Tariff', 'Menu', 'Counter'],
  'Checkout / payment': ['Till', 'Counter', 'Register', 'Checkout'],
  'Data table / list view': ['Register', 'Manifest', 'Index', 'Roster'],
  'Editor / canvas tool': ['Atelier', 'Studio', 'Workbench', 'Drafting Table'],
};

const DEFAULT_NOUNS = ['Study', 'Composition', 'Arrangement', 'Sketch'];

/** FNV-1a: small, stable, and enough to spread names across the vocabulary. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** The colour a person would say the design "is" — its accent, not its background. */
export function signatureColor(palette: PaletteColor[]): PaletteColor | null {
  const accent = palette.find((c) => c.role === 'accent');
  if (accent) return accent;
  const chromatic = palette
    .filter((c) => c.hsl[1] >= 25 && c.share >= 0.015 && c.hsl[2] > 10 && c.hsl[2] < 94)
    .sort((a, b) => b.hsl[1] * Math.sqrt(b.share) - a.hsl[1] * Math.sqrt(a.share));
  return chromatic[0] ?? null;
}

function paletteWords(auto: AutoAnalysis): string[] {
  const color = signatureColor(auto.palette);
  if (color) return HUE_WORDS.find(([max]) => color.hsl[0] <= max)?.[1] ?? MID_NEUTRALS;
  // Nothing chromatic to name it after, so name it after its weight instead.
  if (auto.colorScheme === 'dark') return DARK_NEUTRALS;
  if (auto.colorScheme === 'light') return LIGHT_NEUTRALS;
  return MID_NEUTRALS;
}

/** Every name this design could plausibly carry, in a stable but design-specific order. */
function candidates(auto: AutoAnalysis, spec: DesignSpec): string[] {
  const words = paletteWords(auto);
  const nouns = CATEGORY_NOUNS[spec.category] ?? DEFAULT_NOUNS;

  const seed = hash(
    [
      spec.category,
      auto.colorScheme,
      auto.saturation,
      auto.layout.columns,
      auto.layout.densityLabel,
      ...auto.palette.map((c) => c.hex),
    ].join('|'),
  );

  const names: string[] = [];
  // Walk both lists from a design-specific offset so two red dashboards do not
  // both land on the first combination, while each stays reproducible.
  for (let i = 0; i < words.length; i++) {
    for (let j = 0; j < nouns.length; j++) {
      const word = words[(seed + i) % words.length];
      // Stride by 1, not by a constant: a stride sharing a factor with the list
      // length only ever reaches a fraction of the nouns.
      const noun = nouns[(seed + i + j) % nouns.length];
      const name = `${word} ${noun}`;
      if (!names.includes(name)) names.push(name);
    }
  }
  return names;
}

/**
 * Picks the first name this design has not already used in the catalog, so a
 * second red dashboard becomes "Crimson Cockpit" rather than "Ember Console 2".
 * Numbering is only the last resort.
 */
export function nameDesign(
  auto: AutoAnalysis,
  spec: DesignSpec,
  taken: Set<string>,
): string {
  const options = candidates(auto, spec);
  for (const name of options) {
    if (!taken.has(name)) {
      taken.add(name);
      return name;
    }
  }
  const base = options[0] ?? 'Untitled design';
  for (let n = 2; ; n++) {
    const candidate = `${base} ${n}`;
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
}
