import type { DetailMeasurement } from './types';

/**
 * Fine detail read off the pixels: corner radius, hairline width and colour,
 * elevation, and the ladder of text sizes.
 *
 * These were the fields the spec used to leave blank, so every prompt it
 * exported told its reader to choose a radius and a type scale — five designs
 * in a row got a radius that was invented rather than measured. They are all
 * recoverable from the bitmap with ordinary geometry, so they are recovered
 * here rather than left to a person to type in.
 *
 * Everything is a heuristic and every result is reported with the number of
 * samples behind it, so a reader can tell one confident corner from forty.
 */

const rgbAt = (d: Uint8ClampedArray, i: number): [number, number, number] => [d[i], d[i + 1], d[i + 2]];

function hex([r, g, b]: [number, number, number]): string {
  return '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
}

/** Squared distance, so nothing needs a square root to be compared. */
function dist2(a: [number, number, number], b: [number, number, number]): number {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
}

const luma = ([r, g, b]: [number, number, number]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

function median(values: number[]): number {
  const s = values.slice().sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function modal<T extends string | number>(values: T[]): T | null {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: T | null = null;
  let top = 0;
  for (const [v, n] of counts) if (n > top) ((top = n), (best = v));
  return best;
}

/** Two colours are "the same region" when they are within this of each other. */
const SAME = 14 * 14 * 3;
/** And meaningfully different when they are past this. */
const DIFFERENT = 26 * 26 * 3;

// --- hairlines ---------------------------------------------------------------

/**
 * A border is a short run of one colour with a long run of something else on
 * either side, repeated down a column or across a row. Scanning both axes and
 * taking the modal width and colour finds the rule a design uses everywhere and
 * ignores the one-off.
 */
function measureBorders(d: Uint8ClampedArray, w: number, h: number, maxWidth: number) {
  /*
     Keyed by where the run starts, because a narrow run of a contrasting colour
     between two flat regions also describes the stem of a letter. The stems
     move from line to line and a border does not, so only positions hit
     repeatedly survive. Without this a page of body text reported a confident
     1px black hairline.
  */
  const byPosition = new Map<string, { widths: number[]; colours: string[]; lines: number[] }>();

  const scanLine = (length: number, at: (i: number) => number, axis: string, line: number) => {
    let runStart = 0;
    let runColour = rgbAt(d, at(0));
    let prevLength = 0;
    let prevColour: [number, number, number] | null = null;
    for (let i = 1; i <= length; i++) {
      const here = i < length ? rgbAt(d, at(i)) : null;
      if (here && dist2(here, runColour) <= SAME) continue;
      const runLength = i - runStart;
      // A candidate needs a long neighbour behind it and one ahead.
      if (
        prevColour &&
        prevLength >= 8 &&
        runLength >= 1 &&
        runLength <= maxWidth &&
        here &&
        dist2(runColour, prevColour) >= DIFFERENT &&
        dist2(runColour, here) >= DIFFERENT
      ) {
        // Look ahead far enough to know the far side is a region, not texture.
        let ahead = 0;
        while (ahead < 8 && i + ahead < length && dist2(rgbAt(d, at(i + ahead)), here) <= SAME) ahead++;
        if (ahead >= 8) {
          const key = `${axis}:${runStart}`;
          const bucket = byPosition.get(key) ?? { widths: [], colours: [], lines: [] };
          bucket.widths.push(runLength);
          bucket.colours.push(hex(runColour));
          bucket.lines.push(line);
          byPosition.set(key, bucket);
        }
      }
      prevLength = runLength;
      prevColour = runColour;
      runStart = i;
      if (here) runColour = here;
    }
  };

  // Sample rows and columns rather than every one: a border repeats.
  const rowStep = Math.max(1, Math.floor(h / 400));
  const colStep = Math.max(1, Math.floor(w / 400));
  for (let y = 0; y < h; y += rowStep) scanLine(w, (x) => (y * w + x) * 4, 'v', y);
  for (let x = 0; x < w; x += colStep) scanLine(h, (y) => (y * w + x) * 4, 'h', x);

  /** The longest unbroken stretch of scan lines a run was found on. */
  const longestRun = (lines: number[], step: number): number => {
    const sorted = lines.slice().sort((a, b) => a - b);
    let best = 1;
    let run = 1;
    for (let i = 1; i < sorted.length; i++) {
      run = sorted[i] - sorted[i - 1] <= step ? run + 1 : 1;
      if (run > best) best = run;
    }
    return best;
  };
  // A rule runs the length of whatever it separates. A letter's stem is about
  // as long as the letter, so demanding a long unbroken stretch keeps one and
  // discards the other.
  const minStretch = Math.max(12, Math.round(Math.min(w, h) * 0.04));

  const widths: number[] = [];
  const colours: string[] = [];
  for (const [key, bucket] of byPosition) {
    if (bucket.widths.length < 4) continue;
    const step = key.startsWith('v') ? rowStep : colStep;
    if (longestRun(bucket.lines, step) * step < minStretch) continue;
    widths.push(...bucket.widths);
    colours.push(...bucket.colours);
  }

  if (widths.length < 12) return null;
  return {
    width: modal(widths) ?? median(widths),
    hex: modal(colours) ?? '',
    samples: widths.length,
  };
}

// --- corners -----------------------------------------------------------------

/**
 * Corner radius, from how far a filled block is cut back at its bounding box.
 *
 * On a quarter circle of radius r the boundary sits at r(1 - 1/√2) from the
 * corner along the diagonal, so walking that diagonal until the fill starts
 * gives r directly. It needs no curve fitting and it is exact for a true
 * rounded rectangle.
 */
const DIAGONAL_TO_RADIUS = 1 / (1 - Math.SQRT1_2);

/**
 * Every solid rectangular block on the page, with its corner radius.
 *
 * One flood fill answers several questions at once — what the radius is, what
 * blocks repeat, how wide the content sits — so it runs once here and the
 * callers read what they need off the result.
 */
export interface Block {
  /** In sample pixels, top-left origin. */
  x: number;
  y: number;
  w: number;
  h: number;
  area: number;
  hex: string;
  colour: [number, number, number];
  /** Corner radius in sample pixels, or null where no corner was readable. */
  radius: number | null;
  /** The individual corners behind that median, for the page-wide statistic. */
  corners: number[];
  /** How much of the bounding box the block itself fills, 0..1. */
  fill: number;
}

export function findBlocks(
  d: Uint8ClampedArray,
  w: number,
  h: number,
  maxRadius: number,
  minSide = 24,
): Block[] {
  const seen = new Uint8Array(w * h);
  const blocks: Block[] = [];
  const minArea = minSide * minSide;
  const stack = new Int32Array(w * h);

  const step = Math.max(1, Math.floor(Math.min(w, h) / 120));
  for (let sy = 0; sy < h; sy += step) {
    for (let sx = 0; sx < w; sx += step) {
      const seed = sy * w + sx;
      if (seen[seed]) continue;
      const colour = rgbAt(d, seed * 4);

      // Flood the region of near-identical colour around this seed.
      let top = 0;
      stack[top++] = seed;
      seen[seed] = 1;
      let minX = sx, maxX = sx, minY = sy, maxY = sy, area = 0;
      const members: number[] = [];
      while (top > 0 && area < 4_000_000) {
        const p = stack[--top];
        const py = (p / w) | 0;
        const px = p - py * w;
        area++;
        if (members.length < 4_000_000) members.push(p);
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
        const neighbours = [
          px > 0 ? p - 1 : -1,
          px < w - 1 ? p + 1 : -1,
          py > 0 ? p - w : -1,
          py < h - 1 ? p + w : -1,
        ];
        for (const n of neighbours) {
          if (n < 0 || seen[n]) continue;
          if (dist2(rgbAt(d, n * 4), colour) > SAME) continue;
          seen[n] = 1;
          stack[top++] = n;
        }
      }

      const bw = maxX - minX + 1;
      const bh = maxY - minY + 1;
      if (bw < minSide || bh < minSide || area < minArea) continue;
      // A block filling its whole box to the edge of the canvas is the page,
      // not a card.
      if (bw >= w - 2 && bh >= h - 2) continue;

      const inside = new Set(members);

      /*
         Rectangularity is judged on the block's own edges, not on how much of
         its bounding box it fills. A card is a rectangle with content sitting
         on it, and that content punches holes: the first version of this
         measured 0.72 fill for a plain white card carrying two paragraphs and
         threw every card away. The border rows and columns, though, are still
         solid card colour except where the corners round off — so covering
         three quarters of each of the four edges is the test.
      */
      const covered = (
        fixed: number, from: number, to: number, horizontal: boolean,
      ): number => {
        let hit = 0;
        let n = 0;
        for (let i = from; i <= to; i++) {
          n++;
          if (inside.has(horizontal ? fixed * w + i : i * w + fixed)) hit++;
        }
        return n ? hit / n : 0;
      };
      const edges = [
        covered(minY, minX, maxX, true),
        covered(maxY, minX, maxX, true),
        covered(minX, minY, maxY, false),
        covered(maxX, minY, maxY, false),
      ];
      const container = edges.every((c) => c >= 0.75);

      const limit = Math.min(maxRadius, Math.floor(Math.min(bw, bh) / 2));
      const corners: number[] = [];
      for (const [cx, cy, dx, dy] of [
        [minX, minY, 1, 1],
        [maxX, minY, -1, 1],
        [minX, maxY, 1, -1],
        [maxX, maxY, -1, -1],
      ] as const) {
        let k = 0;
        while (k <= limit && !inside.has((cy + dy * k) * w + (cx + dx * k))) k++;
        if (k > limit) continue;
        corners.push(k * DIAGONAL_TO_RADIUS);
      }

      /*
         Two shapes have to get through, and one test cannot pass both.

         A container — a card, a bar — carries content that punches holes in it,
         so it is judged on its own edges, which stay solid. That works because
         its radius is small next to its sides.

         A control — a button, a pill, an avatar — has no content inside but is
         rounded hard enough that the edge test is meaningless: on a fully
         rounded pill the short edges are a single tangent pixel, so they score
         near zero however perfect the shape. It is judged instead on area,
         against what a rounded rectangle of the measured radius should have:
         bw·bh − (4 − π)r². Nothing else lands that close.

         Between them they also drop what neither is: a card's border ring
         scores solid edges but only a few percent of the area it claims, so it
         no longer counts as a second card sitting on the first.
      */
      const r = corners.length === 4 ? median(corners) : 0;
      const predicted = bw * bh - (4 - Math.PI) * r * r;
      const control = corners.length === 4 && Math.abs(area - predicted) <= bw * bh * 0.1;
      if (!container && !control) continue;

      blocks.push({
        x: minX,
        y: minY,
        w: bw,
        h: bh,
        area,
        hex: hex(colour),
        colour,
        radius: corners.length ? median(corners) : null,
        corners,
        fill: area / (bw * bh),
      });
    }
  }
  return blocks;
}

function measureRadius(blocks: Block[]) {
  // Anything under 24px is a control or a glyph-sized shape, whose corner is
  // most of its short side; the page radius is what the containers agree on.
  const radii = blocks.filter((b) => b.w >= 24 && b.h >= 24).flatMap((b) => b.corners);
  if (radii.length < 4) return null;
  return { radius: median(radii), samples: radii.length };
}

// --- elevation ---------------------------------------------------------------

/**
 * A drop shadow is a luminance ramp just outside a block edge that returns to
 * the page over a few pixels without the hue changing. A flat design steps
 * straight from one colour to the next, so the ramp length is the tell.
 */
function measureShadow(d: Uint8ClampedArray, w: number, h: number) {
  const spreads: number[] = [];
  const strengths: number[] = [];
  const look = 20;
  const rowStep = Math.max(1, Math.floor(h / 240));

  for (let y = look; y < h - look; y += rowStep) {
    for (let x = look; x < w - look - look; x++) {
      const here = rgbAt(d, (y * w + x) * 4);
      const next = rgbAt(d, (y * w + x + 1) * 4);
      if (dist2(here, next) < DIFFERENT) continue;

      // Walk outward. A shadow brightens back toward the page over several
      // pixels; a flat design is already at the page colour by the second.
      const profile: number[] = [];
      for (let k = 1; k <= look; k++) profile.push(luma(rgbAt(d, (y * w + x + k) * 4)));
      const settled = profile[profile.length - 1];
      // The far end has to be a flat region, or this is texture, not a page.
      let flat = true;
      for (let k = profile.length - 4; k < profile.length; k++) {
        if (Math.abs(profile[k] - settled) > 2) flat = false;
      }
      if (!flat) continue;

      const rise = settled - profile[0];
      if (rise <= 5) continue;
      // How far out it takes to come within a tenth of the page.
      let reach = 0;
      for (let k = 0; k < profile.length; k++) {
        if (settled - profile[k] > rise * 0.1) reach = k + 1;
      }
      // Monotonic enough to be a falloff rather than a second block.
      let backwards = 0;
      for (let k = 1; k < reach; k++) if (profile[k] < profile[k - 1] - 1) backwards++;
      // Six pixels is the line between a soft falloff and the one or two an
      // antialiased edge takes. Below it this reported confident elevation on
      // a design with none, off nothing but the blend at a card's own edge.
      if (reach >= 6 && reach < look - 1 && backwards <= 1 && rise < 110) {
        spreads.push(reach);
        strengths.push(rise);
      }
      x += 3;
    }
  }

  if (spreads.length < 24) return null;
  return { spread: median(spreads), strength: median(strengths), samples: spreads.length };
}

// --- text ---------------------------------------------------------------------

/**
 * Rows of text, from bands of horizontal edge energy.
 *
 * The height of a band is the ink height of that row, which is a lower bound on
 * its font size rather than the size itself — a line of lowercase has no
 * ascenders to measure. The ratios between bands are the useful part, and they
 * are what a type scale actually is.
 */
function measureTextRows(d: Uint8ClampedArray, w: number, h: number) {
  /*
     Energy is measured ACROSS each row, not down it. A vertical difference only
     fires at the top and bottom edges of a glyph — the middle of an H's stem
     changes nothing from the row above — so a line of text came back as two
     hairline bands with a gap between them, and the ink height measured four
     pixels. Horizontal difference fires the whole way down a row of text and
     nowhere in a flat band, which is the shape actually wanted.

     The figure kept is the fraction of columns that change rather than the mean
     change, so a narrow column of text in a wide page is not diluted into the
     background by its own margins.
  */
  const active = new Float32Array(h);
  const xStep = Math.max(1, Math.floor(w / 900));
  for (let y = 0; y < h; y++) {
    let hits = 0;
    let n = 0;
    for (let x = xStep; x < w; x += xStep) {
      const a = luma(rgbAt(d, (y * w + x) * 4));
      const b = luma(rgbAt(d, (y * w + x - xStep) * 4));
      if (Math.abs(a - b) > 12) hits++;
      n++;
    }
    active[y] = n ? hits / n : 0;
  }

  let peak = 0;
  for (const e of active) if (e > peak) peak = e;
  if (peak <= 0.005) return null;
  const threshold = Math.max(0.003, peak * 0.08);

  const bands: Array<{ start: number; end: number }> = [];
  let start = -1;
  for (let y = 0; y < h; y++) {
    if (active[y] > threshold) {
      if (start === -1) start = y;
    } else if (start !== -1) {
      bands.push({ start, end: y - 1 });
      start = -1;
    }
  }
  if (start !== -1) bands.push({ start, end: h - 1 });

  // A row of glyphs dips under the threshold here and there — between an
  // ascender and the x-height there is little going on. Stitching gaps of a
  // pixel or two back together stops one line reporting as three.
  const merged: Array<{ start: number; end: number }> = [];
  for (const band of bands) {
    const last = merged[merged.length - 1];
    if (last && band.start - last.end <= 2) last.end = band.end;
    else merged.push({ ...band });
  }
  bands.length = 0;
  bands.push(...merged);

  // A text row is short and wide; anything tall is an image or a filled block.
  const rows = bands.filter((b) => {
    const height = b.end - b.start + 1;
    return height >= 5 && height <= Math.max(14, h * 0.05);
  });
  if (rows.length < 4) return null;

  const heights = rows.map((b) => b.end - b.start + 1);
  const leading: number[] = [];
  for (let i = 1; i < rows.length; i++) {
    const gap = rows[i].start - rows[i - 1].start;
    if (gap > 0 && gap < h * 0.08) leading.push(gap);
  }
  return { heights, leading, samples: rows.length };
}

// --- assembly -----------------------------------------------------------------

/** Cluster to within 15%, so 15px and 16px are one step and 16 and 24 are not. */
function cluster(values: number[], scale: number): Array<{ px: number; rows: number }> {
  const sorted = values.map((v) => v * scale).sort((a, b) => a - b);
  const groups: number[][] = [];
  for (const v of sorted) {
    const last = groups[groups.length - 1];
    if (last && v <= last[last.length - 1] * 1.15) last.push(v);
    else groups.push([v]);
  }
  return groups
    .filter((g) => g.length >= Math.max(2, sorted.length * 0.06))
    .map((g) => ({ px: Math.round(median(g)), rows: g.length }))
    .filter((v, i, a) => a.findIndex((o) => o.px === v.px) === i);
}

export function measureDetail(
  sample: { data: Uint8ClampedArray; width: number; height: number; scale: number },
  blocks: Block[],
): DetailMeasurement {
  const { data, width: w, height: h, scale } = sample;
  const px = (n: number) => Math.round(n * scale);

  const border = measureBorders(data, w, h, Math.max(4, Math.round(6 / scale)));
  const corner = measureRadius(blocks);
  const shadow = measureShadow(data, w, h);
  const text = measureTextRows(data, w, h);

  return {
    radius: corner ? { px: px(corner.radius), samples: corner.samples } : null,
    border: border ? { px: Math.max(1, px(border.width)), hex: border.hex, samples: border.samples } : null,
    shadow: shadow
      ? { spread: px(shadow.spread), strength: Math.round(shadow.strength), samples: shadow.samples }
      : null,
    text: text
      ? {
          steps: cluster(text.heights, scale),
          leading: cluster(text.leading, scale).map((c) => c.px),
          samples: text.samples,
        }
      : null,
  };
}
