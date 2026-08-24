import { readableOn } from '../lib/color';
import type { PaletteColor } from '../lib/types';

interface Props {
  palette: PaletteColor[];
  large?: boolean;
  /**
   * Makes the swatches pickable. Without it they are not controls — see
   * below; a swatch that does nothing must not present itself as a button.
   */
  onPick?: (color: PaletteColor) => void;
}

export function PaletteStrip({ palette, large, onPick }: Props) {
  if (palette.length === 0) return null;
  return (
    <div className={`palette${large ? ' palette-large' : ''}`} role="list">
      {palette.map((color, i) => {
        const label = `${color.hex} — ${color.name} · ${color.role} · ${Math.round(
          color.share * 100,
        )}% of the canvas`;
        const style = {
          background: color.hex,
          // Square-root weighting: a 75%-of-canvas background should read as
          // dominant without squeezing a 3% accent down to a sliver.
          flexGrow: Math.max(0.7, Math.sqrt(color.share) * 4),
          color: readableOn(color.hex),
        };
        const inner = <span className="visually-hidden">{label}</span>;

        /*
           A button only where there is something to press.

           Both callers render this strip without onPick, so every swatch was a
           focusable button whose click handler did nothing: six dead tab stops
           on every card, announced to a screen reader as "#5438d5 indigo text,
           button". A hundred designs came to eleven hundred stops, six hundred
           of them inert. As a list item it carries the same label and the same
           tooltip, and costs nobody a keypress.
        */
        if (!onPick) {
          return (
            <span
              key={`${color.hex}-${i}`}
              className="palette-swatch"
              role="listitem"
              style={style}
              title={label}
            >
              {inner}
            </span>
          );
        }
        return (
          <button
            key={`${color.hex}-${i}`}
            type="button"
            className="palette-swatch"
            role="listitem"
            style={style}
            title={label}
            onClick={(event) => {
              event.stopPropagation();
              onPick(color);
            }}
          >
            {inner}
          </button>
        );
      })}
    </div>
  );
}
