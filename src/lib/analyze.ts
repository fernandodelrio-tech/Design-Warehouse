import { describeAspect, loadBitmap, makeThumbnail, sampleDetail, samplePixels } from './image';
import { estimateLayout } from './layout';
import { measureDetail } from './measure';
import { extractPalette } from './palette';
import type {
  AutoAnalysis,
  ColorToken,
  DesignSpec,
  ImageMeta,
  PaletteColor,
} from './types';

export const ANALYZER_VERSION = 2;

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
    const detail = measureDetail(sampleDetail(bitmap));

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

export function seedSpec(image: ImageMeta, auto: AutoAnalysis): DesignSpec {
  const { category, platform } = guessCategory(image, auto);
  const m = auto.layout.margins;
  const measured = seedFromDetail(auto.detail);
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
      maxWidth: '',
      gutter: '',
      spacingScale: '4, 8, 12, 16, 24, 32, 48, 64',
      radius: measured.radius,
      borders: measured.borders,
      breakpoints: '',
      notes: `Estimated from the screenshot — outer margins ~${Math.round(m.left * 100)}% left / ${Math.round(
        m.right * 100,
      )}% right, ${auto.layout.sectionBreaks.length + 1} stacked sections. ${describeAspect(
        image.width,
        image.height,
      )} capture at ${image.width}x${image.height}.`,
    },
    components: [],
    effects: {
      shadows: measured.shadows,
      gradients: '',
      blur: '',
      animation: '',
      iconography: '',
      imagery: '',
    },
    interactions: '',
    accessibilityNotes: auto.contrastPairs.length
      ? auto.contrastPairs
          .map((p) => `${p.foreground} on ${p.background}: ${p.ratio}:1 (${p.rating})`)
          .join('; ')
      : '',
    replicationNotes: '',
  };
}
