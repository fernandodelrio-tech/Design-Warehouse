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
/**
 * The prompt behind "Copy prompt for Claude".
 *
 * Its whole job is to establish that what follows is a design *language* to be
 * applied to something — not a page to rebuild. The original wording opened
 * with "Build a faithful implementation of the design below", and that reliably
 * produced a standalone reproduction of the screenshot when what was wanted was
 * an existing app restyled.
 *
 * With no target set the prompt assumes the obvious one: whatever the
 * conversation it is pasted into is already working on. That is right far more
 * often than asking is useful — you paste a design prompt into the session
 * where you are building the thing — and the two overrides are both cheap: a
 * target named in the message wins, and so does one typed into the drawer.
 * Asking is kept only for a conversation with nothing in it yet.
 */
/**
 * The parts of a spec that are recorded by hand rather than measured off the
 * pixels, and whether this record actually carries each of them.
 *
 * The exporter drops empty fields, which is right for a document but leaves the
 * reader unable to tell "the design has no border style" from "nobody wrote one
 * down". Naming the gaps closes that, and stops the instructions claiming a
 * measurement that is not in the file.
 */
function unrecorded(record: DesignRecord): string[] {
  const { typography: type, layout, effects, components, interactions } = record.spec;
  const gaps: string[] = [];
  const anyType =
    has(type.headingFamily) || has(type.bodyFamily) || has(type.monoFamily) ||
    has(type.baseSize) || has(type.notes) ||
    type.scale.some((step) => has(step.size) || has(step.weight) || has(step.lineHeight));
  if (!anyType) gaps.push('a type scale or any font');
  if (!has(layout.radius)) gaps.push('corner radii');
  if (!has(layout.borders)) gaps.push('border styles');
  if (!has(layout.maxWidth) && !has(layout.gutter) && !has(layout.breakpoints)) {
    gaps.push('max width, gutter and breakpoints');
  }
  if (!Object.values(effects).some(has)) gaps.push('shadows, gradients, blur, motion or imagery');
  if (components.length === 0) gaps.push('a component inventory');
  if (!has(interactions)) gaps.push('interaction notes');
  return gaps;
}

export function toClaudePrompt(record: DesignRecord, target = ''): string {
  const named = target.trim();
  return [
    `Apply the design language below — "${record.title}" — to the target set out in`,
    'the next section.',
    '',
    '## Apply it to',
    '',
    ...(named
      ? [
          `> **${named}**`,
          '>',
          '> If that is ambiguous, or you cannot find it, ask me before building anything.',
        ]
      : [
          '> **Whatever we are already working on in this conversation.**',
          '>',
          '> If I named a target in my message, that is it. Otherwise take the thing',
          '> currently in hand — the artifact you just built, the app or repo that is',
          '> open, the document we have been editing — and restyle that in place.',
          '> Ask me only if there is genuinely nothing in play yet.',
        ]),
    '',
    '## How to use what follows',
    '',
    'It is a visual system measured from one screenshot, not a page to reproduce. The',
    "screenshot's own content — its words, its sections, whatever it happened to show —",
    'is not part of the brief. What transfers is colour, type, spacing, shape and density.',
    '',
    '- **Restyle, do not re-architect.** Keep the structure, components and behaviour the',
    '  target already has. You are changing how it looks, not what it is or what it does.',
    '- **Honour what the spec carries, exactly.** Two kinds of thing are in it and both',
    '  bind. The colours, the contrast ratios and the layout figures are measured off the',
    '  pixels. Anything under Typography, Corner radius, Borders, Effects or Components',
    '  was recorded by hand. Neither is a suggestion; a section simply missing means it',
    '  was never recorded, not that the design has none of it.',
    '- **Map onto what is already there.** If the target has its own tokens, theme or',
    '  variables, redefine those rather than bolting a second system alongside them.',
    '- **Where the spec is silent, choose** something consistent with the style keywords,',
    '  and say what you chose.',
    '- **Derive rather than invent.** A working interface needs what a screenshot never',
    '  had — hover, focus and disabled states, error styling, a second theme. Build those',
    '  by mixing the measured colours toward the darkest or lightest of them, and say what',
    '  you derived and what it measures.',
    '- **Check contrast before spending a colour.** The ratios below include any that fail.',
    '  Keep the hex, because it is what the design is, but do not use a failing pair for',
    '  text: a colour that fails on the page background can still be a fill, a rule or a',
    '  mark, and usually reads well with the darkest colour knocked out of it.',
    '- **Verify on the result, not in your head.** Re-check contrast against the surface a',
    '  colour actually lands on, which is often a card rather than the page.',
    '- **Say what you could not honour**, and why, rather than dropping it quietly.',
    ...gapLines(record),
    '',
    '---',
    '',
    toMarkdownSpec(record),
  ].join('\n');
}

/** The caveat that follows the instructions, when there is one to give. */
function gapLines(record: DesignRecord): string[] {
  const gaps = unrecorded(record);
  if (gaps.length === 0) return [];
  return [
    '',
    '## What this one does not carry',
    '',
    'Nothing was recorded for:',
    '',
    ...gaps.map((gap) => `- ${gap}`),
    '',
    'Those are fields somebody fills in, not things the app measures. Their absence says',
    'this design was never annotated — it is not a claim that the design lacks them.',
    'Choose what suits the style keywords, and say what you chose.',
  ];
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
export function toCatalogMarkdown(records: DesignRecord[], target = ''): string {
  const named = target.trim();
  const header = [
    '# Design Warehouse export',
    '',
    `${records.length} design${records.length === 1 ? '' : 's'} · exported ${fmtDate(Date.now())}`,
    '',
    ...(named ? [`**Apply these to:** ${named}`, ''] : []),
    'Each section below is a self-contained design language: colours, typography, layout',
    'and effects measured from one screenshot. They are references to apply to something',
    'you already have or are about to build — by default whatever this conversation is',
    'already working on, unless a target is named above or in the message. Say which of',
    'these to apply. The measured values are exact; anything a spec leaves silent is yours',
    'to choose, and worth saying out loud when you do.',
    '',
    '---',
    '',
  ].join('\n');
  return header + records.map(toMarkdownSpec).join('\n\n---\n\n');
}
