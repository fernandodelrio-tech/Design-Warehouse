import { memo } from 'react';
import type { DesignRecord } from '../lib/types';
import { useThumbUrl } from '../hooks/useImageUrl';
import { PaletteStrip } from './PaletteStrip';
import { CardOverlay } from './CardOverlay';
import { IconCopy, IconStar, IconTrash } from './Icons';

interface Props {
  record: DesignRecord;
  selected: boolean;
  onOpen: (id: string) => void;
  onToggleSelect: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  onCopySpec: (record: DesignRecord) => void;
  onDelete: (id: string) => void;
}

/**
 * One tile: a picture, a colour band, and a name.
 *
 * The tile is a fixed height and the screenshot is cropped to fill it from the
 * top, which is the part that identifies a design. Anything taller than the
 * crop gets a fade and a marker; opening the tile shows it at full length.
 *
 * Everything the footer used to say — dimensions, aspect, type, layout,
 * scheme, columns, density, keywords, tags — now appears over the screenshot
 * as `CardOverlay`, and only for the tile being attended to. What stays
 * permanent is what a scan of two hundred tiles is actually made of: the
 * picture, and the palette band under it. Those are the two things that decide
 * whether a catalogued language fits, and neither of them is a sentence.
 *
 * The tag chips went with the footer. They duplicated the filter row above the
 * grid, which already lists every tag worth clicking; the tags themselves are
 * still on the tile, in the overlay, as the information they are rather than
 * as a second set of controls on every card.
 */
export const DesignCard = memo(function DesignCard({
  record,
  selected,
  onOpen,
  onToggleSelect,
  onToggleFavorite,
  onCopySpec,
  onDelete,
}: Props) {
  const url = useThumbUrl(record.id);
  const { image, auto } = record;

  // Compared against the tile's own aspect rather than a fixed number: the
  // crop box is as wide as its column, so what is cut off depends on the tile.
  const cropped = image.height / image.width > 0.82;

  return (
    <article className={`card${selected ? ' selected' : ''}`}>
      <input
        type="checkbox"
        className="card-select"
        checked={selected}
        onChange={() => onToggleSelect(record.id)}
        aria-label={`Select ${record.title}`}
      />

      {/*
         The stage is what the overlay is positioned against. Without it the
         overlay would be measured from the card, and its foot would land under
         the palette band rather than on the screenshot's own bottom edge.
      */}
      <div className="card-stage">
        <button
          type="button"
          className="card-image"
          onClick={() => onOpen(record.id)}
          aria-label={`Open ${record.title}`}
        >
          {url ? (
            <img
              src={url}
              alt={record.title}
              loading="lazy"
              decoding="async"
              width={image.width}
              height={image.height}
            />
          ) : (
            <div className="card-image-placeholder" />
          )}
          {cropped && (
            <>
              <span className="card-crop-fade" aria-hidden />
              <span className="card-crop-badge">Full length on open</span>
            </>
          )}
        </button>

        {/*
           A sibling of the image rather than a child of it: the button is a
           control, and nesting content inside it would put the overlay's text
           into the button's accessible name. It takes no pointer events, so
           the whole picture stays one click target.
        */}
        <CardOverlay record={record} />

        <div className="card-hover-actions">
          <button
            type="button"
            className="btn btn-icon"
            title={record.favorite ? 'Remove from favourites' : 'Add to favourites'}
            onClick={() => onToggleFavorite(record.id)}
          >
            <IconStar filled={record.favorite} />
          </button>
          <button
            type="button"
            className="btn btn-icon"
            title="Copy the design spec for Claude"
            onClick={() => onCopySpec(record)}
          >
            <IconCopy />
          </button>
          <button
            type="button"
            className="btn btn-icon btn-danger"
            title="Delete"
            onClick={() => onDelete(record.id)}
          >
            <IconTrash />
          </button>
        </div>
      </div>

      <footer className="card-footer">
        {/*
           The band a design is recognised by, at the foot of the picture it
           came off. It is the one measurement permanent enough to survive a
           scan: hovering two hundred tiles to compare colour is not scanning,
           and colour is half of what decides a language.
        */}
        <PaletteStrip palette={auto.palette} />

        <h3 className="card-title">
          <span title={record.title}>{record.title}</span>
        </h3>
      </footer>
    </article>
  );
});
