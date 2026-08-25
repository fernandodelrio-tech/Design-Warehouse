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
   * Whether the tile is showing a crop. The picture carries its own badge for
   * this, and the slab is opaque and lands on the same bottom edge — so while
   * the sheet is up the badge is behind it. On a coarse pointer the sheet is
   * never down, which made the crop affordance permanently invisible there.
   * The sheet says it instead, and the badge steps aside.
   */
  cropped: boolean;
}

/**
 * The specimen's size in SOURCE pixels, so it draws at the same scale as the
 * design's own components — roughly one card of a typical capture. It shrinks
 * with the thumbnail exactly as the design does, which is what makes the
 * corner beside it comparable rather than merely nearby.
 */
const SPECIMEN = 260;

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
     One drawing carries the corner and the edge together, because that is how
     they occur: a card has both at once, and splitting them would invent a
     relationship the capture never had.

     Sized and rounded in source pixels expressed as a share of the frame, so
     both track the picture's own scale. The hairline cannot join them — CSS
     takes no percentage border-width, and a measured 1px hairline is a
     quarter of a device pixel at thumbnail scale anyway — so it draws at its
     measured COLOUR at the thinnest width a screen can render, and the slab
     carries its true width. The cast is left off the drawing for the same
     reason: blur radius takes no percentage either, and an elevation drawn at
     four times the picture's scale is the error this frame exists to fix. Its
     figure is in the slab.
  */
  const pct = (sourcePx: number) => `calc(${sourcePx} / ${image.width} * 100%)`;
  const block = {
    background: fill,
    width: pct(SPECIMEN),
    height: pct(SPECIMEN),
    borderColor: border ? border.hex : edge,
    borderRadius: pct(Math.min(radius?.px ?? 0, SPECIMEN / 2)),
  };

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

        {detail && (radius || border) && <span className="ov-block" style={block} />}
      </div>

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
           the SIDES by the same box, and were saying nothing at all. Naming no
           edge is the honest version, and the marker now fires either way.
        */}
        {cropped && <div className="ov-crop">Cropped to the tile — full view on open</div>}

        {/* Written rather than measured, and kept apart so the difference is
            visible rather than asserted. */}
        {written && <div className="ov-written">{written}</div>}
      </div>
    </div>
  );
}
