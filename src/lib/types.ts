/**
 * Data model for the Design Warehouse catalog.
 *
 * A record has three layers:
 *   image  - the raw facts about the bitmap we stored
 *   auto   - everything the analyzer derived from the pixels (regenerable)
 *   spec   - the design specification, seeded by the analyzer and then
 *            edited by hand. This is the layer Claude Code / Claude Design
 *            reads when it replicates the design.
 */

export type IngestSource = 'clipboard' | 'file' | 'folder' | 'import';

export type ColorRole =
  | 'background'
  | 'surface'
  | 'text'
  | 'accent'
  | 'muted'
  | 'border';

export interface PaletteColor {
  hex: string;
  rgb: [number, number, number];
  hsl: [number, number, number];
  /** Fraction of sampled pixels this color represents, 0..1. */
  share: number;
  role: ColorRole;
  /** Human-readable hue name, e.g. "deep blue". */
  name: string;
}

export interface ContrastPair {
  foreground: string;
  background: string;
  ratio: number;
  /** WCAG 2.1 rating for normal body text. */
  rating: 'AAA' | 'AA' | 'AA Large' | 'Fail';
}

export interface LayoutEstimate {
  /** Best guess at the number of primary content columns. */
  columns: number;
  /** Normalized x positions (0..1) of detected vertical gutters. */
  gutters: number[];
  /** Normalized y positions (0..1) of detected horizontal section breaks. */
  sectionBreaks: number[];
  /** Share of the canvas carrying visual detail, 0..1. */
  density: number;
  densityLabel: 'sparse' | 'balanced' | 'dense';
  /** Share of the canvas that is flat, uninterrupted background, 0..1. */
  whitespaceRatio: number;
  /** Detected content margins as a fraction of width/height. */
  margins: { top: number; right: number; bottom: number; left: number };
  /** Plain-English summary, safe to paste into a prompt. */
  summary: string;
}

export interface ImageMeta {
  width: number;
  height: number;
  aspectRatio: number;
  orientation: 'landscape' | 'portrait' | 'square';
  byteSize: number;
  mimeType: string;
}

/** Fine detail measured off a near-native sample: see lib/measure.ts. */
export interface DetailMeasurement {
  /** Corner radius in source pixels, and how many corners agreed. */
  radius: { px: number; samples: number } | null;
  /** The modal hairline: its width in source pixels and its colour. */
  border: { px: number; hex: string; samples: number } | null;
  /** Elevation: how far the shadow reaches and how dark it gets, 0..255. */
  shadow: { spread: number; strength: number; samples: number } | null;
  /**
   * Text rows. `inkHeights` are the heights of the glyph runs themselves, which
   * understate font size — a line with no ascenders has none to measure — so
   * the ratios between them carry more than the absolute figures do.
   */
  text: {
    /** One entry per distinct row height, with how many rows had it. */
    steps: Array<{ px: number; rows: number }>;
    leading: number[];
    samples: number;
  } | null;
  /**
   * Edges, per element rather than per page: how many of the measured blocks
   * carry a border and how many carry a shadow, so the export can say that a
   * card is borderless instead of leaving its absence to be inferred.
   */
  edges: {
    blocks: number;
    withBorder: number;
    withShadow: number;
    border: { px: number; hex: string } | null;
    shadow: { spread: number; strength: number } | null;
  } | null;
}

/** Structure measured off the same near-native sample: see lib/structure.ts. */
export interface StructureMeasurement {
  /** Content box and column gap, in source pixels. */
  frame: {
    contentWidth: number;
    marginLeft: number;
    marginRight: number;
    gutter: number | null;
    gutterSamples: number;
  } | null;
  /** A page-wide ramp, if there is one, with the colours at each end. */
  gradient: {
    axis: 'vertical' | 'horizontal';
    from: string;
    to: string;
    coverage: number;
    samples: number;
  } | null;
  /** Photographic coverage, 0 when the page is flat colour throughout. */
  imagery: {
    coverage: number;
    box: { x: number; y: number; w: number; h: number } | null;
    samples: number;
  } | null;
  /** Named patterns with their measured sizes, empty when nothing repeated. */
  components: string[];
  /** How many solid blocks the inventory was drawn from. */
  blocks: number;
  /** Small square shapes: the icon set. */
  icons: { count: number; px: number } | null;
}

export interface AutoAnalysis {
  /** Bumped when the analyzer changes so stale records can be re-run. */
  version: number;
  extractedAt: number;
  palette: PaletteColor[];
  averageLuminance: number;
  colorScheme: 'light' | 'dark' | 'mixed';
  saturation: 'muted' | 'moderate' | 'vivid';
  contrastPairs: ContrastPair[];
  layout: LayoutEstimate;
  /** Absent on records analysed before the detail pass existed. */
  detail?: DetailMeasurement;
  /** Absent on records analysed before the structure pass existed. */
  structure?: StructureMeasurement;
}

export interface TypeStep {
  name: string;
  size: string;
  weight: string;
  lineHeight: string;
  letterSpacing: string;
}

export interface TypographySpec {
  headingFamily: string;
  bodyFamily: string;
  monoFamily: string;
  baseSize: string;
  scale: TypeStep[];
  notes: string;
}

export interface LayoutSpec {
  structure: string;
  columns: string;
  maxWidth: string;
  gutter: string;
  spacingScale: string;
  radius: string;
  borders: string;
  breakpoints: string;
  notes: string;
}

export interface ColorToken {
  name: string;
  value: string;
  usage: string;
}

export interface EffectsSpec {
  shadows: string;
  gradients: string;
  blur: string;
  animation: string;
  iconography: string;
  imagery: string;
}

export interface DesignSpec {
  category: string;
  platform: string;
  styleKeywords: string[];
  colorTokens: ColorToken[];
  typography: TypographySpec;
  layout: LayoutSpec;
  components: string[];
  effects: EffectsSpec;
  interactions: string;
  accessibilityNotes: string;
  replicationNotes: string;
}

export interface DesignRecord {
  id: string;
  createdAt: number;
  updatedAt: number;
  title: string;
  source: IngestSource;
  fileName: string;
  sourceUrl: string;
  notes: string;
  tags: string[];
  favorite: boolean;
  image: ImageMeta;
  auto: AutoAnalysis;
  spec: DesignSpec;
}

/** Blobs live in their own store so the metadata store stays cheap to scan. */
export interface DesignBlobs {
  id: string;
  full: Blob;
  thumb: Blob;
}
