import { describeAspect } from './image';
import type { DesignRecord } from './types';

/**
 * Turns a catalog record into text a model can act on.
 *
 * Rule followed throughout: empty fields are omitted, never emitted blank.
 * A spec full of "Font: (unspecified)" rows teaches Claude nothing and costs
 * tokens; a shorter, fully-populated spec is a better instruction.
 */

const fmtDate = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

function has(value: string | undefined | null): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * `null` entries are fields that were left empty and get dropped; `''` entries
 * are deliberate separators — a markdown table needs the blank line above it.
 */
function section(title: string, body: Array<string | null>): string {
  const lines: string[] = [];
  for (const entry of body.filter((e): e is string => e !== null)) {
    const isBlank = entry.trim().length === 0;
    if (isBlank && (lines.length === 0 || lines[lines.length - 1].trim().length === 0)) continue;
    lines.push(entry);
  }
  while (lines.length && lines[lines.length - 1].trim().length === 0) lines.pop();
  if (lines.length === 0) return '';
  return `## ${title}\n\n${lines.join('\n')}\n`;
}

function table(headers: string[], rows: string[][]): string | null {
  if (rows.length === 0) return null;
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${r.join(' | ')} |`),
  ].join('\n');
}

function bullet(label: string, value: string | undefined): string | null {
  return has(value) ? `- **${label}:** ${value.trim()}` : null;
}

export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'design'
  );
}

export function toMarkdownSpec(record: DesignRecord): string {
  const { image, auto, spec } = record;
  const facts = [
    `${image.width}x${image.height}px`,
    describeAspect(image.width, image.height),
    spec.category,
    spec.platform,
  ].filter(has);

  const headLines = [
    `# ${record.title}`,
    '',
    facts.join(' · '),
    `Captured ${fmtDate(record.createdAt)}${has(record.fileName) ? ` from \`${record.fileName}\`` : ''}.`,
    has(record.sourceUrl) ? `Source: ${record.sourceUrl}` : '',
    record.tags.length ? `Tags: ${record.tags.join(', ')}` : '',
    spec.styleKeywords.length ? `Style: ${spec.styleKeywords.join(', ')}` : '',
  ].filter((line, i) => i < 2 || line.length > 0);
  if (has(record.notes)) headLines.push('', record.notes.trim());
  const head = `${headLines.join('\n')}\n`;

  const colorSection = section('Color', [
    `Scheme: ${auto.colorScheme} · Saturation: ${auto.saturation} · Mean luminance: ${auto.averageLuminance}`,
    '',
    table(
      ['Token', 'Hex', 'Usage', 'Area'],
      spec.colorTokens.map((token, i) => [
        token.name,
        token.value,
        token.usage || '—',
        auto.palette[i] ? `${Math.round(auto.palette[i].share * 100)}%` : '—',
      ]),
    ),
    '',
    auto.contrastPairs.length
      ? `Measured contrast: ${auto.contrastPairs
          .map((p) => `${p.foreground} on ${p.background} = ${p.ratio}:1 (${p.rating})`)
          .join(' · ')}`
      : null,
  ]);

  const typeRows = spec.typography.scale
    .filter((step) => has(step.size) || has(step.weight) || has(step.lineHeight) || has(step.letterSpacing))
    .map((step) => [
      step.name,
      step.size || '—',
      step.weight || '—',
      step.lineHeight || '—',
      step.letterSpacing || '—',
    ]);

  const typeSection = section('Typography', [
    bullet('Heading family', spec.typography.headingFamily),
    bullet('Body family', spec.typography.bodyFamily),
    bullet('Mono family', spec.typography.monoFamily),
    bullet('Base size', spec.typography.baseSize),
    '',
    table(['Step', 'Size', 'Weight', 'Line height', 'Letter spacing'], typeRows),
    '',
    has(spec.typography.notes) ? spec.typography.notes.trim() : null,
  ]);

  const layoutSection = section('Layout', [
    bullet('Structure', spec.layout.structure),
    bullet('Columns', spec.layout.columns),
    bullet('Max width', spec.layout.maxWidth),
    bullet('Gutter', spec.layout.gutter),
    bullet('Spacing scale', spec.layout.spacingScale),
    bullet('Corner radius', spec.layout.radius),
    bullet('Borders', spec.layout.borders),
    bullet('Breakpoints', spec.layout.breakpoints),
    `- **Measured:** ${auto.layout.summary}`,
    auto.layout.sectionBreaks.length
      ? `- **Section breaks (fraction of height):** ${auto.layout.sectionBreaks.join(', ')}`
      : null,
    '',
    has(spec.layout.notes) ? spec.layout.notes.trim() : null,
  ]);

  const effects = section('Effects & detail', [
    bullet('Shadows / elevation', spec.effects.shadows),
    bullet('Gradients', spec.effects.gradients),
    bullet('Blur / glass', spec.effects.blur),
    bullet('Motion', spec.effects.animation),
    bullet('Iconography', spec.effects.iconography),
    bullet('Imagery', spec.effects.imagery),
  ]);

  const componentsSection = section(
    'Components present',
    spec.components.length ? spec.components.map((c) => `- ${c}`) : [],
  );

  const behaviour = section('Behaviour', [
    has(spec.interactions) ? spec.interactions.trim() : null,
  ]);

  const a11y = section('Accessibility', [
    has(spec.accessibilityNotes) ? spec.accessibilityNotes.trim() : null,
  ]);

  const replication = section('Replication notes', [
    has(spec.replicationNotes) ? spec.replicationNotes.trim() : null,
  ]);

  return [
    head,
    colorSection,
    typeSection,
    layoutSection,
    componentsSection,
    effects,
    behaviour,
    a11y,
    replication,
  ]
    .filter((part) => part.trim().length > 0)
    .join('\n');
}

/** A build instruction wrapped around the spec. */
export function toClaudePrompt(record: DesignRecord): string {
  return [
    `Build a faithful implementation of the design below, "${record.title}".`,
    '',
    'Honour the tokens exactly — the hex values, the type scale, the spacing scale and the',
    'corner radii are measurements from the original, not suggestions. Where the spec is',
    'silent, choose something consistent with the style keywords and say what you chose.',
    '',
    '---',
    '',
    toMarkdownSpec(record),
  ].join('\n');
}

export function toTokens(record: DesignRecord): Record<string, unknown> {
  const { spec, auto, image } = record;
  const color: Record<string, string> = {};
  for (const token of spec.colorTokens) color[token.name] = token.value;

  const fontSize: Record<string, string> = {};
  const fontWeight: Record<string, string> = {};
  const lineHeight: Record<string, string> = {};
  const letterSpacing: Record<string, string> = {};
  for (const step of spec.typography.scale) {
    const key = slugify(step.name);
    if (has(step.size)) fontSize[key] = step.size;
    if (has(step.weight)) fontWeight[key] = step.weight;
    if (has(step.lineHeight)) lineHeight[key] = step.lineHeight;
    if (has(step.letterSpacing)) letterSpacing[key] = step.letterSpacing;
  }

  const spacing = spec.layout.spacingScale
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    $schema: 'https://design-warehouse.local/tokens/v1',
    name: record.title,
    id: record.id,
    meta: {
      category: spec.category,
      platform: spec.platform,
      styleKeywords: spec.styleKeywords,
      tags: record.tags,
      source: record.sourceUrl || undefined,
      capture: {
        width: image.width,
        height: image.height,
        aspectRatio: describeAspect(image.width, image.height),
      },
      colorScheme: auto.colorScheme,
      saturation: auto.saturation,
    },
    color,
    typography: {
      fontFamily: {
        heading: spec.typography.headingFamily || undefined,
        body: spec.typography.bodyFamily || undefined,
        mono: spec.typography.monoFamily || undefined,
      },
      baseSize: spec.typography.baseSize || undefined,
      fontSize,
      fontWeight,
      lineHeight,
      letterSpacing,
    },
    layout: {
      structure: spec.layout.structure || undefined,
      columns: spec.layout.columns || undefined,
      maxWidth: spec.layout.maxWidth || undefined,
      gutter: spec.layout.gutter || undefined,
      radius: spec.layout.radius || undefined,
      breakpoints: spec.layout.breakpoints || undefined,
      spacing,
      measured: auto.layout,
    },
    components: spec.components,
    effects: spec.effects,
  };
}

export function toCssVariables(record: DesignRecord): string {
  const lines: string[] = [`/* ${record.title} — design tokens */`, ':root {'];
  for (const token of record.spec.colorTokens) {
    lines.push(`  --color-${slugify(token.name)}: ${token.value};${token.usage ? ` /* ${token.usage} */` : ''}`);
  }
  const { typography, layout } = record.spec;
  if (has(typography.headingFamily)) lines.push(`  --font-heading: ${typography.headingFamily};`);
  if (has(typography.bodyFamily)) lines.push(`  --font-body: ${typography.bodyFamily};`);
  if (has(typography.monoFamily)) lines.push(`  --font-mono: ${typography.monoFamily};`);
  for (const step of typography.scale) {
    if (has(step.size)) lines.push(`  --text-${slugify(step.name)}: ${step.size};`);
    if (has(step.lineHeight)) lines.push(`  --leading-${slugify(step.name)}: ${step.lineHeight};`);
  }
  layout.spacingScale
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .forEach((value, i) => {
      lines.push(`  --space-${i + 1}: ${/^\d+$/.test(value) ? `${value}px` : value};`);
    });
  if (has(layout.maxWidth)) lines.push(`  --max-width: ${layout.maxWidth};`);
  if (has(layout.radius)) lines.push(`  --radius: ${layout.radius};`);
  lines.push('}');
  return lines.join('\n');
}

/** One document covering a selection — handy for seeding a whole project. */
export function toCatalogMarkdown(records: DesignRecord[]): string {
  const header = [
    '# Design Warehouse export',
    '',
    `${records.length} design${records.length === 1 ? '' : 's'} · exported ${fmtDate(Date.now())}`,
    '',
    'Each section below is a self-contained design spec: colors, typography, layout and',
    'effects measured or recorded from a screenshot. Use them as the reference when',
    'building or restyling a prototype.',
    '',
    '---',
    '',
  ].join('\n');
  return header + records.map(toMarkdownSpec).join('\n\n---\n\n');
}
