import { describeAspect, loadBitmap, makeThumbnail, samplePixels } from './image';
import { estimateLayout } from './layout';
import { extractPalette } from './palette';
import type {
  AutoAnalysis,
  ColorToken,
  DesignSpec,
  ImageMeta,
  PaletteColor,
} from './types';

export const ANALYZER_VERSION = 1;

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
export function seedSpec(image: ImageMeta, auto: AutoAnalysis): DesignSpec {
  const { category, platform } = guessCategory(image, auto);
  const m = auto.layout.margins;
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
      scale: TYPE_STEPS.map((name) => ({
        name,
        size: '',
        weight: '',
        lineHeight: '',
        letterSpacing: '',
      })),
      notes: '',
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
      radius: '',
      borders: '',
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
      shadows: '',
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
