import {
  colorDistance,
  contrastRatio,
  describeColor,
  luminance,
  ratingFor,
  rgbToHsl,
  toHex,
} from './color';
import type { ColorRole, ContrastPair, PaletteColor } from './types';

type RGB = [number, number, number];

interface Bucket {
  pixels: RGB[];
}

/** Split a bucket along its widest channel at the median. */
function splitBucket(bucket: Bucket): [Bucket, Bucket] {
  const ranges: RGB = [0, 0, 0];
  for (let channel = 0; channel < 3; channel++) {
    let min = 255;
    let max = 0;
    for (const p of bucket.pixels) {
      if (p[channel] < min) min = p[channel];
      if (p[channel] > max) max = p[channel];
    }
    ranges[channel] = max - min;
  }
  const widest = ranges.indexOf(Math.max(...ranges)) as 0 | 1 | 2;
  const sorted = bucket.pixels.slice().sort((a, b) => a[widest] - b[widest]);
  const mid = Math.floor(sorted.length / 2);
  return [{ pixels: sorted.slice(0, mid) }, { pixels: sorted.slice(mid) }];
}

function medianCut(pixels: RGB[], targetBuckets: number): Bucket[] {
  let buckets: Bucket[] = [{ pixels }];
  while (buckets.length < targetBuckets) {
    // Always split the bucket with the most pixels and some spread left.
    const candidates = buckets.filter((b) => b.pixels.length > 1);
    if (candidates.length === 0) break;
    candidates.sort((a, b) => b.pixels.length - a.pixels.length);
    const target = candidates[0];
    const [left, right] = splitBucket(target);
    buckets = buckets.filter((b) => b !== target).concat(left, right);
  }
  return buckets.filter((b) => b.pixels.length > 0);
}

function averageOf(pixels: RGB[]): RGB {
  let r = 0;
  let g = 0;
  let b = 0;
  for (const p of pixels) {
    r += p[0];
    g += p[1];
    b += p[2];
  }
  const n = pixels.length || 1;
  return [r / n, g / n, b / n];
}

interface RawSwatch {
  rgb: RGB;
  count: number;
}

/**
 * Lloyd refinement over the median-cut result.
 *
 * Median cut reports the *mean* of each bucket, and a bucket that straddles two
 * clusters reports a color halfway between them that never appears in the
 * design. Reassigning every pixel to its nearest swatch and recomputing the
 * centroids pulls those phantoms onto real colors and makes each count a true
 * pixel tally rather than a bucket size.
 */
function refine(pixels: RGB[], seeds: RGB[], iterations = 3): RawSwatch[] {
  let centroids = seeds.map((rgb) => rgb.slice() as RGB);
  let counts: number[] = new Array(centroids.length).fill(0);

  for (let pass = 0; pass < iterations; pass++) {
    const sums = centroids.map(() => [0, 0, 0]);
    counts = new Array(centroids.length).fill(0);

    for (const pixel of pixels) {
      let best = 0;
      let bestDistance = Infinity;
      for (let c = 0; c < centroids.length; c++) {
        const distance = colorDistance(pixel, centroids[c]);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = c;
        }
      }
      sums[best][0] += pixel[0];
      sums[best][1] += pixel[1];
      sums[best][2] += pixel[2];
      counts[best]++;
    }

    centroids = centroids.map((current, c) =>
      counts[c] === 0
        ? current
        : ([sums[c][0] / counts[c], sums[c][1] / counts[c], sums[c][2] / counts[c]] as RGB),
    );
  }

  return centroids.map((rgb, c) => ({ rgb, count: counts[c] }));
}

/** Fold together swatches that a person would call the same color. */
function mergeSimilar(swatches: RawSwatch[], threshold: number): RawSwatch[] {
  const merged: RawSwatch[] = [];
  for (const swatch of swatches.slice().sort((a, b) => b.count - a.count)) {
    const near = merged.find((m) => colorDistance(m.rgb, swatch.rgb) < threshold);
    if (near) {
      const total = near.count + swatch.count;
      near.rgb = [
        (near.rgb[0] * near.count + swatch.rgb[0] * swatch.count) / total,
        (near.rgb[1] * near.count + swatch.rgb[1] * swatch.count) / total,
        (near.rgb[2] * near.count + swatch.rgb[2] * swatch.count) / total,
      ];
      near.count = total;
    } else {
      merged.push({ rgb: swatch.rgb, count: swatch.count });
    }
  }
  return merged;
}

/**
 * Give every swatch a job. The heuristics are deliberately simple and
 * explainable: dominant area wins the background, highest contrast wins the
 * text, most chromatic-per-area wins the accent.
 */
function assignRoles(
  swatches: Array<{ hex: string; hsl: [number, number, number]; share: number }>,
): ColorRole[] {
  const roles: ColorRole[] = new Array(swatches.length).fill('muted');
  if (swatches.length === 0) return roles;
  const taken = new Set<number>();

  // Background: the largest area.
  const bgIndex = 0;
  roles[bgIndex] = 'background';
  taken.add(bgIndex);
  const bg = swatches[bgIndex];

  // Text: whatever contrasts hardest with the background.
  let textIndex = -1;
  let bestContrast = 0;
  swatches.forEach((s, i) => {
    if (taken.has(i)) return;
    const ratio = contrastRatio(s.hex, bg.hex);
    if (ratio > bestContrast) {
      bestContrast = ratio;
      textIndex = i;
    }
  });
  if (textIndex >= 0 && bestContrast >= 3) {
    roles[textIndex] = 'text';
    taken.add(textIndex);
  }

  // Accent: chromatic, and present enough to be intentional.
  let accentIndex = -1;
  let bestAccent = 0;
  swatches.forEach((s, i) => {
    if (taken.has(i)) return;
    const [, sat, light] = s.hsl;
    if (sat < 22 || light < 8 || light > 95) return;
    const score = (sat / 100) * Math.sqrt(s.share) * (1 - Math.abs(light - 55) / 100);
    if (score > bestAccent) {
      bestAccent = score;
      accentIndex = i;
    }
  });
  if (accentIndex >= 0) {
    roles[accentIndex] = 'accent';
    taken.add(accentIndex);
  }

  // Surface: a near-neighbour of the background — cards, panels, wells.
  let surfaceIndex = -1;
  let bestSurface = Infinity;
  swatches.forEach((s, i) => {
    if (taken.has(i)) return;
    if (s.hsl[1] > 40) return;
    const ratio = contrastRatio(s.hex, bg.hex);
    if (ratio > 2.2) return;
    if (ratio < bestSurface) {
      bestSurface = ratio;
      surfaceIndex = i;
    }
  });
  if (surfaceIndex >= 0) {
    roles[surfaceIndex] = 'surface';
    taken.add(surfaceIndex);
  }

  // Border: low-area neutrals sitting between background and text.
  swatches.forEach((s, i) => {
    if (taken.has(i)) return;
    const ratio = contrastRatio(s.hex, bg.hex);
    // Borders are hairlines: a neutral covering several percent of the canvas is
    // secondary text or a fill, not a divider.
    if (s.hsl[1] <= 30 && ratio > 1.2 && ratio < 4 && s.share < 0.03) {
      roles[i] = 'border';
      taken.add(i);
    }
  });

  return roles;
}

export interface PaletteResult {
  palette: PaletteColor[];
  averageLuminance: number;
  colorScheme: 'light' | 'dark' | 'mixed';
  saturation: 'muted' | 'moderate' | 'vivid';
  contrastPairs: ContrastPair[];
}

/**
 * Quantize the sampled pixels into a small, ordered palette.
 *
 * `data` is RGBA as produced by `CanvasRenderingContext2D.getImageData`.
 */
export function extractPalette(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  maxColors = 8,
): PaletteResult {
  const pixels: RGB[] = [];
  const edgePixels: RGB[] = [];
  let lumSum = 0;
  let lumCount = 0;

  // Anti-aliased text and the seams between blocks are blends of two real
  // colors. Left in, they quantize into muddy phantom swatches that were never
  // in the design, so they are held back and only used if nothing else is left.
  const isBlend = (index: number): boolean => {
    const x = index % width;
    const y = (index / width) | 0;
    const at = (i: number) =>
      Math.abs(data[i] - data[index * 4]) +
      Math.abs(data[i + 1] - data[index * 4 + 1]) +
      Math.abs(data[i + 2] - data[index * 4 + 2]);
    const right = x + 1 < width ? at((index + 1) * 4) : 0;
    const down = y + 1 < height ? at((index + width) * 4) : 0;
    return Math.max(right, down) > 48;
  };

  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const alpha = data[i + 3];
    if (alpha < 128) continue; // ignore transparency
    const rgb: RGB = [data[i], data[i + 1], data[i + 2]];
    lumSum += luminance(rgb[0], rgb[1], rgb[2]);
    lumCount++;
    if (isBlend(p)) edgePixels.push(rgb);
    else pixels.push(rgb);
  }

  // A design that is nearly all gradient would otherwise leave us nothing.
  if (pixels.length < lumCount * 0.15) pixels.push(...edgePixels);

  if (pixels.length === 0 || lumCount === 0) {
    return {
      palette: [],
      averageLuminance: 0,
      colorScheme: 'mixed',
      saturation: 'muted',
      contrastPairs: [],
    };
  }

  const buckets = medianCut(pixels, Math.max(maxColors * 4, 24));
  const raw: RawSwatch[] = buckets.map((b) => ({
    rgb: averageOf(b.pixels),
    count: b.pixels.length,
  }));
  // Re-sort after merging, not before: a large flat region is split across many
  // median-cut buckets, so no single one of them outranks a smaller solid block
  // until their counts have been folded together. Ordering by area is what makes
  // the first entry the background.
  // 20 is about where a designer stops naming two colors differently: it keeps
  // #ffffff apart from a #f7f8fa page background (distance ~21) while folding
  // the near-duplicate buckets median cut produces over a flat region.
  const seeds = mergeSimilar(raw, 20)
    .sort((a, b) => b.count - a.count)
    .slice(0, maxColors);

  const refined = refine(pixels, seeds.map((s) => s.rgb));
  const totalPixels = pixels.length || 1;
  const merged = mergeSimilar(refined, 12)
    .filter((s, i) => i < 3 || s.count / totalPixels >= 0.004)
    .sort((a, b) => b.count - a.count);
  const total = merged.reduce((sum, s) => sum + s.count, 0) || 1;

  const base = merged.map((s) => {
    const rgb: RGB = [Math.round(s.rgb[0]), Math.round(s.rgb[1]), Math.round(s.rgb[2])];
    const hsl = rgbToHsl(rgb[0], rgb[1], rgb[2]);
    return { hex: toHex(rgb[0], rgb[1], rgb[2]), rgb, hsl, share: s.count / total };
  });

  const roles = assignRoles(base);
  const palette: PaletteColor[] = base.map((s, i) => ({
    hex: s.hex,
    rgb: s.rgb,
    hsl: s.hsl,
    share: s.share,
    role: roles[i],
    name: describeColor(s.hsl),
  }));

  const averageLuminance = lumSum / lumCount;
  const colorScheme: PaletteResult['colorScheme'] =
    averageLuminance > 0.5 ? 'light' : averageLuminance < 0.2 ? 'dark' : 'mixed';

  // Judge saturation from the chromatic part of the palette only; a mostly
  // grey screenshot with one hot accent still reads as vivid.
  const chromatic = palette.filter((c) => c.hsl[1] >= 12);
  const chromaWeight = chromatic.reduce((sum, c) => sum + c.share, 0);
  const meanSat = chromaWeight
    ? chromatic.reduce((sum, c) => sum + c.hsl[1] * c.share, 0) / chromaWeight
    : 0;
  const peakSat = palette.reduce((max, c) => Math.max(max, c.hsl[1]), 0);
  const satScore = meanSat * 0.6 + peakSat * 0.4;
  const saturation: PaletteResult['saturation'] =
    satScore >= 58 ? 'vivid' : satScore >= 28 ? 'moderate' : 'muted';

  const pick = (role: ColorRole) => palette.find((c) => c.role === role);
  const bg = pick('background');
  const pairs: ContrastPair[] = [];
  const addPair = (fg?: PaletteColor, on?: PaletteColor) => {
    if (!fg || !on || fg.hex === on.hex) return;
    const ratio = contrastRatio(fg.hex, on.hex);
    pairs.push({
      foreground: fg.hex,
      background: on.hex,
      ratio: Math.round(ratio * 100) / 100,
      rating: ratingFor(ratio),
    });
  };
  addPair(pick('text'), bg);
  addPair(pick('accent'), bg);
  addPair(pick('text'), pick('surface'));
  addPair(pick('accent'), pick('surface'));

  return { palette, averageLuminance, colorScheme, saturation, contrastPairs: pairs };
}
