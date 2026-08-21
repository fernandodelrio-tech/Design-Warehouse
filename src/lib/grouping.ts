import { signatureColor } from './naming';
import type { DesignRecord } from './types';

/** Ways to order the grid, and ways to break it into labelled sections. */

export interface SortOption {
  key: string;
  label: string;
  compare: (a: DesignRecord, b: DesignRecord) => number;
}

export interface Bucket {
  id: string;
  label: string;
  /** Used when the grouping orders its sections by value rather than by size. */
  sort?: number;
}

export type BucketOrder = 'count' | 'ascending' | 'descending';

export interface GroupOption {
  key: string;
  label: string;
  /** A design can land in several sections at once — it may carry several tags. */
  buckets: (record: DesignRecord) => Bucket[];
  order: BucketOrder;
}

const area = (record: DesignRecord) => record.image.width * record.image.height;

/**
 * Hue families, matching the buckets the namer draws its vocabulary from.
 *
 * Red straddles 0°, so it appears at both ends: without the final band, two
 * near-identical reds at 2° and 358° land in different families.
 */
const HUE_FAMILIES: Array<[number, string]> = [
  [15, 'Reds'],
  [45, 'Oranges'],
  [70, 'Yellows'],
  [100, 'Limes'],
  [150, 'Greens'],
  [200, 'Teals'],
  [255, 'Blues'],
  [290, 'Indigos'],
  [330, 'Purples'],
  [345, 'Pinks'],
  [360, 'Reds'],
];

/** Rotates the wheel so the red wrap-point sits mid-band rather than at the seam. */
const ROTATION = 15;

export function hueFamily(record: DesignRecord): { id: string; sort: number } {
  const color = signatureColor(record.auto.palette);
  // Neutrals have no place on the wheel; park them past the end of it.
  if (!color) return { id: 'Neutral', sort: 999 };
  const hue = color.hsl[0];
  const family = HUE_FAMILIES.find(([max]) => hue <= max)?.[1] ?? 'Reds';
  return { id: family, sort: (hue + ROTATION) % 360 };
}

const SCHEME_RANK: Record<string, number> = { light: 0, mixed: 1, dark: 2 };
const DENSITY_RANK: Record<string, number> = { sparse: 0, balanced: 1, dense: 2 };

export const SORTS: SortOption[] = [
  {
    key: 'newest',
    label: 'Date added — newest',
    compare: (a, b) => b.createdAt - a.createdAt,
  },
  {
    key: 'oldest',
    label: 'Date added — oldest',
    compare: (a, b) => a.createdAt - b.createdAt,
  },
  {
    key: 'updated',
    label: 'Recently edited',
    compare: (a, b) => b.updatedAt - a.updatedAt,
  },
  {
    key: 'name',
    label: 'Name — A to Z',
    compare: (a, b) => a.title.localeCompare(b.title),
  },
  {
    key: 'name-desc',
    label: 'Name — Z to A',
    compare: (a, b) => b.title.localeCompare(a.title),
  },
  {
    key: 'category',
    label: 'Category',
    compare: (a, b) =>
      a.spec.category.localeCompare(b.spec.category) || b.createdAt - a.createdAt,
  },
  {
    key: 'style',
    label: 'Style',
    compare: (a, b) =>
      (a.spec.styleKeywords[0] ?? '~').localeCompare(b.spec.styleKeywords[0] ?? '~') ||
      b.createdAt - a.createdAt,
  },
  {
    key: 'scheme',
    label: 'Light to dark',
    compare: (a, b) =>
      (SCHEME_RANK[a.auto.colorScheme] ?? 1) - (SCHEME_RANK[b.auto.colorScheme] ?? 1) ||
      a.auto.averageLuminance - b.auto.averageLuminance,
  },
  {
    key: 'hue',
    label: 'Colour — around the wheel',
    compare: (a, b) => hueFamily(a).sort - hueFamily(b).sort,
  },
  {
    key: 'density',
    label: 'Density — sparse to dense',
    compare: (a, b) => a.auto.layout.density - b.auto.layout.density,
  },
  {
    key: 'largest',
    label: 'Capture size — largest',
    compare: (a, b) => area(b) - area(a),
  },
  {
    key: 'favorite',
    label: 'Favourites first',
    compare: (a, b) =>
      Number(b.favorite) - Number(a.favorite) || b.createdAt - a.createdAt,
  },
];

const single = (id: string, label = id, sort?: number): Bucket[] => [{ id, label, sort }];

const MONTH_FORMAT: Intl.DateTimeFormatOptions = { month: 'long', year: 'numeric' };

export const GROUPS: GroupOption[] = [
  { key: 'none', label: 'Nothing', buckets: () => [], order: 'count' },
  {
    key: 'category',
    label: 'Category',
    buckets: (r) => single(r.spec.category || 'Uncategorised'),
    order: 'count',
  },
  {
    key: 'style',
    label: 'Style keyword',
    buckets: (r) =>
      r.spec.styleKeywords.length
        ? r.spec.styleKeywords.map((word) => ({ id: word, label: word }))
        : single('no-style', 'No style set'),
    order: 'count',
  },
  {
    key: 'tag',
    label: 'Tag',
    buckets: (r) =>
      r.tags.length
        ? r.tags.map((tag) => ({ id: tag, label: tag }))
        : single('untagged', 'Untagged'),
    order: 'count',
  },
  {
    key: 'month',
    label: 'Month added',
    buckets: (r) => {
      const date = new Date(r.createdAt);
      return [
        {
          id: `${date.getFullYear()}-${date.getMonth()}`,
          label: date.toLocaleDateString(undefined, MONTH_FORMAT),
          sort: date.getFullYear() * 12 + date.getMonth(),
        },
      ];
    },
    order: 'descending',
  },
  {
    key: 'scheme',
    label: 'Colour scheme',
    buckets: (r) =>
      single(r.auto.colorScheme, `${r.auto.colorScheme} mode`, SCHEME_RANK[r.auto.colorScheme]),
    order: 'ascending',
  },
  {
    key: 'hue',
    label: 'Colour family',
    buckets: (r) => {
      const { id, sort } = hueFamily(r);
      return [{ id, label: id, sort }];
    },
    order: 'ascending',
  },
  {
    key: 'platform',
    label: 'Platform',
    buckets: (r) => single(r.spec.platform || 'Unspecified'),
    order: 'count',
  },
  {
    key: 'density',
    label: 'Density',
    buckets: (r) =>
      single(
        r.auto.layout.densityLabel,
        `${r.auto.layout.densityLabel} layouts`,
        DENSITY_RANK[r.auto.layout.densityLabel],
      ),
    order: 'ascending',
  },
  {
    key: 'orientation',
    label: 'Orientation',
    buckets: (r) => single(r.image.orientation, `${r.image.orientation} captures`),
    order: 'count',
  },
  {
    key: 'columns',
    label: 'Column count',
    buckets: (r) =>
      single(
        String(r.auto.layout.columns),
        `${r.auto.layout.columns} column${r.auto.layout.columns === 1 ? '' : 's'}`,
        r.auto.layout.columns,
      ),
    order: 'ascending',
  },
  {
    key: 'source',
    label: 'How it arrived',
    buckets: (r) => single(r.source, `From ${r.source}`),
    order: 'count',
  },
];

export interface Section {
  id: string;
  label: string;
  records: DesignRecord[];
}

/**
 * Splits records into labelled sections. A design with several tags appears
 * under each of them, which is the point of classifying by tag.
 */
export function groupRecords(
  records: DesignRecord[],
  group: GroupOption,
  sort: SortOption,
): Section[] {
  if (group.key === 'none') return [];

  const sections = new Map<string, Section & { sort?: number }>();
  for (const record of records) {
    for (const bucket of group.buckets(record)) {
      const existing = sections.get(bucket.id);
      if (existing) existing.records.push(record);
      else sections.set(bucket.id, { ...bucket, records: [record] });
    }
  }

  const ordered = [...sections.values()];
  ordered.forEach((section) => section.records.sort(sort.compare));

  switch (group.order) {
    case 'ascending':
      ordered.sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || a.label.localeCompare(b.label));
      break;
    case 'descending':
      ordered.sort((a, b) => (b.sort ?? 0) - (a.sort ?? 0) || a.label.localeCompare(b.label));
      break;
    default:
      // Biggest sections first, but always leave the "none of the above" bucket
      // at the end where it reads as a remainder rather than a category.
      ordered.sort((a, b) => {
        const spare = (s: Section) => /^(untagged|no-style|uncategorised|unspecified)$/i.test(s.id);
        if (spare(a) !== spare(b)) return spare(a) ? 1 : -1;
        return b.records.length - a.records.length || a.label.localeCompare(b.label);
      });
  }

  return ordered;
}
