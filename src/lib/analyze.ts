import { describeAspect, loadBitmap, makeThumbnail, sampleDetail, samplePixels } from './image';
import { estimateLayout } from './layout';
import { findBlocks, findGradientBlocks, measureDetail, solidBlocks } from './measure';
import { measureStructure } from './structure';
import { extractPalette } from './palette';
import { uxNotes } from './ux';
import type {
  AutoAnalysis,
  ColorToken,
  DesignSpec,
  ImageMeta,
  PaletteColor,
} from './types';

export const ANALYZER_VERSION = 8;

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
    const maxRadius = Math.max(8, Math.round(64 / fine.scale));
    // Two floods. The first finds elements with flat fills; the second follows
    // local continuity instead of the seed colour, which is what keeps a ramped
    // element in one piece rather than in stripes. The second runs on a coarser
    // sample: a ramp is large and smooth, and at native resolution that flood
    // cost more than the rest of the analyzer together.
    let flat = findBlocks(fine.data, fine.width, fine.height, maxRadius, 10);
    /*
       Grain defeats the flood fill. It measures each neighbour against the
       seed, and under noise every neighbour differs, so a grained capture came
       back with no blocks at all — and no blocks means no borders, no
       elevation, no components and no ramps, all reported as measured facts
       rather than as a pass that found nothing.

       Halving the sample averages four pixels into one and takes the grain
       with it, so the retry sees the shapes underneath. It costs a pass only
       on captures where the first one found nothing.
    */
    if (solidBlocks(flat, fine.width, fine.height).length === 0) {
      const smooth = sampleDetail(bitmap, 250_000);
      const toFine = smooth.scale / fine.scale;
      flat = findBlocks(
        smooth.data, smooth.width, smooth.height,
        Math.max(4, Math.round(maxRadius / toFine)), 10,
      ).map((b) => ({
        ...b,
        x: Math.round(b.x * toFine),
        y: Math.round(b.y * toFine),
        w: Math.round(b.w * toFine),
        h: Math.round(b.h * toFine),
        area: Math.round(b.area * toFine * toFine),
        radius: b.radius === null ? null : b.radius * toFine,
        corners: b.corners.map((c) => c * toFine),
      }));
    }
    const broad = sampleDetail(bitmap, 1_000_000);
    const blocks = findGradientBlocks(
      broad.data, broad.width, broad.height, maxRadius, flat, broad.scale / fine.scale,
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

  /*
     Both of these used to be page-wide statistics — one hairline, one
     elevation, attributed to nothing. A borderless card with a soft shadow and
     a hairlined card with none exported identically, and the design that had
     four bordered elements out of eleven read as though everything were
     bordered. The counts are the fix: absence is measured here, so it can be
     stated rather than inferred from a field that simply says nothing.
  */
  const e = detail?.edges ?? null;
  /*
     Grain is the case where absence must not be asserted. It defeats the flood
     fill — every neighbour differs, so regions never form — and a grained
     capture can come back with no blocks at all. Saying "None. All 0 measured
     blocks are borderless" out of that is a measurement claim about a pass
     that measured nothing, which is the one kind of wrong this file is meant
     not to be.
  */
  const blind = !e || e.blocks === 0;
  const unmeasured = (what: string) =>
    `Not measured. The elements this reads ${what} from are found by flooding regions of ` +
    'one colour, and nothing here formed one — a grained or photographic capture defeats ' +
    'that. Treat this as unknown rather than as absent, and match what you can see.';
  const rest = (n: number) => (e ? e.blocks - n : 0);
  const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

  const borders = blind
    ? unmeasured('borders')
    : e
    ? e.border && e.withBorder
      ? `${e.border.px}px ${e.border.hex}, on ${e.withBorder} of the ${e.blocks} blocks ` +
        `measured` +
        (rest(e.withBorder) > 0
          ? `. The other ${rest(e.withBorder)} ${plural(rest(e.withBorder), 'is', 'are')} ` +
            `borderless — do not add a rule to them.`
          : ' — every one of them carries it.')
      : `None. All ${e.blocks} measured blocks are borderless; the design separates ` +
        'elements by fill and space, not by rules.'
    : detail?.border
      ? `${detail.border.px}px ${detail.border.hex}`
      : '';

  const shadows = blind
    ? unmeasured('elevation')
    : e
    ? e.shadow && e.withShadow
      ? `Soft elevation, about ${e.shadow.spread}px of falloff reaching ${e.shadow.strength}/255 ` +
        `at its darkest, ` +
        (Math.abs(e.shadow.dy) >= 2 || Math.abs(e.shadow.dx) >= 2
          ? `offset ${e.shadow.dx ? `${Math.abs(e.shadow.dx)}px ${e.shadow.dx > 0 ? 'right' : 'left'}` : ''}` +
            `${e.shadow.dx && e.shadow.dy ? ' and ' : ''}` +
            `${e.shadow.dy ? `${Math.abs(e.shadow.dy)}px ${e.shadow.dy > 0 ? 'down' : 'up'}` : ''} — ` +
            'it is a lifted shadow, not a symmetric glow, '
          : 'reaching the same distance on every side — a glow rather than a lift, ') +
        `on ${e.withShadow} of the ${e.blocks} blocks measured` +
        (rest(e.withShadow) > 0
          ? `. The other ${rest(e.withShadow)} ${plural(rest(e.withShadow), 'sits', 'sit')} ` +
            'flat on the page.'
          : ' — every one of them casts.') +
        /*
           A falloff this wide is not a hairline of separation, it is the
           design's posture, and saying only the numbers loses it. Twenty
           pixels of soft shadow under every surface is what makes a page read
           as floating rather than printed, and a reader who takes the figure
           and applies a 2px default has honoured the measurement and missed
           the design.
        */
        (e.shadow.spread >= 20
          ? ' Read that as the posture of the whole page rather than as a detail: a falloff ' +
            'this wide under a surface is what makes it float, so every raised thing should ' +
            'sit off its ground by this much, and nothing should read as printed on to it.'
          : '')
      : `None. All ${e.blocks} measured blocks step straight to the page with no falloff.`
    : detail?.shadow
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
  /*
     Weight, from the stem's width against the ink's height. The ratio splits
     cleanly at the two ends — a regular face measures 0.15-0.18 and a bold one
     0.22-0.27 — but it does not separate a 600 from a 700, so what is reported
     is a band and the measured stem beside it, not a number pretending to be a
     CSS weight.
  */
  const weightOf = (stem: number, ink: number): string => {
    if (!stem || !ink) return '';
    const r = stem / ink;
    const name =
      r < 0.12 ? 'light' : r < 0.175 ? 'regular' : r < 0.21 ? 'medium'
      : r < 0.26 ? 'semibold' : 'bold';
    return `${name} (${stem}px stem)`;
  };
  /*
     Tracking, as the gap between glyphs against the ink height. A face at its
     natural fit sits near 0.15; every pixel of added letter-spacing moves it by
     about a fortieth. The px figure is the excess over that natural fit, which
     is the number somebody types into CSS.
  */
  const trackingOf = (gap: number, ink: number): string => {
    if (!gap || !ink) return '';
    const added = Math.round(gap - ink * 0.155);
    if (added <= 0) return `normal (~${gap}px between glyphs)`;
    return `~+${added}px (${gap}px between glyphs)`;
  };

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
      weight: step ? weightOf(step.stem, step.px) : '',
      lineHeight: step && leading[i - offset] !== undefined ? `~${leading[i - offset]}px` : '',
      letterSpacing: step ? trackingOf(step.tracking, step.px) : '',
    };
  });

  // What the table has no column for: the ink each step is set in, whether it
  // is capitals, and how the rows are ranged.
  const setIn = steps
    .map((step, i) => {
      const name = TYPE_STEPS[i + offset] ?? `~${step.px}px`;
      const bits = [step.hex ? `set in ${step.hex}` : ''];
      if (step.caps) bits.push('in capitals');
      if (step.align !== 'mixed') bits.push(`ranged ${step.align}`);
      const said = bits.filter(Boolean).join(', ');
      return said ? `${name} is ${said}` : '';
    })
    .filter(Boolean);

  const notes = detail?.text
    ? `${detail.text.samples} text rows measured, the most common one taken as Body. ` +
      'The sizes above are ink heights — the height of the glyphs themselves — which ' +
      'understates font size, since a line with no ascenders has none to measure. Treat ' +
      'the ratios between the steps as firmer than the absolute figures. Font families ' +
      'cannot be read off a bitmap and are not guessed. ' +
      (setIn.length ? `${setIn.join('; ')}. ` : '') +
      'Weight is read from the stem against the ink height, which separates a ' +
      'regular from a bold but not a 600 from a 700, and is not attempted at ' +
      'all below 10px of ink, where a stem is one pixel whatever the weight is.'
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
  const e = auto.detail?.edges ?? null;
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

  /*
     Two different questions, and the field used to answer only the first: does
     the PAGE ramp, and does any ELEMENT ramp. A page of flat colour carrying a
     gradient button reported "no gradient measured", which is how a button
     came back flat.
  */
  const pageRamp = s?.gradient
    ? `The page carries a ${s.gradient.axis} ramp from ${s.gradient.from} to ` +
      `${s.gradient.to}, holding across ${Math.round(s.gradient.coverage * 100)}% of the scan lines.`
    : null;
  const blindToBlocks = !e || e.blocks === 0;
  const elementRamp = blindToBlocks
    ? 'No element could be measured for one — nothing on this capture formed a solid region, ' +
      'which a grained or photographic page does. Unknown, not absent.'
    : e && e.withGradient && e.gradient
      ? `${e.withGradient} of the ${e.blocks} blocks measured ` +
        `${e.withGradient === 1 ? 'is' : 'are'} filled with a ramp rather than a flat colour — ` +
        `the ${e.withGradient === 1 ? 'ramp is a' : 'strongest a'} ${e.gradient.axis} one ` +
        `from ` +
        `${e.gradient.from} to ${e.gradient.to}, travelling ${e.gradient.span}/255` +
        (e.blocks - e.withGradient > 0
          ? `. The other ${e.blocks - e.withGradient} ` +
            `${e.blocks - e.withGradient === 1
              ? 'is a flat fill — do not put a ramp on it.'
              : 'are flat fills — do not put a ramp on them.'}`
          : ' — every one of them ramps.')
      : e
        ? `All ${e.blocks} measured blocks are flat fills.`
        : null;

  const gradients = pageRamp || elementRamp
    ? [pageRamp, elementRamp].filter(Boolean).join(' ')
    : s
      ? 'None. Neither the page nor any element ramps; every fill is flat colour.'
      : '';

  /*
     Texture used to go unreported entirely: a page with grain over it and a
     page of clean fills exported the same words, and so did a page with a
     stripe or dot pattern behind its content. Both are in the pixels and both
     belong here, next to the photography, because they are the same question —
     what is the surface actually made of.
  */
  /*
     The surface itself, which is a core visual cue and was being reported as
     either fine noise or nothing at all. A weave — a material with a structure
     you could put a ruler on — is the thing a reader most needs telling about,
     because it cannot be reproduced with a noise filter and a page that skips
     it reads as plastic where the original read as cloth or paper or card.
  */
  const texture = [
    s?.grain
      ? s.grain.scale === 'weave'
        ? `Textured surfaces, not flat ones: a woven or moulded relief over ` +
          `${Math.round(s.grain.coverage * 100)}% of the flat area at about ` +
          `${s.grain.amplitude}/255, varying over several pixels rather than one. ` +
          'This is a material, not a noise filter — reproduce it with a tiling image or ' +
          'a repeating background, and expect the surfaces to read as plastic if you skip it.'
        : `Grain over ${Math.round(s.grain.coverage * 100)}% of the flat area, about ` +
          `${s.grain.amplitude}/255 of pixel-fine noise — a laid texture, not a flat fill; ` +
          'reproduce it or the surfaces will read cleaner than the original.'
      : s
        ? 'No texture — the flat areas are flat to the pixel, at any scale.'
        : '',
  ].filter(Boolean);

  const imagery = s
    ? [
        s.imagery && s.imagery.coverage > 0 && s.imagery.regions.length
          ? (() => {
              const r = s.imagery.regions;
              const first = r[0];
              const ratio = Math.round((first.w / first.h) * 100) / 100;
              const alike = r.every(
                (x) => Math.abs(x.w - first.w) <= first.w * 0.2 && Math.abs(x.h - first.h) <= first.h * 0.2,
              );
              return (
                `${r.length === 1 ? 'One photograph' : `${r.length} photographs`}, ` +
                (alike
                  ? `each about ${first.w}×${first.h}px (${ratio}:1)`
                  : `the largest ${first.w}×${first.h}px (${ratio}:1), the rest smaller`) +
                `, over ~${Math.round(s.imagery.coverage * 100)}% of the canvas. ` +
                (s.imagery.colour
                  ? 'In colour.'
                  : 'Greyscale — the pictures carry almost no chroma, which is a treatment and ' +
                    'not something the palette says.')
              );
            })()
          : 'No photographic regions — the page is flat colour and type throughout.',
        ...texture,
      ].join(' ')
    : '';

  const iconography = s?.icons
    ? `${s.icons.count} square-ish regions at ~${s.icons.px}px — a count of shapes that could ` +
      'be icons, which may take in a cluster of glyphs as well' +
      (s.icons.stroke
        ? `, drawn at a ~${s.icons.stroke}px stroke — measured, not assumed. `
        : ', drawn at a stroke the shapes did not agree on, so treat the weight below as a ' +
          'convention rather than a reading. ') +
      `Convention for what the bitmap cannot show: line icons at that size on a 24px grid, ` +
      `corners following the ${radius || 'page'} radius.`
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

  /*
     What those components DO. Everything above this line describes how the
     design looks; without this the reader gets the colour of a button and the
     radius of a field and has to invent every state, every keyboard path and
     every piece of structure underneath — which is most of what separates an
     interface from a picture of one. Keyed to the roles actually found, so a
     page with no dialog is not told how dialogs behave.
  */
  const ux = s
    ? uxNotes(s.roles, {
        accent,
        radius: radius || '',
        bordered: (e?.withBorder ?? 0) > 0,
        raised: (e?.withShadow ?? 0) > 0,
      })
    : '';

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
    ux,
    interactions,
  };
}

/**
 * An older record's analysis, made safe to read with today's seeder.
 *
 * Re-analyze is fed an arbitrarily old shape BY DEFINITION: it seeds from the
 * record's stored analysis to learn which fields the person edited, and that
 * stored analysis was written by whatever version catalogued it. So every
 * collection this file added after v1 is missing on something out there, and
 * reading one of them straight throws — which is exactly what happened. A
 * record stored before roles existed crashed the moment re-analysis iterated
 * them, and the person got "undefined is not an object" for their trouble.
 *
 * Filling the gaps in one place rather than guarding at each read site is the
 * difference between remembering this once and remembering it every time a
 * measurement is added. An absent collection becomes an empty one, which every
 * caller already handles: empty means nothing was measured, which is the
 * truth about a version that never measured it.
 */
function withDefaults(auto: AutoAnalysis): AutoAnalysis {
  const s = auto.structure;
  if (!s) return auto;
  return {
    ...auto,
    structure: {
      ...s,
      components: s.components ?? [],
      roles: s.roles ?? [],
      grain: s.grain ?? null,
      imagery: s.imagery ? { ...s.imagery, regions: s.imagery.regions ?? [] } : s.imagery,
      icons: s.icons ? { ...s.icons, stroke: s.icons.stroke ?? null } : s.icons,
    },
  };
}

export function seedSpec(image: ImageMeta, stored: AutoAnalysis): DesignSpec {
  const auto = withDefaults(stored);
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
    uxNotes: built.ux,
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
 *
 * `previous` is what the seeder wrote LAST TIME, and getting that right is the
 * whole difficulty. Recomputing it from the old analysis with today's seeder
 * does not give it: today's seeder writes today's sentences, and the moment a
 * measurement is reworded — which has happened repeatedly — every record still
 * carrying the old wording looks hand-edited and is preserved forever. A
 * design catalogued before the imagery pass went on saying "concentrated in a
 * 1008x1680px region at 0,0" through every re-analysis, because nothing could
 * ever match it again.
 *
 * So the seed is now SAVED with the record and handed back here. Where a
 * record predates that — every record already on disk — `stale` says the
 * analyzer has moved on since it was written, and the prose the analyzer owns
 * is taken from the new seed rather than guarded. That is a deliberate,
 * one-time loss of any hand-edit in those particular fields, and it is the
 * lesser one: the alternative is a measurement that no amount of re-analysing
 * can shift.
 */
export function reseedSpec(
  spec: DesignSpec,
  previous: DesignSpec,
  next: DesignSpec,
  stale = false,
): DesignSpec {
  /*
     Which fields the analyzer OWNS. These are prose it writes and the drawer
     labels as measured; the rest — families, notes, tags, keywords, the
     replication notes — belong to whoever typed them and are never taken.
  */
  const own = <T>(current: T, prev: T, fresh: T): T =>
    stale ? fresh : adopt(current, prev, fresh);
  return {
    ...spec,
    colorTokens: own(spec.colorTokens, previous.colorTokens, next.colorTokens),
    typography: {
      ...spec.typography,
      scale: own(spec.typography.scale, previous.typography.scale, next.typography.scale),
      notes: adopt(spec.typography.notes, previous.typography.notes, next.typography.notes),
    },
    layout: {
      ...spec.layout,
      radius: own(spec.layout.radius, previous.layout.radius, next.layout.radius),
      borders: own(spec.layout.borders, previous.layout.borders, next.layout.borders),
      maxWidth: own(spec.layout.maxWidth, previous.layout.maxWidth, next.layout.maxWidth),
      gutter: own(spec.layout.gutter, previous.layout.gutter, next.layout.gutter),
      breakpoints: own(spec.layout.breakpoints, previous.layout.breakpoints, next.layout.breakpoints),
      notes: adopt(spec.layout.notes, previous.layout.notes, next.layout.notes),
    },
    components: own(spec.components, previous.components, next.components),
    uxNotes: own(spec.uxNotes, previous.uxNotes, next.uxNotes),
    effects: {
      shadows: own(spec.effects.shadows, previous.effects.shadows, next.effects.shadows),
      gradients: own(spec.effects.gradients, previous.effects.gradients, next.effects.gradients),
      blur: own(spec.effects.blur, previous.effects.blur, next.effects.blur),
      animation: own(spec.effects.animation, previous.effects.animation, next.effects.animation),
      iconography: own(spec.effects.iconography, previous.effects.iconography, next.effects.iconography),
      imagery: own(spec.effects.imagery, previous.effects.imagery, next.effects.imagery),
    },
    interactions: own(spec.interactions, previous.interactions, next.interactions),
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
