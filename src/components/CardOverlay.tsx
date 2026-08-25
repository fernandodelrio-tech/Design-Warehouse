import type { CSSProperties } from 'react';
import { readableOn } from '../lib/color';
import { edgeFor, groundOf, surfaceOf } from '../lib/measured-colors';
import type { DesignRecord } from '../lib/types';

/**
 * The measurement sheet, registered onto the screenshot it was taken from.
 *
 * The tile used to carry a footer of four overlapping representations — a
 * palette strip, a dimensions line, two label/value rows and a chip row —
 * stacked under a cropped screenshot in a 400px box. Every one of them was a
 * measurement rendered as a string, and together they took more of the tile
 * than the picture did. A wall of them is unscannable: you recognise a design
 * by its screenshot, and the screenshot was the smaller half.
 *
 * So the tile is a picture, and this appears over it only for the tile being
 * attended to. Two zones, and the split is deliberate:
 *
 *   - The DRAWINGS sit directly on the screenshot with nothing behind them.
 *     A corner block at the measured radius, wearing the measured hairline
 *     and throwing the measured cast, plus a rule at each measured gutter.
 *     Geometry does not need a contrast ratio to be read, and putting it on
 *     the design means you check it against the design.
 *   - The FIGURES sit in a solid slab at the foot, on the design's own
 *     measured background with ink chosen to clear it. Text over an unknown
 *     screenshot is a gamble; text over a colour we measured is not.
 *
 * Nothing here resizes the tile and nothing displaces the picture.
 */

interface Props {
  record: DesignRecord;
  /**
   * Whether the tile is showing a crop. The picture carries its own badge for
   * this, and the slab is opaque and lands on the same bottom edge — so while
   * the sheet is up the badge is behind it. On a coarse pointer the sheet is
   * never down, which made the crop affordance permanently invisible there.
   * The sheet says it instead, and the badge steps aside.
   */
  cropped: boolean;
}

/**
 * The corner block is 72px, so a radius past half of that would round it into
 * a pill and stop being a radius. Past the cap the figure is still exact and
 * the caption says the drawing is not.
 */
const MAX_RADIUS = 36;

/** One row of the slab: what was measured, the figure, and how firmly. */
function Row({
  label,
  value,
  samples,
}: {
  label: string;
  value: string;
  /** Absent where the figure carries no sample count — dimensions, say. */
  samples?: string;
}) {
  return (
    <div className="ov-row">
      <span className="ov-label">{label}</span>
      <span className="ov-value mono">{value}</span>
      {samples && <span className="ov-samples">{samples}</span>}
    </div>
  );
}

export function CardOverlay({ record, cropped }: Props) {
  const { auto, image, spec, tags } = record;
  const detail = auto.detail;
  const bg = groundOf(auto.palette);
  const fill = surfaceOf(auto.palette);
  const ink = readableOn(bg);
  const edge = edgeFor(bg, fill);

  const radius = detail?.radius ?? null;
  const border = detail?.border ?? null;
  const shadow = detail?.shadow ?? null;

  /*
     One drawing carries three measurements, because that is how they occur:
     a card has a corner, an edge and a cast at the same time, and separating
     them into three samples would invent a relationship the capture never
     had. Each keeps its own figure and its own count in the slab below.
  */
  const block = {
    background: fill,
    border: border ? `${border.px}px solid ${border.hex}` : `1px solid ${edge}`,
    borderRadius: `${Math.min(radius?.px ?? 0, MAX_RADIUS)}px`,
    boxShadow: shadow
      ? `0 ${Math.round(shadow.spread / 3)}px ${shadow.spread}px rgb(0 0 0 / ${(
          shadow.strength / 255
        ).toFixed(3)})`
      : 'none',
  };

  // Real measured positions, not a column count divided into equal parts: the
  // analyzer records where each gutter actually fell, and an evenly spaced
  // approximation would draw a grid the design does not have.
  const gutters = auto.layout.gutters.filter((x) => x > 0.02 && x < 0.98);

  const written = [spec.category, ...spec.styleKeywords.slice(0, 2), ...tags.slice(0, 2)]
    .filter(Boolean)
    .join(' · ');

  return (
    <div
      className="card-overlay"
      aria-hidden
      style={{ '--ov-ground': bg, '--ov-ink': ink } as CSSProperties}
    >
      {gutters.map((x, i) => (
        <span className="ov-gutter" key={`${x}-${i}`} style={{ left: `${x * 100}%` }} />
      ))}

      {detail && (radius || border || shadow) && (
        <span className="ov-block" style={block} />
      )}

      <div className="ov-slab">
        {!detail ? (
          // Absence of a pass is not a measurement of zero, and the tile has
          // to say which it is.
          <div className="ov-none">The geometry pass never ran on this design.</div>
        ) : (
          <>
            <Row
              label="Radius"
              value={radius ? `${radius.px}px` : 'none found'}
              samples={
                radius
                  ? `${radius.samples} corner${radius.samples === 1 ? '' : 's'}${
                      radius.px > MAX_RADIUS ? ' · drawn to 36px' : ''
                    }`
                  : undefined
              }
            />
            <Row
              label="Rule"
              value={border ? `${border.px}px ${border.hex}` : 'none found'}
              samples={
                border ? `${border.samples} edge${border.samples === 1 ? '' : 's'}` : undefined
              }
            />
            <Row
              label="Lift"
              value={shadow ? `${shadow.spread}px at ${shadow.strength}/255` : 'none found'}
              samples={
                shadow
                  ? `${shadow.samples} block${shadow.samples === 1 ? '' : 's'} · cast rebuilt`
                  : undefined
              }
            />
          </>
        )}

        <Row
          label="Grid"
          value={`${auto.layout.columns} col`}
          samples={`${auto.layout.densityLabel} · ${auto.colorScheme}`}
        />
        {/* Dimensions without the aspect string. The tile is the picture, so
            its shape is already on screen; "32:35" is the exact reduced ratio
            of 1280×1400 and reading it off a thumbnail you can see tells you
            nothing you did not have. The drawer still carries it. */}
        <Row label="Size" value={`${image.width}×${image.height}`} />

        {/* A fact about the tile rather than about the design, which is why it
            is not a measured row: the screenshot is longer than the box. */}
        {cropped && <div className="ov-crop">Cropped — full length on open</div>}

        {/* Written rather than measured, and kept apart so the difference is
            visible rather than asserted. */}
        {written && <div className="ov-written">{written}</div>}
      </div>
    </div>
  );
}
