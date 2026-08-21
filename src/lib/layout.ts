import type { LayoutEstimate } from './types';

/**
 * Structural guesses read off the pixels.
 *
 * Everything here is a heuristic on edge energy: where a screenshot has flat,
 * uninterrupted bands we call it a gutter or a section break, and where it has
 * busy gradients we call it content. It is a starting point for the spec, not
 * a source of truth — the editor lets you correct any of it.
 */

interface Run {
  start: number;
  end: number;
}

function findLowRuns(energy: number[], threshold: number, minLength: number): Run[] {
  const runs: Run[] = [];
  let start = -1;
  for (let i = 0; i < energy.length; i++) {
    if (energy[i] <= threshold) {
      if (start === -1) start = i;
    } else if (start !== -1) {
      if (i - start >= minLength) runs.push({ start, end: i - 1 });
      start = -1;
    }
  }
  if (start !== -1 && energy.length - start >= minLength) {
    runs.push({ start, end: energy.length - 1 });
  }
  return runs;
}

function firstAbove(energy: number[], threshold: number): number {
  for (let i = 0; i < energy.length; i++) if (energy[i] > threshold) return i;
  return 0;
}

function lastAbove(energy: number[], threshold: number): number {
  for (let i = energy.length - 1; i >= 0; i--) if (energy[i] > threshold) return i;
  return energy.length - 1;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Collapse positions that sit within `tolerance` of each other into their mean. */
function mergeNearby(positions: number[], tolerance: number): number[] {
  const sorted = positions.slice().sort((a, b) => a - b);
  const groups: number[][] = [];
  for (const value of sorted) {
    const last = groups[groups.length - 1];
    if (last && value - last[last.length - 1] <= tolerance) last.push(value);
    else groups.push([value]);
  }
  return groups.map((g) => round2(g.reduce((a, b) => a + b, 0) / g.length));
}

export function estimateLayout(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): LayoutEstimate {
  const gray = new Float32Array(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }

  const edge = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      const dx = x + 1 < width ? Math.abs(gray[p + 1] - gray[p]) : 0;
      const dy = y + 1 < height ? Math.abs(gray[p + width] - gray[p]) : 0;
      edge[p] = dx + dy;
    }
  }

  const colEnergy = new Array<number>(width).fill(0);
  const rowEnergy = new Array<number>(height).fill(0);
  let busy = 0;
  let flat = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const e = edge[y * width + x];
      colEnergy[x] += e;
      rowEnergy[y] += e;
      if (e > 12) busy++;
      else if (e <= 3) flat++;
    }
  }
  for (let x = 0; x < width; x++) colEnergy[x] /= height;
  for (let y = 0; y < height; y++) rowEnergy[y] /= width;

  const meanCol = colEnergy.reduce((a, b) => a + b, 0) / Math.max(1, width);
  const meanRow = rowEnergy.reduce((a, b) => a + b, 0) / Math.max(1, height);
  const contentColThreshold = Math.max(0.6, meanCol * 0.18);
  const contentRowThreshold = Math.max(0.6, meanRow * 0.18);

  const left = firstAbove(colEnergy, contentColThreshold);
  const right = lastAbove(colEnergy, contentColThreshold);
  const top = firstAbove(rowEnergy, contentRowThreshold);
  const bottom = lastAbove(rowEnergy, contentRowThreshold);

  // Gutters: quiet vertical bands strictly inside the content box.
  const innerCols = colEnergy.slice(left, right + 1);
  const gutterRuns = findLowRuns(
    innerCols,
    Math.max(0.5, meanCol * 0.14),
    Math.max(2, Math.round(width * 0.015)),
  )
    .filter((r) => r.start > 2 && r.end < innerCols.length - 3)
    .sort((a, b) => b.end - b.start - (a.end - a.start))
    .slice(0, 5)
    .sort((a, b) => a.start - b.start);

  const gutters = mergeNearby(
    gutterRuns.map((r) => round2((left + (r.start + r.end) / 2) / width)),
    0.05,
  );
  const columns = Math.min(6, gutters.length + 1);

  // Section breaks: quiet horizontal bands — the seams between stacked blocks.
  const innerRows = rowEnergy.slice(top, bottom + 1);
  const breakRuns = findLowRuns(
    innerRows,
    Math.max(0.5, meanRow * 0.12),
    Math.max(2, Math.round(height * 0.02)),
  ).filter((r) => r.start > 2 && r.end < innerRows.length - 3);
  // Keep the widest quiet bands only: every gap between two table rows is a
  // "break" by the raw measure, and a list of twelve of them says nothing.
  const sectionBreaks = mergeNearby(
    breakRuns
      .slice()
      .sort((a, b) => b.end - b.start - (a.end - a.start))
      .slice(0, 6)
      .map((r) => round2((top + (r.start + r.end) / 2) / height)),
    0.05,
  );

  const totalPixels = width * height || 1;
  const density = round2(busy / totalPixels);
  const whitespaceRatio = round2(flat / totalPixels);
  const densityLabel: LayoutEstimate['densityLabel'] =
    density < 0.1 ? 'sparse' : density < 0.24 ? 'balanced' : 'dense';

  const margins = {
    top: round2(top / height),
    right: round2((width - 1 - right) / width),
    bottom: round2((height - 1 - bottom) / height),
    left: round2(left / width),
  };

  const columnPhrase =
    columns <= 1
      ? 'a single content column'
      : `about ${columns} primary columns (gutters near ${gutters
          .map((g) => `${Math.round(g * 100)}%`)
          .join(', ')} of the width)`;
  const sectionPhrase =
    sectionBreaks.length === 0
      ? 'no strong horizontal seams'
      : `${sectionBreaks.length + 1} stacked sections`;
  const marginPhrase = `outer margins roughly ${Math.round(
    margins.left * 100,
  )}% left / ${Math.round(margins.right * 100)}% right / ${Math.round(
    margins.top * 100,
  )}% top`;

  const summary = `Reads as ${columnPhrase}, ${sectionPhrase}, ${marginPhrase}. Visual density is ${densityLabel} (${Math.round(
    density * 100,
  )}% of the canvas carries detail, ${Math.round(
    whitespaceRatio * 100,
  )}% is flat space).`;

  return {
    columns,
    gutters,
    sectionBreaks,
    density,
    densityLabel,
    whitespaceRatio,
    margins,
    summary,
  };
}
