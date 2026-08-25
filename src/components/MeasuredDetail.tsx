import { edgeFor, groundOf, surfaceOf } from '../lib/measured-colors';
import type { DetailMeasurement, PaletteColor } from '../lib/types';

/**
 * The measured geometry, drawn rather than described.
 *
 * The app measures a corner radius, a hairline and an elevation off the
 * pixels, then reports them as the strings "24px", "1px #dad9d3" and a
 * sentence. In a design catalog that is the wrong way round: the one place a
 * measurement can be checked at a glance is against itself. The contrast rows
 * in the Color section already work this way — real type, on real ground, with
 * the ratio beside it — and this is the same idea applied to the rest of what
 * the analyzer can see.
 *
 * Each sample is drawn at the measurement's own scale, on the design's own
 * background, with the figure and the sample count beside it. The count is the
 * honesty: a radius four corners agreed on is worth more than one that a
 * single corner produced, and the number says which this is.
 *
 * The wall draws the same three measurements over the tile in `CardOverlay`.
 * Both take their grounds from `lib/measured-colors`, so a radius reads the
 * same in the tile and in the drawer rather than being two facts to reconcile.
 */

interface Props {
  /** Absent on anything catalogued before the fine pass existed. */
  detail: DetailMeasurement | undefined;
  palette: PaletteColor[];
}

/** A sample wider than the column would be a lie about the measurement. */
const MAX_SAMPLE = 96;

export function MeasuredDetail({ detail, palette }: Props) {
  if (!detail) return null;
  const { radius, border, shadow } = detail;
  // Nothing found is not the same as nothing measured, but neither is a
  // drawing: a pass that came back empty says so in words instead.
  if (!radius && !border && !shadow) {
    return (
      <p className="measured-none">
        No corner, hairline or elevation was found in this capture.
      </p>
    );
  }

  const bg = groundOf(palette);
  const fg = surfaceOf(palette);
  const edge = edgeFor(bg, fg);

  return (
    <div className="measured-grid">
      {radius && (
        <figure className="measured-item" style={{ background: bg }}>
          {/* A card at the radius it was measured at, on the ground it sat on. */}
          <div className="measured-stage">
            <div
              className="measured-block"
              style={{
                background: fg,
                border: `1px solid ${edge}`,
                borderRadius: `${Math.min(radius.px, MAX_SAMPLE)}px`,
              }}
            />
          </div>
          <figcaption className="measured-caption">
            <b>{radius.px}px</b> radius
            <span className="measured-samples">
              {radius.samples} corner{radius.samples === 1 ? '' : 's'} agreed
              {radius.px > MAX_SAMPLE ? ' · drawn to scale up to 96px' : ''}
            </span>
          </figcaption>
        </figure>
      )}

      {border && (
        <figure className="measured-item" style={{ background: bg }}>
          <div className="measured-stage">
            {/* The hairline at its measured width and its measured colour. */}
            <div
              className="measured-rule"
              style={{ borderTop: `${border.px}px solid ${border.hex}` }}
            />
          </div>
          <figcaption className="measured-caption">
            <b>{border.px}px</b> <span className="mono">{border.hex}</span>
            <span className="measured-samples">
              {border.samples} edge{border.samples === 1 ? '' : 's'} matched
            </span>
          </figcaption>
        </figure>
      )}

      {shadow && (
        <figure className="measured-item" style={{ background: bg }}>
          <div className="measured-stage">
            {/*
               Rebuilt from the two things a still frame can give up: how far
               the falloff reaches and how dark it gets at the edge. The offset
               is not measured here, so the cast is even — the caption says so
               rather than letting an invented direction read as a fact.
            */}
            <div
              className="measured-block"
              style={{
                background: fg,
                border: `1px solid ${edge}`,
                borderRadius: radius ? `${Math.min(radius.px, 12)}px` : '2px',
                boxShadow: `0 ${Math.round(shadow.spread / 3)}px ${shadow.spread}px rgb(0 0 0 / ${(
                  shadow.strength / 255
                ).toFixed(3)})`,
              }}
            />
          </div>
          <figcaption className="measured-caption">
            <b>{shadow.spread}px</b> falloff at {shadow.strength}/255
            <span className="measured-samples">
              {shadow.samples} block{shadow.samples === 1 ? '' : 's'} lifted · cast rebuilt, not
              measured
            </span>
          </figcaption>
        </figure>
      )}
    </div>
  );
}
