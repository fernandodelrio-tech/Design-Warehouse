import { solidBlocks } from './measure';
import type { Block } from './measure';
import type { ComponentRole, StructureMeasurement } from './types';

/**
 * The rest of what a screenshot will tell you: how wide the content sits, what
 * the gutter is, whether anything is a gradient or a photograph, and what
 * blocks repeat often enough to be called components.
 *
 * These were the last fields the exported spec left blank, so every prompt
 * ended with a list of things its reader had to invent — max width, gutters,
 * gradients, imagery, a component inventory. Most of them are in the pixels.
 * What genuinely is not (breakpoints, motion, hover states — a still frame has
 * one state and one width) is not measured here and not guessed here either;
 * lib/analyze.ts writes those as conventions and says so in the text.
 *
 * Everything reports how many samples it rests on, so a reader can tell a
 * repeated pattern from a single lucky block.
 */

const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

function hex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
}

function median(values: number[]): number {
  const s = values.slice().sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length ? (s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2) : 0;
}

function modal(values: number[], tolerance: number): number | null {
  if (values.length === 0) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  let best: number[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const group: number[] = [];
    for (let j = i; j < sorted.length && sorted[j] - sorted[i] <= tolerance; j++) group.push(sorted[j]);
    if (group.length > best.length) best = group;
  }
  return best.length ? median(best) : null;
}

// --- the frame ---------------------------------------------------------------

/**
 * Where the content actually starts and stops, and how wide the gap between
 * columns is — both in source pixels, which is what a max-width and a gutter
 * are written in. The layout estimate already reports margins, but as
 * fractions of a 320px sample, which rounds a 1200px content column to the
 * nearest 40.
 */
function measureFrame(d: Uint8ClampedArray, w: number, h: number, scale: number) {
  const rowStep = Math.max(1, Math.floor(h / 300));
  const energy = new Float32Array(w);
  let rows = 0;
  for (let y = 0; y < h - 1; y += rowStep) {
    rows++;
    for (let x = 0; x < w - 1; x++) {
      const p = (y * w + x) * 4;
      const here = luma(d[p], d[p + 1], d[p + 2]);
      const right = luma(d[p + 4], d[p + 5], d[p + 6]);
      const down = luma(d[p + w * 4], d[p + w * 4 + 1], d[p + w * 4 + 2]);
      energy[x] += Math.abs(here - right) + Math.abs(here - down);
    }
  }
  for (let x = 0; x < w; x++) energy[x] /= Math.max(1, rows);

  const mean = energy.reduce((a, b) => a + b, 0) / Math.max(1, w);
  const threshold = Math.max(0.6, mean * 0.18);
  let left = 0;
  while (left < w && energy[left] <= threshold) left++;
  let right = w - 1;
  while (right > left && energy[right] <= threshold) right--;
  if (right <= left) return null;

  // Quiet vertical bands strictly inside the content box are the gutters.
  const minGutter = Math.max(4, Math.round(8 / scale));
  const gaps: number[] = [];
  let run = -1;
  for (let x = left; x <= right; x++) {
    if (energy[x] <= threshold) {
      if (run === -1) run = x;
    } else if (run !== -1) {
      if (x - run >= minGutter) gaps.push(x - run);
      run = -1;
    }
  }

  const gutter = modal(gaps, Math.max(2, Math.round(4 / scale)));
  return {
    contentWidth: Math.round((right - left + 1) * scale),
    marginLeft: Math.round(left * scale),
    marginRight: Math.round((w - 1 - right) * scale),
    gutter: gutter === null ? null : Math.round(gutter * scale),
    gutterSamples: gaps.length,
  };
}

// --- gradients ---------------------------------------------------------------

/**
 * A gradient is a long, monotone luminance drift with no edge in it. Checking
 * whole scan lines rather than neighbourhoods is what separates one from a
 * stack of differently-toned sections: a section boundary is a step, and a step
 * fails the smoothness test on the one pixel where it happens.
 */
function measureGradient(d: Uint8ClampedArray, w: number, h: number) {
  const test = (across: number, along: number, at: (a: number, b: number) => number) => {
    const samples = 24;
    let agree = 0;
    let lines = 0;
    const firsts: number[][] = [];
    const lasts: number[][] = [];
    const step = Math.max(1, Math.floor(across / 40));
    for (let a = 0; a < across; a += step) {
      lines++;
      const track: number[] = [];
      for (let s = 0; s < samples; s++) {
        const b = Math.min(along - 1, Math.round((s * (along - 1)) / (samples - 1)));
        const p = at(a, b) * 4;
        track.push(luma(d[p], d[p + 1], d[p + 2]));
      }
      const span = track[track.length - 1] - track[0];
      if (Math.abs(span) < 10) continue;
      // Every step has to move the same way, and none of them by a lot: that
      // is what makes it a ramp instead of two blocks.
      const stepLimit = Math.abs(span) * 0.45;
      let smooth = true;
      for (let s = 1; s < track.length; s++) {
        const delta = track[s] - track[s - 1];
        if (delta * span < -1 || Math.abs(delta) > stepLimit) smooth = false;
      }
      if (!smooth) continue;
      agree++;
      const p0 = at(a, 0) * 4;
      const p1 = at(a, along - 1) * 4;
      firsts.push([d[p0], d[p0 + 1], d[p0 + 2]]);
      lasts.push([d[p1], d[p1 + 1], d[p1 + 2]]);
    }
    if (!lines || agree / lines < 0.6) return null;
    const mid = (list: number[][], i: number) => median(list.map((c) => c[i]));
    return {
      coverage: Math.round((agree / lines) * 100) / 100,
      from: hex(mid(firsts, 0), mid(firsts, 1), mid(firsts, 2)),
      to: hex(mid(lasts, 0), mid(lasts, 1), mid(lasts, 2)),
      samples: agree,
    };
  };

  const vertical = test(w, h, (x, y) => y * w + x);
  if (vertical) return { ...vertical, axis: 'vertical' as const };
  const horizontal = test(h, w, (y, x) => y * w + x);
  if (horizontal) return { ...horizontal, axis: 'horizontal' as const };
  return null;
}

// --- photographs -------------------------------------------------------------

/**
 * Photographic regions, told apart from UI by colour variety, and segmented
 * into the separate pictures they actually are.
 *
 * A tile of interface holds a handful of flat colours however busy it looks; a
 * tile of photograph holds dozens, because a lens does not produce flat fills.
 * That part worked. What did not was the reporting: every photographic tile on
 * the page went into ONE bounding box, so three 360x240 pictures in a row came
 * back as "a 1224x240px region" — a shape that exists nowhere on the page, and
 * one a reader would rebuild as a single wide banner.
 *
 * The tiles are joined into connected regions now, so the count, the size and
 * the aspect ratio are of a picture rather than of their union. Whether they
 * are in colour is measured too, because a page of greyscale photography is a
 * different design from the same page in colour and neither the palette nor
 * the coverage says which it is.
 */
function measureImagery(d: Uint8ClampedArray, w: number, h: number, scale: number) {
  const tile = 24;
  const cols = Math.floor(w / tile);
  const rows = Math.floor(h / tile);
  if (cols < 2 || rows < 2) return null;
  const mask = new Uint8Array(cols * rows);
  let photographic = 0;
  let chroma = 0;
  let chromaSamples = 0;

  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      const seen = new Set<number>();
      const tones = new Set<number>();
      let spread = 0;
      let n = 0;
      for (let y = ty * tile; y < ty * tile + tile; y += 2) {
        for (let x = tx * tile; x + 1 < tx * tile + tile; x += 2) {
          const p = (y * w + x) * 4;
          // 5 bits per channel: finer than this and antialiasing alone counts
          // as variety, coarser and a photograph collapses to a few buckets.
          seen.add(((d[p] >> 3) << 10) | ((d[p + 1] >> 3) << 5) | (d[p + 2] >> 3));
          tones.add(Math.round(luma(d[p], d[p + 1], d[p + 2])) >> 2);
          spread += Math.max(d[p], d[p + 1], d[p + 2]) - Math.min(d[p], d[p + 1], d[p + 2]);
          n++;
        }
      }
      /*
         Two tests, because one of them cannot see a greyscale photograph. The
         colour key collapses when r, g and b are equal — a monochrome picture
         has at most 32 of those buckets whatever is in it — so a row of
         greyscale photographs came back as "no photographic regions". Where a
         tile carries almost no chroma the variety is counted in TONES instead,
         which is the only axis a monochrome image varies on.
      */
      const grey = n ? spread / n < 12 : false;
      if (grey ? tones.size >= 34 : seen.size >= 48) {
        mask[ty * cols + tx] = 1;
        photographic++;
        if (n) {
          chroma += spread / n;
          chromaSamples++;
        }
      }
    }
  }

  const total = cols * rows;
  if (!photographic) return { coverage: 0, regions: [], colour: true, samples: total };

  // Connected components over the tile mask: one per picture.
  const seenTile = new Uint8Array(cols * rows);
  const regions: Array<{ x: number; y: number; w: number; h: number }> = [];
  const stack: number[] = [];
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || seenTile[i]) continue;
    stack.length = 0;
    stack.push(i);
    seenTile[i] = 1;
    let minX = cols, maxX = 0, minY = rows, maxY = 0, area = 0;
    while (stack.length) {
      const p = stack.pop()!;
      const py = (p / cols) | 0;
      const px = p - py * cols;
      area++;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
      const around = [
        px > 0 ? p - 1 : -1,
        px < cols - 1 ? p + 1 : -1,
        py > 0 ? p - cols : -1,
        py < rows - 1 ? p + cols : -1,
      ];
      for (const q of around) {
        if (q < 0 || seenTile[q] || !mask[q]) continue;
        seenTile[q] = 1;
        stack.push(q);
      }
    }
    // One stray tile is a busy patch of interface, not a picture.
    if (area < 2) continue;
    regions.push({
      x: Math.round(minX * tile * scale),
      y: Math.round(minY * tile * scale),
      w: Math.round((maxX - minX + 1) * tile * scale),
      h: Math.round((maxY - minY + 1) * tile * scale),
    });
  }

  return {
    coverage: Math.round((photographic / total) * 100) / 100,
    regions: regions.sort((a, b) => b.w * b.h - a.w * a.h),
    // Chroma near zero across the photographic tiles means the pictures are
    // greyscale, which is a design decision and not a palette one.
    colour: chromaSamples ? chroma / chromaSamples >= 12 : true,
    samples: total,
  };
}

// --- texture -----------------------------------------------------------------

/**
 * Grain: the texture a flat capture can actually hold, and it was not being
 * read at all. A page with film grain over it and a page of clean flat fills
 * exported the same words.
 *
 * Grain is high-frequency — every pixel differs a little from its neighbours,
 * everywhere, by about the same amount. It is told from photography by having
 * no structure: a photograph varies at every scale, grain only at the finest.
 * So the test is a large residual against a 3x3 mean while the tile's own
 * colour range stays narrow.
 */
function measureTexture(d: Uint8ClampedArray, w: number, h: number) {
  /*
     Texture at TWO scales, because a surface can be textured in two ways and
     only one of them was being looked for.

     The old pass compared every pixel to the mean of its eight neighbours and
     called the residual grain. That finds sensor noise and paper fibre — a
     texture whose period is one pixel — and is blind to everything coarser: a
     weave, a felt, a leaf relief, a brushed panel. Those vary over five or ten
     pixels, so against a 3x3 mean they look perfectly smooth, and a page built
     entirely out of them reported "no grain, the flat areas are flat to the
     pixel". They are not flat, and the difference is most of what makes a
     surface look like a material rather than a fill.

     A second residual, against a mean spanning nine pixels, sees them. The
     larger of the two says how textured the surface is; which one is larger
     says what kind.
  */
  const tile = 16;
  let textured = 0;
  let flat = 0;
  const fines: number[] = [];
  const coarses: number[] = [];
  const stepY = Math.max(tile, Math.floor(h / 60));
  const stepX = Math.max(tile, Math.floor(w / 60));
  const lumaAt = (x: number, y: number) => {
    const q = (Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))) * 4;
    return luma(d[q], d[q + 1], d[q + 2]);
  };
  for (let ty = 1; ty + tile < h - 1; ty += stepY) {
    for (let tx = 1; tx + tile < w - 1; tx += stepX) {
      let fine = 0;
      let coarse = 0;
      let n = 0;
      let lo = 255;
      let hi = 0;
      for (let y = ty; y < ty + tile; y += 2) {
        for (let x = tx; x < tx + tile; x += 2) {
          const here = lumaAt(x, y);
          let near = 0;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) near += lumaAt(x + dx, y + dy);
          // Nine samples on a 3px stride: a mean spanning nine pixels for the
          // price of a 3x3.
          let far = 0;
          for (let dy = -3; dy <= 3; dy += 3) for (let dx = -3; dx <= 3; dx += 3) far += lumaAt(x + dx, y + dy);
          fine += Math.abs(here - near / 9);
          coarse += Math.abs(here - far / 9);
          n++;
          if (here < lo) lo = here;
          if (here > hi) hi = here;
        }
      }
      if (!n) continue;
      /*
         A tile holding a hard edge or a piece of photograph swings far more
         than any surface does. The old ceiling of 60 was set against fine
         grain and threw out every contrasty weave with it; 110 keeps the
         edges out and lets the materials through.
      */
      if (hi - lo > 110) continue;
      const f = fine / n;
      const c = coarse / n;
      if (Math.max(f, c) >= 1.2) {
        textured++;
        fines.push(f);
        coarses.push(c);
      } else flat++;
    }
  }
  const tiles = textured + flat;
  if (tiles < 12 || textured / tiles < 0.5) return { grain: null };
  const f = median(fines);
  const c = median(coarses);
  return {
    grain: {
      coverage: Math.round((textured / tiles) * 100) / 100,
      amplitude: Math.round(Math.max(f, c) * 10) / 10,
      /*
         Which scale carries it. Fine is grain — noise, fibre, film. Coarse is
         a weave: a material with a structure you could put a ruler on, and the
         thing that has to be reproduced with an image or a repeating
         background rather than with a noise filter.
      */
      scale: c > f * 1.15 ? ('weave' as const) : ('grain' as const),
    },
  };
  /*
     Still no PATTERN detection, and that is deliberate rather than unfinished.
     An autocorrelation of the edge profile does find a strong, confident period
     on almost every page — and the period it finds is the LEADING, because
     evenly spaced rows of prose are the most periodic thing on a page. It
     reported a 26px stripe pattern on a capture with no pattern in it at all.
     A detector that calls body text a texture is worse than no detector, so
     until it can be told from text it is not shipped. What is measured here is
     how rough a surface is and at what scale, which is a different question
     and an answerable one.
  */
}

// --- what repeats ------------------------------------------------------------

/**
 * The inset from a block's edge to the first thing drawn on it.
 *
 * Padding was never measured, so a card reported its size and its fill and
 * nothing about how its content sits inside — which is half of what makes a
 * component look like itself. It is a straightforward walk: step inward from
 * each edge until the colour stops being the block's own.
 */
function paddingOf(
  d: Uint8ClampedArray,
  w: number,
  h: number,
  b: Block,
): { top: number | null; right: number | null; bottom: number | null; left: number | null } {
  const same = (x: number, y: number) => {
    if (x < 0 || x >= w || y < 0 || y >= h) return false;
    const p = (y * w + x) * 4;
    const dr = d[p] - b.colour[0];
    const dg = d[p + 1] - b.colour[1];
    const db = d[p + 2] - b.colour[2];
    return dr * dr + dg * dg + db * db <= 26 * 26 * 3;
  };
  /*
     Along a line of samples, not down one column: a column through the middle
     of a card may run through a gap between two words and report the padding
     as half the card. The distance wanted is the SMALLEST inset any of the
     samples finds, which is where the content actually begins.
  */
  /*
     A rule around the block stops the walk at the rule, so a bordered card
     reported its 2px border as its padding and dragged the group's figure down
     with it. The border is part of the edge, not of the space inside it, so
     the walk starts beyond it — with a pixel for the antialiasing.
  */
  const inset = b.edge?.border ? Math.round(b.edge.border.px) + 1 : 0;
  const walk = (along: number, at: (o: number, k: number) => [number, number]) => {
    const limit = Math.min(Math.floor(Math.min(b.w, b.h) / 2), 160);
    let best = limit + 1;
    const count = Math.min(24, Math.max(4, Math.floor(along / 12)));
    // The corners are rounded away from the block's own colour, so a sample
    // taken at one breaks on the first pixel and reports no padding at all.
    const margin = Math.round(along * 0.1);
    const span = along - 1 - margin * 2;
    if (span <= 0 || inset >= limit) return null;
    for (let i = 0; i < count; i++) {
      const o = margin + Math.round((i * span) / Math.max(1, count - 1));
      let k = inset;
      while (k < limit) {
        const [x, y] = at(o, k);
        if (!same(x, y)) break;
        k++;
      }
      if (k < limit && k < best) best = k;
    }
    return best > limit ? null : best;
  };
  /*
     Each side stands alone. A card whose content sits at the top has nothing
     within reach of its bottom edge, and requiring all four to answer threw
     away the three that had — every card in a test scene reported no padding
     at all because its text stopped two thirds of the way down.
  */
  return {
    top: walk(b.w, (o, k) => [b.x + o, b.y + k]),
    bottom: walk(b.w, (o, k) => [b.x + o, b.y + b.h - 1 - k]),
    left: walk(b.h, (o, k) => [b.x + k, b.y + o]),
    right: walk(b.h, (o, k) => [b.x + b.w - 1 - k, b.y + o]),
  };
}

/** Blocks of near-identical size, which is what makes a grid a grid. */
function repeats(blocks: Block[], tolerance = 0.12) {
  const groups: Block[][] = [];
  for (const b of blocks) {
    const group = groups.find(
      (g) =>
        Math.abs(g[0].w - b.w) <= g[0].w * tolerance &&
        Math.abs(g[0].h - b.h) <= g[0].h * tolerance,
    );
    if (group) group.push(b);
    else groups.push([b]);
  }
  return groups.sort((a, b) => b.length - a.length);
}

/**
 * Blocks that sit on one baseline, which is what makes a row of controls a
 * row rather than a coincidence.
 *
 * A toolbar, a tab strip and a pair of buttons are all "small blocks of the
 * same height", and geometry alone will not tell them apart. What does tell
 * them apart is how they are spaced: tabs touch, a toolbar breathes, and two
 * buttons are two buttons. So the grouping is by shared top edge and matching
 * height, and the naming is left to the caller, which knows how many there
 * are and how far apart.
 */
function baselineRow(blocks: Block[], tolerance = 0.15): Block[][] {
  const rows: Block[][] = [];
  for (const b of blocks.slice().sort((p, q) => p.x - q.x)) {
    const row = rows.find(
      (r) =>
        Math.abs(r[0].y - b.y) <= 6 &&
        Math.abs(r[0].h - b.h) <= Math.max(3, r[0].h * tolerance),
    );
    if (row) row.push(b);
    else rows.push([b]);
  }
  return rows.sort((a, b) => b.length - a.length);
}

/** The median gap between neighbours in a row, left to right. */
function rowGap(row: Block[]): number {
  const gaps: number[] = [];
  const byX = row.slice().sort((a, b) => a.x - b.x);
  for (let i = 1; i < byX.length; i++) gaps.push(byX[i].x - (byX[i - 1].x + byX[i - 1].w));
  return gaps.length ? median(gaps) : 0;
}

/**
 * The component inventory, from geometry alone.
 *
 * Only patterns with real evidence behind them are named — a band across the
 * top, a column down the side, four blocks the same size in a row. A single
 * rectangle is not called a card, because a single rectangle is not evidence
 * of anything. Each entry carries the count and the measured size, so the
 * reader can see what it was built from rather than trusting the noun.
 */
function measureComponents(
  d: Uint8ClampedArray,
  blocks: Block[],
  w: number,
  h: number,
  scale: number,
) {
  const px = (n: number) => Math.round(n * scale);
  /*
     Every entry says how it is edged, including when the answer is "not at
     all". Two cards of the same size, one hairlined and one borderless with a
     shadow, are different components; without this they were the same line.
  */
  /*
     A gradient block has no single hex, and saying "in #4f46e5" for one is a
     quiet lie — it names the colour the flood fill happened to seed on. Where
     a block ramps, the ramp is what it is filled with.
  */
  const fillOf = (group: Block | Block[]): string => {
    const all = Array.isArray(group) ? group : [group];
    const ramped = all.filter((b) => b.gradient);
    if (ramped.length === 0) return all[0].hex;
    const axes = [...new Set(ramped.map((b) => b.gradient!.axis))];
    const g = ramped[0].gradient!;
    // Four cards that all ramp but ramp differently are not one gradient, and
    // naming the first one's axis for all of them would say they are.
    const ramp =
      axes.length > 1
        ? `ramps of differing axes (${axes.join(', ')}), the first from ${g.from} to ${g.to}`
        : `a ${g.axis} ramp from ${g.from} to ${g.to}`;
    if (ramped.length === all.length) return ramp;
    return `${ramp} on ${ramped.length} of ${all.length}, flat ${all.find((b) => !b.gradient)!.hex} on the rest`;
  };

  /*
     What a repeated group is spaced like: the inset from its own edge to its
     content, and the distance from one of them to the next. Neither was
     reported, so a card grid gave its size and its colour and said nothing
     about the two figures somebody rebuilding it would have to invent.
  */
  const spacingOf = (group: Block[]): string => {
    const bits: string[] = [];
    /*
       A ramp drifts away from its seed colour within a pixel or two of the
       edge, so the inward walk stops immediately and calls that drift the
       start of the content: gradient-filled cards reported ~0px padding when
       there was nothing there to read. They cannot answer this question, and a
       zero from any block means the walk broke on the block's own edge rather
       than on anything inside it.
    */
    const pads = group.filter((b) => !b.gradient).map((b) => paddingOf(d, w, h, b));
    const sides = ['top', 'right', 'bottom', 'left'] as const;
    const measured = sides
      .map((k) => {
        const values = pads.map((p) => p[k]).filter((v): v is number => v !== null && v > 0);
        return values.length ? Math.round(median(values) * scale) : null;
      });
    const known = measured.filter((v): v is number => v !== null);
    if (known.length) {
      /*
         The tightest edge is the padding; the others are where the content
         happens to stop. Ragged text leaves a hundred pixels of clearance on
         the right of a card that is padded by twenty-eight, and reporting that
         as "73px right padding" is reporting the paragraph's rag as a design
         decision. So the minimum is the figure, and a wide spread is called
         what it is.
      */
      const tight = Math.min(...known);
      const loose = Math.max(...known);
      bits.push(
        loose > tight * 2
          ? `~${tight}px padding at its tightest edge (content stops up to ${loose}px short of ` +
            'another, which is its own rag rather than more padding)'
          : `~${tight}px padding`,
      );
    }
    if (group.length >= 2) {
      const byX = group.slice().sort((a, b) => a.x - b.x);
      const byY = group.slice().sort((a, b) => a.y - b.y);
      const xGaps: number[] = [];
      const yGaps: number[] = [];
      for (let i = 1; i < byX.length; i++) {
        const gap = byX[i].x - (byX[i - 1].x + byX[i - 1].w);
        if (gap > 0 && gap < w * 0.4) xGaps.push(gap);
      }
      for (let i = 1; i < byY.length; i++) {
        const gap = byY[i].y - (byY[i - 1].y + byY[i - 1].h);
        if (gap > 0 && gap < h * 0.4) yGaps.push(gap);
      }
      if (xGaps.length) bits.push(`~${Math.round(median(xGaps) * scale)}px apart across`);
      if (yGaps.length) bits.push(`~${Math.round(median(yGaps) * scale)}px apart down`);
    }
    const ratio = group[0].w / group[0].h;
    if (Math.abs(ratio - 1) > 0.06) bits.push(`${Math.round(ratio * 100) / 100}:1`);
    return bits.length ? `, ${bits.join(', ')}` : '';
  };

  const edging = (group: Block | Block[]): string => {
    const all = Array.isArray(group) ? group : [group];
    const known = all.filter((b) => b.edge);
    if (known.length === 0) return '';
    const n = known.length;
    const bordered = known.filter((b) => b.edge!.border);
    const shadowed = known.filter((b) => b.edge!.shadow);
    const parts: string[] = [];

    // A group whose members disagree is reported as the split it is. Taking
    // the first member's edging spoke for all of them, so a row of four cards
    // where two were hairlined read as four borderless ones.
    if (bordered.length === 0) parts.push('borderless');
    else {
      const b = bordered[0].edge!.border!;
      const rule = `${px(b.px)}px ${b.hex} border`;
      parts.push(bordered.length === n ? rule : `${rule} on ${bordered.length} of ${n}`);
    }
    if (shadowed.length === 0) parts.push('no shadow');
    else {
      const sh = shadowed[0].edge!.shadow!;
      const cast = `${px(sh.spread)}px shadow at ${sh.strength}/255`;
      parts.push(shadowed.length === n ? cast : `${cast} on ${shadowed.length} of ${n}`);
    }
    return `, ${parts.join(', ')}`;
  };
  const wide = (b: Block) => b.w >= w * 0.85;
  const pool = solidBlocks(blocks, w, h);
  const found: string[] = [];
  /*
     The same inventory, kept as data as well as prose. The line of text is
     what a person reads; the role is what the export needs in order to say
     how the thing BEHAVES — a band across the top and a row of pills are
     different geometry and different interaction, and only the noun says
     which is which.
  */
  const roles: ComponentRole[] = [];
  const add = (role: string, count: number, detail: string) => {
    found.push(`${role} — ${detail}`);
    roles.push({ role, count });
  };

  /*
     Each block is claimed by at most one name, largest structure first. The
     first version let every rule see every block and the same six pills came
     back as buttons and as badges — an inventory that counts one thing twice
     is worse than one that misses it.
  */
  const claimed = new Set<Block>();
  const free = () => pool.filter((b) => !claimed.has(b));
  const claim = <T extends Block | Block[]>(what: T): T => {
    for (const b of Array.isArray(what) ? what : [what]) claimed.add(b);
    return what;
  };
  const first = (test: (b: Block) => boolean) =>
    free().sort((a, b) => b.area - a.area).find(test) ?? null;

  const bar = first((b) => wide(b) && b.y <= h * 0.04 && b.h <= h * 0.16 && b.h >= 16);
  if (bar) {
    claim(bar);
    add('top navigation', 1, `full-width band ~${px(bar.h)}px tall in ${fillOf(bar)}${edging(bar)}`);
  }

  const rail = first(
    (b) => b.h >= h * 0.6 && b.w <= w * 0.32 && b.w >= 40 && (b.x <= w * 0.03 || b.x + b.w >= w * 0.97),
  );
  if (rail) {
    claim(rail);
    const side = rail.x <= w * 0.03 ? 'left' : 'right';
    add('sidebar navigation', 1, `${side} rail ~${px(rail.w)}px wide in ${fillOf(rail)}${edging(rail)}`);
  }

  const foot = first((b) => wide(b) && b.y + b.h >= h * 0.96 && b.h <= h * 0.3 && b.h >= 24);
  if (foot) {
    claim(foot);
    add('footer', 1, `full-width band ~${px(foot.h)}px tall in ${fillOf(foot)}${edging(foot)}`);
  }

  /*
     A hero is no longer conditional on there being no top bar. It was, and
     that was a mistake of convenience rather than of evidence: a page with a
     nav band AND a hero under it is the commonest arrangement there is, and
     the rule silently threw the hero away on every one of them. What keeps
     the two apart is that the bar is claimed first, so a hero is whatever
     wide block is left under it.
  */
  const hero = first(
    (b) => b.w >= w * 0.6 && b.h >= h * 0.2 && b.y <= h * 0.35 && b.h <= h * 0.75,
  );
  if (hero) {
    claim(hero);
    add('hero', 1, `~${px(hero.w)}×${px(hero.h)}px block in ${fillOf(hero)}${edging(hero)}`);
  }

  const cards = repeats(
    free().filter((b) => b.w >= 120 && b.h >= 80 && b.w <= w * 0.6 && b.h <= h * 0.8),
  )[0];
  if (cards && cards.length >= 3) {
    claim(cards);
    const columns = new Set(cards.map((c) => Math.round(c.x / Math.max(1, cards[0].w * 0.5)))).size;
    add(
      'card grid',
      cards.length,
      `${cards.length} blocks of ~${px(cards[0].w)}×${px(cards[0].h)}px` +
        (columns > 1 ? ` across ${columns} columns` : ' stacked') +
        ` in ${fillOf(cards)}` +
        spacingOf(cards) +
        edging(cards),
    );
  }

  const rows = repeats(free().filter((b) => b.w >= w * 0.5 && b.h <= 80 && b.h >= 20))[0];
  if (rows && rows.length >= 4) {
    claim(rows);
    add(
      'data table / list',
      rows.length,
      `${rows.length} rows of ~${px(rows[0].h)}px in ${fillOf(rows)}` + spacingOf(rows) + edging(rows),
    );
  }

  /*
     A block that floats: away from every edge, near the middle, and big enough
     to be the thing you are looking at rather than a card in a grid. That is a
     dialog, and it is worth naming separately because nothing else on a page
     behaves like one — it takes the focus, it traps it, and it closes.
  */
  const dialog = first(
    (b) =>
      b.area >= w * h * 0.12 &&
      b.area <= w * h * 0.7 &&
      b.x >= w * 0.04 &&
      b.y >= h * 0.04 &&
      b.x + b.w <= w * 0.96 &&
      b.y + b.h <= h * 0.96 &&
      Math.abs(b.x + b.w / 2 - w / 2) <= w * 0.08,
  );
  if (dialog) {
    claim(dialog);
    add(
      'modal / dialog',
      1,
      `~${px(dialog.w)}×${px(dialog.h)}px, centred and clear of every edge, in ` +
        `${fillOf(dialog)}${spacingOf([dialog])}${edging(dialog)}`,
    );
  }

  /*
     Rows of same-height controls, told apart by their spacing rather than by
     their shape, because their shape is identical. Tabs touch or nearly touch;
     a toolbar leaves room between its controls. Tested in that order, tightest
     first, so a tab strip is never reported as a toolbar.
  */
  /*
     Wider than tall by half again, which is what keeps a row of icon buttons
     out of here. A square in a row of squares is an icon button — it was being
     reported as a filter row, and "3 controls of ~44x44px" is a sentence that
     describes the right pixels under the wrong noun.
  */
  /*
     Small and fully rounded is a badge, and it is tested for below. It has to
     be excluded here as well, because a row of six of them is also a row of
     same-height controls on one baseline — and being tested first, the toolbar
     rule took them and described six labels as six filter controls. Shape is
     the only thing that separates the two, so the more specific shape gets
     first claim rather than the earlier rule.
  */
  const badgeShaped = (b: Block) =>
    b.h <= 34 && b.radius !== null && b.radius >= b.h * 0.4;
  const controlRows = baselineRow(
    free().filter(
      (b) => b.h >= 20 && b.h <= 72 && b.w >= b.h * 1.5 && b.w <= w * 0.5 && !badgeShaped(b),
    ),
  ).filter((r) => r.length >= 3);

  const tabs = controlRows.find((r) => rowGap(r) <= 8);
  if (tabs) {
    claim(tabs);
    add(
      'tabs / segmented control',
      tabs.length,
      `${tabs.length} segments of ~${px(tabs[0].w)}×${px(tabs[0].h)}px, ` +
        `${px(rowGap(tabs))}px apart — close enough to read as one control — in ` +
        `${fillOf(tabs)}${edging(tabs)}`,
    );
  }

  const toolbar = controlRows.find((r) => !claimed.has(r[0]) && rowGap(r) > 8);
  if (toolbar) {
    claim(toolbar);
    const span = Math.max(...toolbar.map((b) => b.x + b.w)) - Math.min(...toolbar.map((b) => b.x));
    add(
      'toolbar / filter row',
      toolbar.length,
      `${toolbar.length} controls of ~${px(toolbar[0].w)}×${px(toolbar[0].h)}px on one baseline, ` +
        `${px(rowGap(toolbar))}px apart, spanning ~${px(span)}px in ${fillOf(toolbar)}` +
        edging(toolbar),
    );
  }

  /*
     A field is a long, short, BORDERED box. The border is what does the work
     here: a fill of the same shape is a button, and the thing that tells a
     person they may type into it is the rule around the empty space. Without
     that test this rule named every wide pill an input.
  */
  const fields = free().filter(
    (b) =>
      b.edge?.border &&
      b.h >= 24 &&
      b.h <= 64 &&
      b.w >= b.h * 3.5 &&
      b.w <= w * 0.9,
  );
  if (fields.length) {
    claim(fields);
    const f = fields[0];
    add(
      'input / search field',
      fields.length,
      `${fields.length} of ~${px(f.w)}×${px(f.h)}px in ${fillOf(fields)}${spacingOf(fields)}` +
        edging(fields),
    );
  }

  // Fully rounded and small enough to be a label rather than an action.
  const pills = repeats(
    free().filter(
      (b) =>
        b.h >= 14 && b.w >= b.h * 1.4 && b.w <= 220 && badgeShaped(b),
    ),
  )[0];
  if (pills && pills.length >= 2) {
    claim(pills);
    add(
      'badge / pill',
      pills.length,
      `${pills.length} of ~${px(pills[0].w)}×${px(pills[0].h)}px in ${fillOf(pills[0])}${edging(pills)}`,
    );
  }

  const buttons = repeats(
    free().filter((b) => b.h >= 24 && b.h <= 72 && b.w >= b.h * 1.6 && b.w <= 420 && b.fill > 0.9),
  )[0];
  if (buttons && buttons.length >= 1) {
    claim(buttons);
    const shape =
      buttons[0].radius !== null && buttons[0].radius >= buttons[0].h * 0.45
        ? 'fully rounded'
        : `~${px(buttons[0].radius ?? 0)}px corners`;
    add(
      'button',
      buttons.length,
      `${shape}, ~${px(buttons[0].w)}×${px(buttons[0].h)}px in ${fillOf(buttons[0])}` +
        spacingOf(buttons) +
        edging(buttons) +
        (buttons.length > 1 ? ` (${buttons.length} of them)` : ''),
    );
  }

  /*
     Square, small, filled, and standing in a row — an icon button. Kept apart
     from the avatar rule below by its corners: an avatar is a circle and an
     icon button is not, and where the radius says circle the avatar rule
     should have it.
  */
  const iconRow = baselineRow(
    free().filter(
      (b) =>
        Math.abs(b.w - b.h) <= b.w * 0.2 &&
        b.w >= 22 &&
        b.w <= 64 &&
        b.fill > 0.85 &&
        (b.radius === null || b.radius < b.w * 0.42),
    ),
  ).find((r) => r.length >= 2);
  if (iconRow) {
    claim(iconRow);
    add(
      'icon button',
      iconRow.length,
      `${iconRow.length} squares of ~${px(iconRow[0].w)}px, ${px(rowGap(iconRow))}px apart in ` +
        `${fillOf(iconRow)}${edging(iconRow)}`,
    );
  }

  const avatars = free().filter(
    (b) =>
      Math.abs(b.w - b.h) <= b.w * 0.15 && b.w >= 24 && b.w <= 96 &&
      b.radius !== null && b.radius >= b.w * 0.42,
  );
  if (avatars.length >= 2) {
    claim(avatars);
    add(
      'avatar',
      avatars.length,
      `${avatars.length} circles of ~${px(avatars[0].w)}px in ${fillOf(avatars)}` + edging(avatars),
    );
  }

  return { found, roles, samples: pool.length };
}

/**
 * Small compact shapes: the icon set, sized, and drawn at what weight.
 *
 * The stroke is the same measurement the type pass makes for a stem — the
 * commonest run of ink along a scan line through the shape — because an icon's
 * stroke and a letter's stem are the same thing. It was not being read, so the
 * export told its reader to match the stroke "to the body text weight", which
 * is a convention standing in for a number that was there to be measured.
 */
function measureIcons(blocks: Block[], scale: number) {
  const icons = blocks.filter(
    (b) => Math.abs(b.w - b.h) <= Math.max(4, b.w * 0.3) && b.w >= 10 && b.w <= 48,
  );
  if (icons.length < 3) return null;

  /*
     An outlined icon reaches the flood as TWO regions: the ink of the ring,
     whose bounding box is the icon's outer edge, and the page-coloured hole it
     encloses, whose box is the inner edge. Half the difference between them is
     the stroke, and it is the only reading here that is actually a
     measurement. Scanning ink runs inside the ring — the first attempt — found
     only the antialiasing and reported 1px against a painted 5px stroke,
     because the hole itself is wider than the half-width cutoff and every
     genuine run is thrown away.
  */
  const widths: number[] = [];
  for (const ring of icons) {
    if (ring.fill >= 0.75) continue; // solid, so there is no stroke to read
    for (const hole of blocks) {
      const left = hole.x - ring.x;
      const top = hole.y - ring.y;
      const right = ring.x + ring.w - (hole.x + hole.w);
      const bottom = ring.y + ring.h - (hole.y + hole.h);
      if (left < 1 || top < 1 || right < 1 || bottom < 1) continue;
      // Centred inside it, or it is a neighbour that merely overlaps.
      if (Math.abs(left - right) > 2 || Math.abs(top - bottom) > 2) continue;
      const [dr, dg, db] = [0, 1, 2].map((i) => ring.colour[i] - hole.colour[i]);
      if (dr * dr + dg * dg + db * db < 40 * 40 * 3) continue;
      widths.push((left + right + top + bottom) / 4);
      break;
    }
  }

  /*
     Reported only where the shapes agree. The square-ish filter above is right
     for counting things that might be icons, but it also takes in glyph
     clusters, and an 'o' is a ring with a hole in it too. A stroke that is
     several times wrong some of the time is worse than saying nothing, so it
     needs three shapes drawn alike and a clear majority at the same width.
  */
  const commonest = widths.length >= 3 ? modal(widths, 0) : null;
  const agreed =
    commonest !== null &&
    widths.filter((v) => Math.abs(v - commonest) <= 1).length / widths.length >= 0.6
      ? commonest
      : null;

  return {
    count: icons.length,
    px: Math.round(median(icons.map((b) => b.w)) * scale),
    stroke: agreed === null ? null : Math.round(agreed * scale * 10) / 10,
  };
}

export function measureStructure(
  sample: { data: Uint8ClampedArray; width: number; height: number; scale: number },
  blocks: Block[],
): StructureMeasurement {
  const { data, width: w, height: h, scale } = sample;
  const components = measureComponents(data, blocks, w, h, scale);
  const texture = measureTexture(data, w, h);
  return {
    frame: measureFrame(data, w, h, scale),
    grain: texture.grain,
    gradient: measureGradient(data, w, h),
    imagery: measureImagery(data, w, h, scale),
    components: components.found,
    roles: components.roles,
    blocks: components.samples,
    icons: measureIcons(blocks, scale),
  };
}
