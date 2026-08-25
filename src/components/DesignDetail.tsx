import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useFullImageUrl } from '../hooks/useImageUrl';
import { ANALYZER_VERSION } from '../lib/analyze';
import { describeAspect, formatBytes } from '../lib/image';
import { useOverlay } from '../lib/overlay';
import { scrollerAbove, usePinchZoom } from '../lib/pinch';
import {
  slugify,
  toClaudePrompt,
  toCssVariables,
  toMarkdownSpec,
  toTokens,
} from '../lib/spec';
import { COMPONENTS, CATEGORIES, FONT_STACKS, PLATFORMS, STYLE_KEYWORDS } from '../lib/suggestions';
import {
  MAX_TARGET,
  currentTarget,
  recentTargets,
  rememberTarget,
  setCurrentTarget,
} from '../lib/target';
import { copyText, downloadText } from '../lib/transfer';
import type { ColorToken, DesignRecord, TypeStep } from '../lib/types';
import { useNotify } from './Toast';
import { ListEditor } from './ListEditor';
import { PaletteStrip } from './PaletteStrip';
import { MeasuredDetail } from './MeasuredDetail';
import { Field, Section, TextArea, TextField, recordedLabel } from './SpecFields';
import {
  IconClose,
  IconCopy,
  IconDownload,
  IconRefresh,
  IconSparkle,
  IconStar,
  IconTrash,
} from './Icons';

interface Props {
  record: DesignRecord;
  onChange: (record: DesignRecord) => void;
  onClose: () => void;
  onDelete: (id: string) => void;
  onReanalyze: (id: string) => void;
  onDownloadImage: (record: DesignRecord) => void;
}

/**
 * The export routes, behind one control.
 *
 * A <details> rather than a popover: it opens in flow inside a panel that is
 * already tall, so nothing is covered and no anchor positioning is needed. But
 * a bare <details> is not a menu — it does not close when you press Escape or
 * click away — and in this drawer the first of those is worse than missing.
 * The dialog listens for Escape on the document, so without this the key that
 * should dismiss the menu closed the whole drawer behind it.
 */
function ExportMenu({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !node.open) return;
      // Before the dialog's own handler, which would close the drawer.
      event.stopPropagation();
      event.preventDefault();
      node.open = false;
      node.querySelector('summary')?.focus();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (node.open && !node.contains(event.target as Node)) node.open = false;
    };

    // Capture, so this runs before the document-level listener in lib/overlay.
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, []);

  return (
    <details className="export-menu" ref={ref}>
      {children}
    </details>
  );
}

export function DesignDetail({
  record,
  onChange,
  onClose,
  onDelete,
  onReanalyze,
  onDownloadImage,
}: Props) {
  const notify = useNotify();
  const url = useFullImageUrl(record.id);
  const [zoomed, setZoomed] = useState(false);
  /*
     Pinch and drag on the picture. The scroller it hands a one-finger drag
     back to is whichever ancestor actually scrolls, found by looking rather
     than by name: it is the overlay under a thumb and the preview pane with a
     mouse, and naming one of them picks the wrong one half the time.
  */
  const pinch = usePinchZoom(scrollerAbove);
  const [draft, setDraft] = useState(record);
  // Remembered across designs and sessions: you usually restyle one project at
  // a time, so the field is nearly always already right.
  const [target, setTarget] = useState(currentTarget);
  const [recent] = useState(recentTargets);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  // Catalogued by an older analyzer, so whatever it did not know how to measure
  // is still blank — and a blank field is one the exported prompt leaves out.
  // Only re-reading the pixels fills it.
  const stale = draft.auto.version < ANALYZER_VERSION;
  // Tracks whether the user has actually changed something, so closing an
  // untouched drawer never writes a pointless revision to the database.
  const dirty = useRef(false);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Reset when a different design is opened, or when the analyzer rewrites this one.
  useEffect(() => {
    dirty.current = false;
    setDraft(record);
  }, [record.id, record.auto.extractedAt]);

  // Debounced persistence: typing in the editor should not hit IndexedDB per keystroke.
  useEffect(() => {
    if (!dirty.current) return;
    const timer = setTimeout(() => {
      dirty.current = false;
      onChange({ ...draftRef.current, updatedAt: Date.now() });
    }, 400);
    return () => clearTimeout(timer);
  }, [draft, onChange]);

  // Flush anything still pending when the drawer goes away.
  useEffect(
    () => () => {
      if (!dirty.current) return;
      dirty.current = false;
      onChange({ ...draftRef.current, updatedAt: Date.now() });
    },
    [onChange],
  );

  // Scroll lock, focus trap, Escape and focus restore — see lib/overlay.
  useOverlay(overlayRef, onClose);

  const patch = (updater: (current: DesignRecord) => DesignRecord) => {
    dirty.current = true;
    setDraft((current) => updater(current));
  };

  const setSpec = (updater: (spec: DesignRecord['spec']) => DesignRecord['spec']) =>
    patch((current) => ({ ...current, spec: updater(current.spec) }));

  const copy = async (label: string, text: string) => {
    try {
      await copyText(text);
      notify(`${label} copied to the clipboard.`, 'success');
    } catch {
      notify('The browser blocked the clipboard write.', 'error');
    }
  };

  const fileBase = useMemo(() => slugify(draft.title), [draft.title]);

  const updateToken = (index: number, changes: Partial<ColorToken>) =>
    setSpec((spec) => ({
      ...spec,
      colorTokens: spec.colorTokens.map((token, i) =>
        i === index ? { ...token, ...changes } : token,
      ),
    }));

  const updateStep = (index: number, changes: Partial<TypeStep>) =>
    setSpec((spec) => ({
      ...spec,
      typography: {
        ...spec.typography,
        scale: spec.typography.scale.map((step, i) =>
          i === index ? { ...step, ...changes } : step,
        ),
      },
    }));

  return (
    <div
      className="overlay"
      role="dialog"
      aria-modal="true"
      aria-label={draft.title}
      ref={overlayRef}
      tabIndex={-1}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="detail">
        <div className="detail-preview">
          {url ? (
            <img
              src={url}
              alt={draft.title}
              className={zoomed ? 'zoomed' : ''}
              {...pinch.handlers}
              onClick={() => {
                // A mouse has no pinch; a click still steps in and out.
                if (pinch.zoomed) pinch.reset();
                else setZoomed((z) => !z);
              }}
              onDoubleClick={pinch.reset}
              style={{
                cursor: pinch.zoomed ? 'grab' : zoomed ? 'zoom-out' : 'zoom-in',
                transform: pinch.zoomed
                  ? `translate(${pinch.zoom.x}px, ${pinch.zoom.y}px) scale(${pinch.zoom.scale})`
                  : undefined,
                touchAction: 'none',
              }}
            />
          ) : (
            <div style={{ color: 'var(--text-faint)' }}>Loading image…</div>
          )}
        </div>

        <div className="detail-side">
          <header className="detail-head">
            {/*
               The title on screen is an editable input, which is right — it is
               the field you rename a design in — but an input is not a heading,
               and the drawer had no heading at all. A screen reader navigating
               by heading landed nowhere inside it.
            */}
            <h2 className="visually-hidden">{draft.title}</h2>
            <div className="detail-head-row">
              <input
                className="detail-title"
                value={draft.title}
                onChange={(e) => patch((c) => ({ ...c, title: e.target.value }))}
                aria-label="Design title"
              />
              <button
                type="button"
                className="btn btn-ghost btn-icon"
                title={draft.favorite ? 'Remove from favourites' : 'Add to favourites'}
                onClick={() => patch((c) => ({ ...c, favorite: !c.favorite }))}
              >
                <IconStar filled={draft.favorite} />
              </button>
              <button type="button" className="btn btn-ghost btn-icon" onClick={onClose} title="Close">
                <IconClose />
              </button>
            </div>

            <Field label="Apply it to">
              <input
                className="apply-target"
                value={target}
                maxLength={MAX_TARGET}
                list="dw-recent-targets"
                placeholder="whatever the conversation is working on"
                onChange={(event) => {
                  setTarget(event.target.value);
                  setCurrentTarget(event.target.value);
                }}
                aria-label="What to apply this design to"
              />
              {recent.length > 0 && (
                <datalist id="dw-recent-targets">
                  {recent.map((value) => (
                    <option key={value} value={value} />
                  ))}
                </datalist>
              )}
              <span className="apply-hint">
                {target.trim()
                  ? 'Baked into the copied prompt, and remembered for next time.'
                  : 'Left blank, the prompt applies the design to whatever the conversation is already working on.'}
              </span>
            </Field>

            {/*
               One primary action, and one door to the rest.

               This row carried eight buttons before any content — copy prompt,
               spec, JSON, CSS, .md, image, re-analyze, delete — all the same
               size, all competing, with the destructive one as the eighth
               sibling. Four of them are one idea in four formats, so they are
               one control now; the two that manage the record rather than use
               it moved to the end of the drawer, where the sync panel already
               keeps its equivalent.
            */}
            <div className="detail-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  rememberTarget(target);
                  void copy('Prompt', toClaudePrompt(draft, target));
                }}
                title={
                  target.trim()
                    ? `Copies a prompt that applies this design to: ${target.trim()}`
                    : 'Copies a prompt that applies this design to whatever the conversation is working on. Name a target above to override.'
                }
              >
                <IconSparkle /> Copy prompt for Claude
              </button>

              <ExportMenu>
                <summary className="btn">
                  <IconDownload /> Export
                </summary>
                <div className="export-menu-list">
                  <button type="button" className="btn" onClick={() => copy('Spec', toMarkdownSpec(draft))}>
                    <IconCopy /> Copy spec
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => copy('Tokens JSON', JSON.stringify(toTokens(draft), null, 2))}
                  >
                    <IconCopy /> Copy tokens as JSON
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => copy('CSS variables', toCssVariables(draft))}
                  >
                    <IconCopy /> Copy CSS variables
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => downloadText(`${fileBase}.md`, toMarkdownSpec(draft), 'text/markdown')}
                  >
                    <IconDownload /> Download spec as .md
                  </button>
                  <button type="button" className="btn" onClick={() => onDownloadImage(draft)}>
                    <IconDownload /> Download the screenshot
                  </button>
                </div>
              </ExportMenu>

              {/*
                 Re-analyze belongs here, not only behind a disclosure.

                 It had two homes: a banner when the record was older than the
                 current analyzer, and a button inside "Manage this design".
                 A design already on the current version got neither — the
                 banner is conditional and the section is collapsed — so the
                 way to re-measure a design against the newest analyzer was
                 invisible unless the record happened to be stale. Re-running
                 it is not record management; it is how the spec this drawer
                 exists to export gets its measurements back.
              */}
              {!stale && (
                <button type="button" className="btn" onClick={() => onReanalyze(draft.id)}>
                  <IconRefresh /> Re-analyze
                </button>
              )}
            </div>
          </header>

          <div className="detail-body">
            {/*
               Stale used to be a bare "·" appended to a button label, explained
               only in a title attribute — an invisible state on the one action
               that fills in what is missing. It says so now, where it will be
               read, and carries the action with it.
            */}
            {stale && (
              <div className="detail-stale">
                <p>
                  Catalogued by an older analyzer. Re-running it measures what this design is
                  still missing — every blank field is dropped from the exported prompt.
                </p>
                <button type="button" className="btn btn-primary" onClick={() => onReanalyze(draft.id)}>
                  <IconRefresh /> Re-analyze
                </button>
              </div>
            )}
            <datalist id="dw-categories">
              {CATEGORIES.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            <datalist id="dw-platforms">
              {PLATFORMS.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
            <datalist id="dw-fonts">
              {FONT_STACKS.map((f) => (
                <option key={f} value={f} />
              ))}
            </datalist>

            <Section title="Overview" defaultOpen>
              <div className="field-row">
                <TextField
                  label="Category"
                  value={draft.spec.category}
                  list="dw-categories"
                  placeholder="Web landing page"
                  onChange={(value) => setSpec((s) => ({ ...s, category: value }))}
                />
                <TextField
                  label="Platform"
                  value={draft.spec.platform}
                  list="dw-platforms"
                  placeholder="Web — desktop"
                  onChange={(value) => setSpec((s) => ({ ...s, platform: value }))}
                />
              </div>
              <Field label="Style keywords">
                <ListEditor
                  values={draft.spec.styleKeywords}
                  suggestions={STYLE_KEYWORDS}
                  placeholder="minimal, high contrast…"
                  onChange={(values) => setSpec((s) => ({ ...s, styleKeywords: values }))}
                />
              </Field>
              <Field label="Tags">
                <ListEditor
                  values={draft.tags}
                  placeholder="inspiration, competitor, v2…"
                  onChange={(values) => patch((c) => ({ ...c, tags: values }))}
                />
              </Field>
              <TextField
                label="Source URL"
                value={draft.sourceUrl}
                placeholder="https://…"
                onChange={(value) => patch((c) => ({ ...c, sourceUrl: value }))}
              />
              <TextArea
                label="Notes"
                value={draft.notes}
                placeholder="What caught your eye, what to steal, what to avoid."
                onChange={(value) => patch((c) => ({ ...c, notes: value }))}
              />
            </Section>

            <Section title="Color" defaultOpen badge={`${draft.auto.palette.length} extracted`}>
              <PaletteStrip palette={draft.auto.palette} large />
              <div className="readout">
                <dt>Scheme</dt>
                <dd>{draft.auto.colorScheme}</dd>
                <dt>Saturation</dt>
                <dd>{draft.auto.saturation}</dd>
                <dt>Mean luminance</dt>
                <dd>{draft.auto.averageLuminance}</dd>
              </div>

              {draft.auto.contrastPairs.length > 0 && (
                <Field label="Measured contrast">
                  <div style={{ display: 'grid', gap: 6 }}>
                    {draft.auto.contrastPairs.map((pair, i) => (
                      <div className="contrast-row" key={i}>
                        <span
                          className="contrast-sample"
                          style={{ background: pair.background, color: pair.foreground }}
                        >
                          Aa
                        </span>
                        <span className="mono">
                          {pair.foreground} on {pair.background}
                        </span>
                        <span>{pair.ratio}:1</span>
                        <span
                          className={`badge ${
                            pair.rating === 'Fail'
                              ? 'fail'
                              : pair.rating === 'AA Large'
                                ? 'warn'
                                : 'pass'
                          }`}
                        >
                          {pair.rating}
                        </span>
                      </div>
                    ))}
                  </div>
                </Field>
              )}

              <Field label="Color tokens" hint="names become CSS variables on export">
                <div style={{ display: 'grid', gap: 6 }}>
                  {draft.spec.colorTokens.map((token, i) => (
                    <div className="token-row" key={i}>
                      <label
                        className="token-swatch"
                        style={{ background: token.value }}
                        title={token.value}
                      >
                        <input
                          type="color"
                          value={/^#[0-9a-f]{6}$/i.test(token.value) ? token.value : '#000000'}
                          onChange={(e) => updateToken(i, { value: e.target.value })}
                          aria-label={`${token.name} colour`}
                        />
                      </label>
                      <input
                        value={token.name}
                        onChange={(e) => updateToken(i, { name: e.target.value })}
                        aria-label="Token name"
                      />
                      <input
                        className="mono"
                        value={token.value}
                        onChange={(e) => updateToken(i, { value: e.target.value })}
                        aria-label="Token value"
                      />
                      <input
                        value={token.usage}
                        placeholder="Where it is used"
                        onChange={(e) => updateToken(i, { usage: e.target.value })}
                        aria-label="Token usage"
                      />
                      <button
                        type="button"
                        className="btn btn-ghost btn-icon"
                        aria-label={`Remove ${token.name}`}
                        onClick={() =>
                          setSpec((s) => ({
                            ...s,
                            colorTokens: s.colorTokens.filter((_, index) => index !== i),
                          }))
                        }
                      >
                        <IconClose size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              </Field>
              <button
                type="button"
                className="btn"
                onClick={() =>
                  setSpec((s) => ({
                    ...s,
                    colorTokens: [
                      ...s.colorTokens,
                      { name: `token-${s.colorTokens.length + 1}`, value: '#888888', usage: '' },
                    ],
                  }))
                }
              >
                + Add token
              </button>
            </Section>

            <Section title="Typography" defaultOpen badge={recordedLabel(draft.spec.typography)}>
              <div className="field-row">
                <TextField
                  label="Heading family"
                  value={draft.spec.typography.headingFamily}
                  list="dw-fonts"
                  placeholder="Inter"
                  onChange={(value) =>
                    setSpec((s) => ({ ...s, typography: { ...s.typography, headingFamily: value } }))
                  }
                />
                <TextField
                  label="Body family"
                  value={draft.spec.typography.bodyFamily}
                  list="dw-fonts"
                  placeholder="Inter"
                  onChange={(value) =>
                    setSpec((s) => ({ ...s, typography: { ...s.typography, bodyFamily: value } }))
                  }
                />
              </div>
              <div className="field-row">
                <TextField
                  label="Mono family"
                  value={draft.spec.typography.monoFamily}
                  list="dw-fonts"
                  placeholder="JetBrains Mono"
                  onChange={(value) =>
                    setSpec((s) => ({ ...s, typography: { ...s.typography, monoFamily: value } }))
                  }
                />
                <TextField
                  label="Base size"
                  value={draft.spec.typography.baseSize}
                  placeholder="16px"
                  onChange={(value) =>
                    setSpec((s) => ({ ...s, typography: { ...s.typography, baseSize: value } }))
                  }
                />
              </div>

              <Field label="Type scale" hint="fill in what you can measure; blank rows are dropped on export">
                <div style={{ display: 'grid', gap: 5 }}>
                  <div className="scale-head">
                    <span>Step</span>
                    <span>Size</span>
                    <span>Weight</span>
                    <span>Leading</span>
                    <span>Tracking</span>
                  </div>
                  {draft.spec.typography.scale.map((step, i) => (
                    <div className="scale-row" key={i}>
                      <input
                        value={step.name}
                        onChange={(e) => updateStep(i, { name: e.target.value })}
                        aria-label="Step name"
                      />
                      <input
                        value={step.size}
                        placeholder="32px"
                        onChange={(e) => updateStep(i, { size: e.target.value })}
                        aria-label="Font size"
                      />
                      <input
                        value={step.weight}
                        placeholder="600"
                        onChange={(e) => updateStep(i, { weight: e.target.value })}
                        aria-label="Font weight"
                      />
                      <input
                        value={step.lineHeight}
                        placeholder="1.2"
                        onChange={(e) => updateStep(i, { lineHeight: e.target.value })}
                        aria-label="Line height"
                      />
                      <input
                        value={step.letterSpacing}
                        placeholder="-0.02em"
                        onChange={(e) => updateStep(i, { letterSpacing: e.target.value })}
                        aria-label="Letter spacing"
                      />
                    </div>
                  ))}
                </div>
              </Field>
              <button
                type="button"
                className="btn"
                onClick={() =>
                  setSpec((s) => ({
                    ...s,
                    typography: {
                      ...s.typography,
                      scale: [
                        ...s.typography.scale,
                        { name: 'New step', size: '', weight: '', lineHeight: '', letterSpacing: '' },
                      ],
                    },
                  }))
                }
              >
                + Add step
              </button>
              <TextArea
                label="Typography notes"
                value={draft.spec.typography.notes}
                placeholder="Uppercase eyebrow labels, tabular numerals in the table…"
                onChange={(value) =>
                  setSpec((s) => ({ ...s, typography: { ...s.typography, notes: value } }))
                }
              />
            </Section>

            <Section title="Layout" defaultOpen badge={recordedLabel(draft.spec.layout)}>
              <div style={{ color: 'var(--text-muted)', fontSize: 'var(--t-label)' }}>
                {draft.auto.layout.summary}
              </div>
              {/*
                 What the analyzer measured, before the fields it seeded from
                 it. The corner, the hairline and the elevation were previously
                 only ever strings in the inputs below.
              */}
              <Field label="Measured geometry">
                <MeasuredDetail detail={draft.auto.detail} palette={draft.auto.palette} />
              </Field>
              <div className="field-row">
                <TextField
                  label="Structure"
                  value={draft.spec.layout.structure}
                  placeholder="Sidebar + content"
                  onChange={(value) => setSpec((s) => ({ ...s, layout: { ...s.layout, structure: value } }))}
                />
                <TextField
                  label="Columns"
                  value={draft.spec.layout.columns}
                  placeholder="12-column grid"
                  onChange={(value) => setSpec((s) => ({ ...s, layout: { ...s.layout, columns: value } }))}
                />
              </div>
              <div className="field-row">
                <TextField
                  label="Max width"
                  value={draft.spec.layout.maxWidth}
                  placeholder="1200px"
                  onChange={(value) => setSpec((s) => ({ ...s, layout: { ...s.layout, maxWidth: value } }))}
                />
                <TextField
                  label="Gutter"
                  value={draft.spec.layout.gutter}
                  placeholder="24px"
                  onChange={(value) => setSpec((s) => ({ ...s, layout: { ...s.layout, gutter: value } }))}
                />
              </div>
              <div className="field-row">
                <TextField
                  label="Corner radius"
                  value={draft.spec.layout.radius}
                  placeholder="12px cards, 8px buttons"
                  onChange={(value) => setSpec((s) => ({ ...s, layout: { ...s.layout, radius: value } }))}
                />
                <TextField
                  label="Borders"
                  value={draft.spec.layout.borders}
                  placeholder="1px hairline #E5E7EB"
                  onChange={(value) => setSpec((s) => ({ ...s, layout: { ...s.layout, borders: value } }))}
                />
              </div>
              <TextField
                label="Spacing scale"
                value={draft.spec.layout.spacingScale}
                placeholder="4, 8, 12, 16, 24, 32, 48"
                onChange={(value) => setSpec((s) => ({ ...s, layout: { ...s.layout, spacingScale: value } }))}
              />
              <TextField
                label="Breakpoints"
                value={draft.spec.layout.breakpoints}
                placeholder="640, 768, 1024, 1280"
                onChange={(value) => setSpec((s) => ({ ...s, layout: { ...s.layout, breakpoints: value } }))}
              />
              <TextArea
                label="Layout notes"
                value={draft.spec.layout.notes}
                onChange={(value) => setSpec((s) => ({ ...s, layout: { ...s.layout, notes: value } }))}
              />
            </Section>

            <Section title="Components">
              <ListEditor
                values={draft.spec.components}
                suggestions={COMPONENTS}
                placeholder="top navigation, card grid…"
                onChange={(values) => setSpec((s) => ({ ...s, components: values }))}
              />
            </Section>

            <Section title="Effects & detail" badge={recordedLabel(draft.spec.effects)}>
              <div className="field-row">
                <TextField
                  label="Shadows / elevation"
                  value={draft.spec.effects.shadows}
                  placeholder="0 1px 2px rgba(0,0,0,.06)"
                  onChange={(value) => setSpec((s) => ({ ...s, effects: { ...s.effects, shadows: value } }))}
                />
                <TextField
                  label="Gradients"
                  value={draft.spec.effects.gradients}
                  placeholder="135° indigo → violet"
                  onChange={(value) => setSpec((s) => ({ ...s, effects: { ...s.effects, gradients: value } }))}
                />
              </div>
              <div className="field-row">
                <TextField
                  label="Blur / glass"
                  value={draft.spec.effects.blur}
                  placeholder="backdrop-filter: blur(12px)"
                  onChange={(value) => setSpec((s) => ({ ...s, effects: { ...s.effects, blur: value } }))}
                />
                <TextField
                  label="Motion"
                  value={draft.spec.effects.animation}
                  placeholder="150ms ease-out hover lift"
                  onChange={(value) => setSpec((s) => ({ ...s, effects: { ...s.effects, animation: value } }))}
                />
              </div>
              <div className="field-row">
                <TextField
                  label="Iconography"
                  value={draft.spec.effects.iconography}
                  placeholder="1.5px stroke, 20px, rounded caps"
                  onChange={(value) => setSpec((s) => ({ ...s, effects: { ...s.effects, iconography: value } }))}
                />
                <TextField
                  label="Imagery"
                  value={draft.spec.effects.imagery}
                  placeholder="Product screenshots on tinted panels"
                  onChange={(value) => setSpec((s) => ({ ...s, effects: { ...s.effects, imagery: value } }))}
                />
              </div>
            </Section>

            <Section title="Behaviour & accessibility">
              <TextArea
                label="How it behaves"
                value={draft.spec.uxNotes}
                rows={10}
                placeholder="What each measured component is for, its states, and what has to be true underneath it…"
                onChange={(value) => setSpec((s) => ({ ...s, uxNotes: value }))}
              />
              <TextArea
                label="Interactions"
                value={draft.spec.interactions}
                placeholder="Hover states, focus rings, sticky header, scroll reveals…"
                onChange={(value) => setSpec((s) => ({ ...s, interactions: value }))}
              />
              <TextArea
                label="Accessibility notes"
                value={draft.spec.accessibilityNotes}
                onChange={(value) => setSpec((s) => ({ ...s, accessibilityNotes: value }))}
              />
              <TextArea
                label="Replication notes"
                value={draft.spec.replicationNotes}
                rows={4}
                placeholder="Direct instructions for Claude: what must match exactly, what can vary."
                onChange={(value) => setSpec((s) => ({ ...s, replicationNotes: value }))}
              />
            </Section>

            <Section title="Capture facts">
              <div className="readout">
                <dt>Dimensions</dt>
                <dd>
                  {draft.image.width}×{draft.image.height} ·{' '}
                  {describeAspect(draft.image.width, draft.image.height)} · {draft.image.orientation}
                </dd>
                <dt>File</dt>
                <dd>
                  {draft.image.mimeType} · {formatBytes(draft.image.byteSize)}
                  {draft.fileName ? ` · ${draft.fileName}` : ''}
                </dd>
                <dt>Added</dt>
                <dd>
                  {new Date(draft.createdAt).toLocaleString()} (via {draft.source})
                </dd>
                <dt>Density</dt>
                <dd>
                  {Math.round(draft.auto.layout.density * 100)}% detail ·{' '}
                  {Math.round(draft.auto.layout.whitespaceRatio * 100)}% flat space
                </dd>
                <dt>Margins</dt>
                <dd className="mono">
                  t {draft.auto.layout.margins.top} · r {draft.auto.layout.margins.right} · b{' '}
                  {draft.auto.layout.margins.bottom} · l {draft.auto.layout.margins.left}
                </dd>
                <dt>Analyzer</dt>
                <dd>
                  v{draft.auto.version} · {new Date(draft.auto.extractedAt).toLocaleString()}
                  {stale ? ` · older than v${ANALYZER_VERSION}` : ''}
                </dd>
              </div>
            </Section>

            {/*
               Managing the record, not using the design. Delete was the eighth
               button in a row that began with the primary action; here it is
               one deliberate disclosure away, which is where the sync panel
               already keeps the equivalent.
            */}
            <Section title="Manage this design">
              <p className="sync-note">
                Deleting can be undone from the toast, and for thirty days after that.
                Re-analyzing moved up to the action row, beside the export.
              </p>
              <div className="manage-actions">
                <button type="button" className="btn btn-danger" onClick={() => onDelete(draft.id)}>
                  <IconTrash /> Delete
                </button>
              </div>
            </Section>
          </div>
        </div>
      </div>
    </div>
  );
}
