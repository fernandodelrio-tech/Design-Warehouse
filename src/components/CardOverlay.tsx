import type { CSSProperties } from 'react';
import { readableOn } from '../lib/color';
import { edgeFor, groundOf, surfaceOf } from '../lib/measured-colors';
import { coverScale, useStageSize } from '../lib/stage';
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
 *     A corner block at the measured radius, wearing the measured hairline,
 *     plus a rule at each measured gutter. Geometry does not need a contrast
 *     ratio to be read, and putting it on the design means you check it
 *     against the design.
 *
 *     Which only works if it actually registers. The thumbnail is the source
 *     scaled by a quarter or less and cropped by `object-fit: cover`, so a
 *     drawing placed in tile coordinates lands nowhere near what it measured:
 *     a 12px corner drawn at 12px sits beside the design's own corners at 3px
 *     and reads as a different radius, and a gutter measured a quarter of the
 *     way across a wide capture lands a quarter of the way across the tile
 *     when the sides of that capture are not on screen at all. So the
 *     drawings live in `.ov-frame`, a box that reproduces the image's cover
 *     geometry exactly. Inside it a percentage IS a source coordinate, and
 *     the drawings scale with the picture instead of floating over it.
 *   - The FIGURES sit in a solid slab at the foot, on the design's own
 *     measured background with ink chosen to clear it. Text over an unknown
 *     screenshot is a gamble; text over a colour we measured is not.
 *
 * Nothing here resizes the tile and nothing displaces the picture.
 */

interface Props {
  record: DesignRecord;
  /**
   * Which edge the tile's box cuts, or null when it cuts neither. The picture
   * carries its own badge for this, and the slab is opaque and lands on the
   * same bottom edge — so while the sheet is up the badge is behind it. On a
   * coarse pointer the sheet is never down, which made the crop affordance
   * permanently invisible there. The sheet says it instead, and the badge
   * steps aside.
   */
  cropped: 'sides' | 'foot' | null;
}

/**
 * The specimen's size in SOURCE pixels, so it draws at the same scale as the
 * design's own components — roughly one card of a typical capture. It shrinks
 * with the thumbnail exactly as the design does, which is what makes the
 * corner beside it comparable rather than merely nearby.
 */
const SPECIMEN = 260;

/** A sub-pixel rule renders as nothing; a 1px one renders as a hairline. */
const MIN_RULE = 1;

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

  // Source pixels to screen pixels for this tile's picture. Zero until the
  // first measurement lands, which is read as "not yet" rather than as a size.
  const scale = coverScale(useStageSize(), image.width, image.height);

  const radius = detail?.radius ?? null;
  const border = detail?.border ?? null;
  const shadow = detail?.shadow ?? null;

  /*
     One drawing carries the corner, the edge and the cast together, because
     that is how they occur: a card has all three at once, and splitting them
     would invent a relationship the capture never had.

     Every dimension is a source measurement multiplied by the picture's own
     display scale, so the specimen is a card of this design at the size this
     design's cards are drawn on this tile — which is what makes the corner
     beside it checkable rather than merely nearby. It sits in the tile's own
     corner, in tile coordinates, because that is where the contract puts it
     and because the frame's coordinates are off-screen on a wide capture.

     A hairline is the one measurement that cannot go below the device: a 1px
     rule at quarter scale is a quarter of a pixel, so it is floored at one and
     the slab carries the true width.
  */
  const px = (sourcePx: number) => `${(sourcePx * scale).toFixed(2)}px`;
  const block = scale
    ? {
        background: fill,
        width: px(SPECIMEN),
        height: px(SPECIMEN),
        borderWidth: `${Math.max(MIN_RULE, (border?.px ?? 1) * scale).toFixed(2)}px`,
        borderColor: border ? border.hex : edge,
        borderRadius: px(Math.min(radius?.px ?? 0, SPECIMEN / 2)),
        boxShadow: shadow
          ? `0 ${px(shadow.spread / 3)} ${px(shadow.spread)} rgb(0 0 0 / ${(
              shadow.strength / 255
            ).toFixed(3)})`
          : 'none',
      }
    : null;

  // Real measured positions, not a column count divided into equal parts: the
  // analyzer records where each gutter actually fell, and an evenly spaced
  // approximation would draw a grid the design does not have.
  const gutters = auto.layout.gutters.filter((x) => x > 0.02 && x < 0.98);

  const written = [spec.category, ...spec.styleKeywords.slice(0, 2), ...tags.slice(0, 2)]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="card-overlay" style={{ '--ov-ground': bg, '--ov-ink': ink } as CSSProperties}>
      {/*
         The drawings are the figures in another notation, so a screen reader
         is read the slab and spared the geometry.
      */}
      <div
        className="ov-frame"
        aria-hidden
        style={{ aspectRatio: `${image.width} / ${image.height}` }}
      >
        {gutters.map((x, i) => (
          <span className="ov-gutter" key={`${x}-${i}`} style={{ left: `${x * 100}%` }} />
        ))}

      </div>

      {/*
         In the tile's corner, not the frame's: the frame hangs off both sides
         of a wide capture, so its top-left is off-screen there. Outside the
         frame it also keeps its true proportions — a percentage width and a
         percentage height resolve against different axes, and one ratio
         applied to both squashed the specimen and turned its corner into an
         ellipse.
      */}
      {block && (radius || border || shadow) && <span className="ov-block" style={block} />}

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
                      // Past half the specimen the drawing is a pill rather
                      // than a corner. The figure stays exact either way.
                      radius.px > SPECIMEN / 2 ? ' · drawn to half' : ''
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
                  ? `${shadow.samples} block${shadow.samples === 1 ? '' : 's'} · figure only`
                  : undefined
              }
            />
          </>
        )}

        {/*
           The column count is documented in its own type as a best guess and
           is shipped elsewhere under "Estimated from the screenshot". It was
           set here in the same face as the radius, with the firmness slot
           spent on two attributes that are not a count — so an estimate wore
           a measurement's clothes. PRODUCT.md's second principle is binding
           and says the two must be told apart, so it says which it is.
        */}
        <Row label="Columns" value={`${auto.layout.columns}`} samples="estimated" />
        <Row
          label="Ground"
          value={auto.colorScheme}
          samples={`${auto.layout.densityLabel} · ${auto.saturation}`}
        />
        {/* Dimensions without the aspect string. The tile is the picture, so
            its shape is already on screen; "32:35" is the exact reduced ratio
            of 1280×1400 and reading it off a thumbnail you can see tells you
            nothing you did not have. The drawer still carries it. */}
        <Row label="Size" value={`${image.width}×${image.height}`} />

        {/*
           A fact about the tile rather than about the design, which is why it
           is not a measured row. It used to promise "full length", which was
           true of a tall capture and a lie about a wide one: those are cut at
           the SIDES by the same box, and were saying nothing at all. The edge
           is compared rather than guessed now, so it can be named.
        */}
        {cropped && (
          <div className="ov-crop">
            {cropped === 'foot' ? 'Foot cropped' : 'Sides cropped'} — full view on open
          </div>
        )}

        {/* Written rather than measured, and kept apart so the difference is
            visible rather than asserted. */}
        {written && <div className="ov-written">{written}</div>}
      </div>
    </div>
  );
}
