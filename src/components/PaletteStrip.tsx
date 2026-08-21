import { readableOn } from '../lib/color';
import type { PaletteColor } from '../lib/types';

interface Props {
  palette: PaletteColor[];
  large?: boolean;
  onPick?: (color: PaletteColor) => void;
}

export function PaletteStrip({ palette, large, onPick }: Props) {
  if (palette.length === 0) return null;
  return (
    <div className={`palette${large ? ' palette-large' : ''}`}>
      {palette.map((color, i) => (
        <button
          key={`${color.hex}-${i}`}
          type="button"
          className="palette-swatch"
          style={{
            background: color.hex,
            // Square-root weighting: a 75%-of-canvas background should read as
            // dominant without squeezing a 3% accent down to a sliver.
            flexGrow: Math.max(0.7, Math.sqrt(color.share) * 4),
            color: readableOn(color.hex),
          }}
          title={`${color.hex} — ${color.name} · ${color.role} · ${Math.round(color.share * 100)}% of the canvas`}
          onClick={(event) => {
            event.stopPropagation();
            onPick?.(color);
          }}
        >
          <span className="visually-hidden">
            {color.hex} {color.name} {color.role}
          </span>
        </button>
      ))}
    </div>
  );
}
