import { memo } from 'react';
import { describeAspect } from '../lib/image';
import type { DesignRecord } from '../lib/types';
import { useThumbUrl } from '../hooks/useImageUrl';
import { PaletteStrip } from './PaletteStrip';
import { IconCopy, IconStar, IconTrash } from './Icons';

interface Props {
  record: DesignRecord;
  selected: boolean;
  onOpen: (id: string) => void;
  onToggleSelect: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  onCopySpec: (record: DesignRecord) => void;
  onDelete: (id: string) => void;
  onTagClick: (tag: string) => void;
}

function specLine(label: string, value: string) {
  if (!value) return null;
  return (
    <dl className="card-spec-line">
      <dt>{label}</dt>
      <dd title={value}>{value}</dd>
    </dl>
  );
}

/**
 * One vignette. The footer is the whole point of the app: it carries the
 * metadata Claude Code or Claude Design needs to rebuild the design.
 */
export const DesignCard = memo(function DesignCard({
  record,
  selected,
  onOpen,
  onToggleSelect,
  onToggleFavorite,
  onCopySpec,
  onDelete,
  onTagClick,
}: Props) {
  const url = useThumbUrl(record.id);
  const { image, auto, spec } = record;

  const families = [spec.typography.headingFamily, spec.typography.bodyFamily]
    .filter(Boolean)
    .join(' / ');
  const bodyStep = spec.typography.scale.find((s) => s.name === 'Body');
  const typeDetail = [families, bodyStep?.size, spec.typography.baseSize]
    .filter(Boolean)
    .join(' · ');

  const layoutDetail = [
    spec.layout.structure,
    spec.layout.maxWidth && `max ${spec.layout.maxWidth}`,
    spec.layout.radius && `radius ${spec.layout.radius}`,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <article className={`card${selected ? ' selected' : ''}`}>
      <input
        type="checkbox"
        className="card-select"
        checked={selected}
        onChange={() => onToggleSelect(record.id)}
        aria-label={`Select ${record.title}`}
      />

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
          <div
            className="card-image-placeholder"
            style={{ aspectRatio: `${image.width} / ${image.height}` }}
          />
        )}
      </button>

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

      <footer className="card-footer">
        <h3 className="card-title">
          <span title={record.title}>{record.title}</span>
        </h3>
        <div className="card-subtitle">
          {image.width}×{image.height} · {describeAspect(image.width, image.height)}
          {spec.category ? ` · ${spec.category}` : ''}
        </div>

        <PaletteStrip palette={auto.palette} />
        <div className="card-spec-line" style={{ marginTop: 6 }}>
          <dd className="mono" style={{ color: 'var(--text-faint)' }}>
            {auto.palette.slice(0, 5).map((c) => c.hex).join('  ')}
          </dd>
        </div>

        {specLine('Type', typeDetail)}
        {specLine('Layout', layoutDetail)}

        <div className="card-meta">
          <span className="chip">{auto.colorScheme}</span>
          <span className="chip">{auto.layout.columns} col</span>
          <span className="chip">{auto.layout.densityLabel}</span>
          {spec.styleKeywords.slice(0, 3).map((word) => (
            <span className="chip" key={word}>
              {word}
            </span>
          ))}
          {record.tags.map((tag) => (
            <button
              type="button"
              className="chip chip-accent"
              key={tag}
              onClick={() => onTagClick(tag)}
              title={`Filter by ${tag}`}
            >
              {tag}
            </button>
          ))}
        </div>
      </footer>
    </article>
  );
});
