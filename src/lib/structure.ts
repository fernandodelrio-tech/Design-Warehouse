import { solidBlocks } from './measure';
import type { Block } from './measure';
import type { StructureMeasurement } from './types';

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
 * Photographic regions, told apart from UI by colour variety. A tile of
 * interface holds a handful of flat colours however busy it looks; a tile of
 * photograph holds dozens, because a lens does not produce flat fills.
 */
function measureImagery(d: Uint8ClampedArray, w: number, h: number, scale: number) {
  const tile = 24;
  let photographic = 0;
  let total = 0;
  let minX = w, maxX = 0, minY = h, maxY = 0;
  for (let ty = 0; ty + tile <= h; ty += tile) {
    for (let tx = 0; tx + tile <= w; tx += tile) {
      total++;
      const seen = new Set<number>();
      for (let y = ty; y < ty + tile; y += 2) {
        for (let x = tx; x + 1 < tx + tile; x += 2) {
          const p = (y * w + x) * 4;
          // 5 bits per channel: finer than this and antialiasing alone counts
          // as variety, coarser and a photograph collapses to a few buckets.
          seen.add(((d[p] >> 3) << 10) | ((d[p + 1] >> 3) << 5) | (d[p + 2] >> 3));
        }
      }
      if (seen.size >= 48) {
        photographic++;
        if (tx < minX) minX = tx;
        if (tx + tile > maxX) maxX = tx + tile;
        if (ty < minY) minY = ty;
        if (ty + tile > maxY) maxY = ty + tile;
      }
    }
  }
  if (!total) return null;
  const coverage = photographic / total;
  if (coverage < 0.02) return { coverage: 0, box: null, samples: total };
  return {
    coverage: Math.round(coverage * 100) / 100,
    box: {
      x: Math.round(minX * scale),
      y: Math.round(minY * scale),
      w: Math.round((maxX - minX) * scale),
      h: Math.round((maxY - minY) * scale),
    },
    samples: photographic,
  };
}

// --- what repeats ------------------------------------------------------------

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
 * The component inventory, from geometry alone.
 *
 * Only patterns with real evidence behind them are named — a band across the
 * top, a column down the side, four blocks the same size in a row. A single
 * rectangle is not called a card, because a single rectangle is not evidence
 * of anything. Each entry carries the count and the measured size, so the
 * reader can see what it was built from rather than trusting the noun.
 */
function measureComponents(blocks: Block[], w: number, h: number, scale: number) {
  const px = (n: number) => Math.round(n * scale);
  /*
     Every entry says how it is edged, including when the answer is "not at
     all". Two cards of the same size, one hairlined and one borderless with a
     shadow, are different components; without this they were the same line.
  */
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
    found.push(`top navigation — full-width band ~${px(bar.h)}px tall in ${bar.hex}${edging(bar)}`);
  }

  const rail = first(
    (b) => b.h >= h * 0.6 && b.w <= w * 0.32 && b.w >= 40 && (b.x <= w * 0.03 || b.x + b.w >= w * 0.97),
  );
  if (rail) {
    claim(rail);
    const side = rail.x <= w * 0.03 ? 'left' : 'right';
    found.push(`sidebar navigation — ${side} rail ~${px(rail.w)}px wide in ${rail.hex}${edging(rail)}`);
  }

  const foot = first((b) => wide(b) && b.y + b.h >= h * 0.96 && b.h <= h * 0.3 && b.h >= 24);
  if (foot) {
    claim(foot);
    found.push(`footer — full-width band ~${px(foot.h)}px tall in ${foot.hex}${edging(foot)}`);
  }

  if (!bar) {
    const hero = first((b) => b.w >= w * 0.6 && b.h >= h * 0.2 && b.y <= h * 0.25);
    if (hero) {
      claim(hero);
      found.push(`hero section — ~${px(hero.w)}×${px(hero.h)}px block in ${hero.hex}${edging(hero)}`);
    }
  }

  const cards = repeats(
    free().filter((b) => b.w >= 120 && b.h >= 80 && b.w <= w * 0.6 && b.h <= h * 0.8),
  )[0];
  if (cards && cards.length >= 3) {
    claim(cards);
    const columns = new Set(cards.map((c) => Math.round(c.x / Math.max(1, cards[0].w * 0.5)))).size;
    found.push(
      `card grid — ${cards.length} blocks of ~${px(cards[0].w)}×${px(cards[0].h)}px` +
        (columns > 1 ? ` across ${columns} columns` : ' stacked') + edging(cards),
    );
  }

  const rows = repeats(free().filter((b) => b.w >= w * 0.5 && b.h <= 80 && b.h >= 20))[0];
  if (rows && rows.length >= 4) {
    claim(rows);
    found.push(`data table / list — ${rows.length} rows of ~${px(rows[0].h)}px${edging(rows)}`);
  }

  // Fully rounded and small enough to be a label rather than an action.
  const pills = repeats(
    free().filter(
      (b) =>
        b.h >= 14 && b.h <= 34 && b.w >= b.h * 1.4 && b.w <= 220 &&
        b.radius !== null && b.radius >= b.h * 0.4,
    ),
  )[0];
  if (pills && pills.length >= 2) {
    claim(pills);
    found.push(
      `badge / pill — ${pills.length} of ~${px(pills[0].w)}×${px(pills[0].h)}px in ` +
        `${pills[0].hex}${edging(pills)}`,
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
    found.push(
      `button — ${shape}, ~${px(buttons[0].w)}×${px(buttons[0].h)}px in ${buttons[0].hex}` +
        edging(buttons) +
        (buttons.length > 1 ? ` (${buttons.length} of them)` : ''),
    );
  }

  const avatars = free().filter(
    (b) =>
      Math.abs(b.w - b.h) <= b.w * 0.15 && b.w >= 24 && b.w <= 96 &&
      b.radius !== null && b.radius >= b.w * 0.42,
  );
  if (avatars.length >= 2) {
    claim(avatars);
    found.push(`avatar — ${avatars.length} circles of ~${px(avatars[0].w)}px${edging(avatars)}`);
  }

  return { found, samples: pool.length };
}

/** Small compact shapes: the icon set, sized. */
function measureIcons(blocks: Block[], scale: number) {
  const icons = blocks.filter(
    (b) => Math.abs(b.w - b.h) <= Math.max(4, b.w * 0.3) && b.w >= 10 && b.w <= 48,
  );
  if (icons.length < 3) return null;
  return {
    count: icons.length,
    px: Math.round(median(icons.map((b) => b.w)) * scale),
  };
}

export function measureStructure(
  sample: { data: Uint8ClampedArray; width: number; height: number; scale: number },
  blocks: Block[],
): StructureMeasurement {
  const { data, width: w, height: h, scale } = sample;
  const components = measureComponents(blocks, w, h, scale);
  return {
    frame: measureFrame(data, w, h, scale),
    gradient: measureGradient(data, w, h),
    imagery: measureImagery(data, w, h, scale),
    components: components.found,
    blocks: components.samples,
    icons: measureIcons(blocks, scale),
  };
}
