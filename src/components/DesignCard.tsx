import { memo, useState } from 'react';
import type { DesignRecord } from '../lib/types';
import { useThumbUrl } from '../hooks/useImageUrl';
import { useAttention } from '../lib/attention';
import { registerStage, useStageSize } from '../lib/stage';
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
 * top, which is the part that identifies a design. Anything the box cuts gets
 * a marker; opening the tile shows the whole capture. The marker names no
 * edge, because the box cuts the foot off a tall capture and the sides off a
 * wide one, and it used to promise "full length" to both.
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
  // Null on a pointer device: the hook opts out and never observes.
  const [node, setNode] = useState<HTMLElement | null>(null);
  const attended = useAttention(node);

  /*
     Which edge the box cuts, measured rather than guessed.

     This was a constant, then two constants, and both were wrong for the same
     reason: the tile's aspect is not a number the component knows — it moves
     with the column width and the Size control. A 1280×900 capture in a box
     of aspect 1.05 loses a third of its width, and sat inside every threshold
     picked by hand, so three of eight tiles on a test wall were cut mid-word
     and said nothing. Comparing the two real aspects also names the edge,
     which guessing never could.
  */
  const stage = useStageSize();
  const cropped: 'sides' | 'foot' | null = (() => {
    if (!stage.w || !stage.h) return null;
    const ratio = image.width / image.height / (stage.w / stage.h);
    // How much of the cut axis the box actually takes. A marker on every tile
    // is not a marker: an exact comparison flags a 2% trim as loudly as the
    // 30% one that cuts a heading in half, and the wall ends up wearing the
    // badge as decoration. This is the point where something is missing that
    // you would want to open the design to see.
    const lost = ratio > 1 ? 1 - 1 / ratio : 1 - ratio;
    if (lost < 0.12) return null;
    return ratio > 1 ? 'sides' : 'foot';
  })();

  return (
    <article
      ref={setNode}
      className={`card${selected ? ' selected' : ''}${attended ? ' card-attended' : ''}`}
    >
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
      <div className="card-stage" ref={registerStage}>
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
              {/* The fade belongs to the foot; a side crop has no bottom edge
                  to soften and would just get a band across the picture. */}
              {cropped === 'foot' && <span className="card-crop-fade" aria-hidden />}
              <span className="card-crop-badge">Full view on open</span>
            </>
          )}
        </button>

        {/*
           A sibling of the image rather than a child of it: the button is a
           control, and nesting content inside it would put the overlay's text
           into the button's accessible name. It takes no pointer events, so
           the whole picture stays one click target.
        */}
        <CardOverlay record={record} cropped={cropped} />

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
