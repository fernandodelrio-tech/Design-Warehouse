import { describeAspect, loadBitmap, makeThumbnail, sampleDetail, samplePixels } from './image';
import { estimateLayout } from './layout';
import { findBlocks, measureDetail } from './measure';
import { measureStructure } from './structure';
import { extractPalette } from './palette';
import type {
  AutoAnalysis,
  ColorToken,
  DesignSpec,
  ImageMeta,
  PaletteColor,
} from './types';

export const ANALYZER_VERSION = 3;

export interface AnalysisResult {
  image: ImageMeta;
  auto: AutoAnalysis;
  thumb: Blob;
}

export async function analyzeBlob(blob: Blob): Promise<AnalysisResult> {
  const bitmap = await loadBitmap(blob);
  try {
    const thumb = await makeThumbnail(bitmap);
    const sample = samplePixels(bitmap);
    const paletteResult = extractPalette(sample.data, sample.width, sample.height);
    const layout = estimateLayout(sample.data, sample.width, sample.height);
    // A second, much finer pass: radius, hairlines, elevation and text sizes
    // are all invisible at the 320px the palette and layout run on.
    const fine = sampleDetail(bitmap);
    // One flood fill answers both passes. Running it twice — once for the
    // radius, once for the inventory — doubled the time to catalogue a 2560px
    // screenshot for no extra information.
    const blocks = findBlocks(
      fine.data, fine.width, fine.height,
      Math.max(8, Math.round(64 / fine.scale)),
      10,
    );
    const detail = measureDetail(fine, blocks);
    const structure = measureStructure(fine, blocks);

    const image: ImageMeta = {
      width: bitmap.width,
      height: bitmap.height,
      aspectRatio: Math.round((bitmap.width / bitmap.height) * 1000) / 1000,
      orientation:
        bitmap.width > bitmap.height
          ? 'landscape'
          : bitmap.width < bitmap.height
            ? 'portrait'
            : 'square',
      byteSize: blob.size,
      mimeType: blob.type || 'image/png',
    };

    const auto: AutoAnalysis = {
      version: ANALYZER_VERSION,
      extractedAt: Date.now(),
      palette: paletteResult.palette,
      averageLuminance: Math.round(paletteResult.averageLuminance * 1000) / 1000,
      colorScheme: paletteResult.colorScheme,
      saturation: paletteResult.saturation,
      contrastPairs: paletteResult.contrastPairs,
      layout,
      detail,
      structure,
    };

    return { image, auto, thumb };
  } finally {
    bitmap.close();
  }
}

const TYPE_STEPS = ['Display', 'H1', 'H2', 'H3', 'Body', 'Small', 'Caption'];

function tokensFromPalette(palette: PaletteColor[]): ColorToken[] {
  const usageByRole: Record<PaletteColor['role'], string> = {
    background: 'Page background',
    surface: 'Cards, panels, raised surfaces',
    text: 'Primary text',
    accent: 'Primary action, links, highlights',
    border: 'Hairlines, dividers, input borders',
    muted: 'Secondary text and de-emphasised fills',
  };
  const seen = new Map<string, number>();
  return palette.map((color) => {
    const count = (seen.get(color.role) ?? 0) + 1;
    seen.set(color.role, count);
    const name = count === 1 ? color.role : `${color.role}-${count}`;
    return {
      name,
      value: color.hex,
      usage: count === 1 ? usageByRole[color.role] : `${usageByRole[color.role]} (variant)`,
    };
  });
}

function guessCategory(image: ImageMeta, auto: AutoAnalysis): { category: string; platform: string } {
  const ratio = image.aspectRatio;
  if (ratio >= 1.2) {
    const appLike = auto.layout.densityLabel === 'dense' || auto.layout.columns >= 3;
    return {
      category: appLike ? 'Web app / dashboard' : 'Web landing page',
      platform: 'Web — desktop',
    };
  }
  if (ratio <= 0.75 && image.width <= 900) {
    return { category: 'Mobile app screen', platform: 'Mobile — iOS / Android' };
  }
  if (ratio <= 0.75) {
    return { category: 'Full-page web capture', platform: 'Web — full page' };
  }
  return { category: 'UI component / detail', platform: 'Web' };
}

function guessStyleKeywords(auto: AutoAnalysis): string[] {
  const words: string[] = [];
  words.push(auto.colorScheme === 'dark' ? 'dark mode' : auto.colorScheme === 'light' ? 'light mode' : 'mixed light/dark');
  if (auto.saturation === 'vivid') words.push('vivid accents');
  if (auto.saturation === 'muted') words.push('muted palette');
  if (auto.layout.whitespaceRatio >= 0.6) words.push('generous whitespace');
  if (auto.layout.densityLabel === 'dense') words.push('information dense');
  if (auto.layout.columns >= 3) words.push('multi-column grid');
  return words;
}

/**
 * Seed a spec from the analysis. Anything the pixels cannot honestly tell us —
 * font families above all — is left blank rather than invented, so a spec is
 * never confidently wrong when Claude reads it back.
 */
/**
 * The measured detail, written into the editable spec.
 *
 * These fields used to start blank, so every prompt the app exported told its
 * reader to choose a radius, a border and a type scale. They are measurements
 * now, and still text fields — correct any of them and the correction is what
 * exports.
 */
function seedFromDetail(detail: AutoAnalysis['detail']) {
  const radius = detail?.radius ? `${detail.radius.px}px` : '';
  const borders = detail?.border ? `${detail.border.px}px ${detail.border.hex}` : '';
  const shadows = detail?.shadow
    ? `Soft elevation, about ${detail.shadow.spread}px of falloff at ${detail.shadow.strength}/255 at its darkest`
    : detail
      ? 'No elevation measured — blocks step straight to the page'
      : '';

  /*
     The named steps are anchored on the body, not on the top of the ladder.
     Assigning the largest measured row to "Display" called a 19px heading a
     display size in a design whose largest text was 19px — the ladder has to
     be placed by what the page mostly is, and the row height occurring on the
     most lines is the body.
  */
  const steps = (detail?.text?.steps ?? []).slice().sort((a, b) => b.px - a.px);
  const leading = (detail?.text?.leading ?? []).slice().sort((a, b) => b - a);
  const bodyIndex = TYPE_STEPS.indexOf('Body');
  let mostRows = 0;
  let bodyStep = -1;
  steps.forEach((step, i) => {
    if (step.rows > mostRows) ((mostRows = step.rows), (bodyStep = i));
  });
  const offset = bodyStep >= 0 ? bodyIndex - bodyStep : 0;
  const scale = TYPE_STEPS.map((name, i) => {
    const step = steps[i - offset];
    return {
      name,
      size: step ? `~${step.px}px` : '',
      weight: '',
      lineHeight: step && leading[i - offset] !== undefined ? `~${leading[i - offset]}px` : '',
      letterSpacing: '',
    };
  });

  const notes = detail?.text
    ? `${detail.text.samples} text rows measured, the most common one taken as Body. ` +
      'The sizes above are ink heights — the height of the glyphs themselves — which ' +
      'understates font size, since a line with no ascenders has none to measure. Treat ' +
      'the ratios between the steps as firmer than the absolute figures. Font families ' +
      'cannot be read off a bitmap and are not guessed.'
    : '';

  return { radius, borders, shadows, scale, notes };
}

/**
 * The structure, written into the spec — and, for the handful of things a
 * still frame genuinely cannot show, a stated convention instead.
 *
 * Breakpoints, motion and hover states are not in the pixels: a screenshot is
 * one width in one state. Leaving them blank was worse than useless, though —
 * the prompt just told its reader to invent them, and five designs in a row
 * got five different answers. So they are written here as conventions, each
 * one labelled as a convention and each one derived from something that *was*
 * measured, so it at least suits the design it is attached to.
 */
function seedFromStructure(image: ImageMeta, auto: AutoAnalysis) {
  const s = auto.structure;
  const frame = s?.frame ?? null;
  const accent = auto.palette.find((c) => c.role === 'accent')?.hex ?? '';
  const border = auto.detail?.border?.hex ?? auto.palette.find((c) => c.role === 'border')?.hex ?? '';
  const radius = auto.detail?.radius ? `${auto.detail.radius.px}px` : '';

  const maxWidth = frame
    ? `Content spans ~${frame.contentWidth}px of the ${image.width}px capture` +
      (frame.marginLeft === frame.marginRight
        ? `, centred with ~${frame.marginLeft}px either side`
        : `, ~${frame.marginLeft}px left and ~${frame.marginRight}px right of it`)
    : '';

  const gutter = frame
    ? frame.gutter !== null
      ? `~${frame.gutter}px between columns (${frame.gutterSamples} gaps measured)`
      : 'No column gap measured — the content reads as one column'
    : '';

  /*
     A capture is one width, so the ladder below it is a convention. It is
     anchored on the width actually captured rather than a stock list, so the
     design's own layout is the largest step rather than something it has to be
     squeezed into.
  */
  const captured = image.width;
  const ladder = [1440, 1024, 768, 480].filter((b) => b < captured);
  const breakpoints = frame
    ? `Convention, not measured — a still frame has one width. Treat ${captured}px as the ` +
      `design width and step down at ${[captured, ...ladder].join(' / ')}px, collapsing to a ` +
      `single column below 768px.`
    : '';

  const gradients = s?.gradient
    ? `A ${s.gradient.axis} ramp across the page from ${s.gradient.from} to ${s.gradient.to}, ` +
      `holding across ${Math.round(s.gradient.coverage * 100)}% of the scan lines`
    : s
      ? 'No gradient measured — fills are flat colour'
      : '';

  const imagery = s?.imagery
    ? s.imagery.coverage > 0 && s.imagery.box
      ? `Photographic content over ~${Math.round(s.imagery.coverage * 100)}% of the canvas, ` +
        `concentrated in a ${s.imagery.box.w}×${s.imagery.box.h}px region at ` +
        `${s.imagery.box.x},${s.imagery.box.y}`
      : 'No photographic regions — the page is flat colour and type throughout'
    : '';

  const iconography = s?.icons
    ? `${s.icons.count} small square shapes at ~${s.icons.px}px. Convention for what the ` +
      `bitmap cannot show: line icons at that size on a 24px grid, stroke matched to the ` +
      `body text weight, corners following the ${radius || 'page'} radius.`
    : s
      ? 'No icon-sized shapes measured — the design carries its meaning in type and colour'
      : '';

  const blur = s
    ? 'Convention, not measured — a flat capture cannot show translucency. None: surfaces are ' +
      'opaque, and depth comes from the elevation above rather than from blur.'
    : '';

  const animation = s
    ? 'Convention, not measured — a still frame has no motion. 150ms ease-out on colour and ' +
      'background, 200ms on transform, nothing longer than 250ms, and honour ' +
      'prefers-reduced-motion by dropping to opacity alone.'
    : '';

  const components = s ? s.components.slice() : [];
  if (s && components.length === 0) {
    components.push(
      `No repeated blocks measured across ${s.blocks} solid regions — this capture reads as a ` +
        'single composition rather than a component set',
    );
  }

  const interactions = s
    ? [
        'Convention, not measured — a screenshot has one state. Derived from the measured tokens:',
        accent
          ? `hover shifts ${accent} toward the light rather than darkening it (darkening a ` +
            `saturated accent drops its own label below AA before the shift is even visible);`
          : 'hover lifts the fill one step toward the light;',
        'active returns it to the resting colour and removes any elevation;',
        border
          ? `focus draws a 2px ring in the accent, offset 2px from the ${border} hairline, ` +
            'never replacing it;'
          : 'focus draws a 2px ring in the accent, offset 2px, never replacing the border;',
        'disabled drops to 45% opacity and keeps the same geometry.',
        'Every transition 150ms ease-out.',
      ].join(' ')
    : '';

  return {
    maxWidth,
    gutter,
    breakpoints,
    gradients,
    imagery,
    iconography,
    blur,
    animation,
    components,
    interactions,
  };
}

export function seedSpec(image: ImageMeta, auto: AutoAnalysis): DesignSpec {
  const { category, platform } = guessCategory(image, auto);
  const m = auto.layout.margins;
  const measured = seedFromDetail(auto.detail);
  const built = seedFromStructure(image, auto);
  return {
    category,
    platform,
    styleKeywords: guessStyleKeywords(auto),
    colorTokens: tokensFromPalette(auto.palette),
    typography: {
      headingFamily: '',
      bodyFamily: '',
      monoFamily: '',
      baseSize: '',
      scale: measured.scale,
      notes: measured.notes,
    },
    layout: {
      structure:
        auto.layout.columns <= 1
          ? 'Single column, stacked sections'
          : `${auto.layout.columns}-column arrangement`,
      columns: String(auto.layout.columns),
      maxWidth: built.maxWidth,
      gutter: built.gutter,
      spacingScale: '4, 8, 12, 16, 24, 32, 48, 64',
      radius: measured.radius,
      borders: measured.borders,
      breakpoints: built.breakpoints,
      notes: `Estimated from the screenshot — outer margins ~${Math.round(m.left * 100)}% left / ${Math.round(
        m.right * 100,
      )}% right, ${auto.layout.sectionBreaks.length + 1} stacked sections. ${describeAspect(
        image.width,
        image.height,
      )} capture at ${image.width}x${image.height}.`,
    },
    components: built.components,
    effects: {
      shadows: measured.shadows,
      gradients: built.gradients,
      blur: built.blur,
      animation: built.animation,
      iconography: built.iconography,
      imagery: built.imagery,
    },
    interactions: built.interactions,
    accessibilityNotes: auto.contrastPairs.length
      ? auto.contrastPairs
          .map((p) => `${p.foreground} on ${p.background}: ${p.ratio}:1 (${p.rating})`)
          .join('; ')
      : '',
    replicationNotes: '',
  };
}

/**
 * Merge a fresh analysis into a spec that already exists.
 *
 * Re-analysis has to bring in what the analyzer now measures without throwing
 * away what somebody typed. A field is refreshed when it is still exactly what
 * the previous analysis put there, or when it is empty; anything else is an
 * edit and survives. Only the analyzer-derived fields are considered; the font
 * families, which nothing can read off a bitmap, are yours alone.
 */
export function reseedSpec(spec: DesignSpec, previous: DesignSpec, next: DesignSpec): DesignSpec {
  return {
    ...spec,
    colorTokens: adopt(spec.colorTokens, previous.colorTokens, next.colorTokens),
    typography: {
      ...spec.typography,
      scale: adopt(spec.typography.scale, previous.typography.scale, next.typography.scale),
      notes: adopt(spec.typography.notes, previous.typography.notes, next.typography.notes),
    },
    layout: {
      ...spec.layout,
      radius: adopt(spec.layout.radius, previous.layout.radius, next.layout.radius),
      borders: adopt(spec.layout.borders, previous.layout.borders, next.layout.borders),
      maxWidth: adopt(spec.layout.maxWidth, previous.layout.maxWidth, next.layout.maxWidth),
      gutter: adopt(spec.layout.gutter, previous.layout.gutter, next.layout.gutter),
      breakpoints: adopt(spec.layout.breakpoints, previous.layout.breakpoints, next.layout.breakpoints),
      notes: adopt(spec.layout.notes, previous.layout.notes, next.layout.notes),
    },
    components: adopt(spec.components, previous.components, next.components),
    effects: {
      shadows: adopt(spec.effects.shadows, previous.effects.shadows, next.effects.shadows),
      gradients: adopt(spec.effects.gradients, previous.effects.gradients, next.effects.gradients),
      blur: adopt(spec.effects.blur, previous.effects.blur, next.effects.blur),
      animation: adopt(spec.effects.animation, previous.effects.animation, next.effects.animation),
      iconography: adopt(spec.effects.iconography, previous.effects.iconography, next.effects.iconography),
      imagery: adopt(spec.effects.imagery, previous.effects.imagery, next.effects.imagery),
    },
    interactions: adopt(spec.interactions, previous.interactions, next.interactions),
  };
}

function adopt<T>(current: T, previous: T, next: T): T {
  if (blank(current)) return next;
  return JSON.stringify(current) === JSON.stringify(previous) ? next : current;
}

/** Empty enough that filling it in takes nothing away. */
function blank(value: unknown): boolean {
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return value === undefined || value === null;
}
