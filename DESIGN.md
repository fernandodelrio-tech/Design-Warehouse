---
name: Design Warehouse
description: A measured room — every value taken off a real screenshot and honoured, including where the measurement is inconvenient.
colors:
  parchment: "#fbf7ec"
  vellum: "#e4dbcc"
  vellum-raised: "#f0e9dc"
  press-black: "#2b2b2b"
  ink: "#322d2f"
  sepia: "#4f433e"
  sepia-faded: "#6b594e"
  rust-terracotta: "#a1593e"
  terracotta-deep: "#844e38"
  burnt-umber: "#5c3517"
  clay-rule: "#b38470"
  hairline: "#dad9d3"
  dry-clay: "#c5b4a1"
  stone: "#a89b8b"
  ochre: "#c08b55"
  umber-mark: "#917662"
typography:
  display:
    fontFamily: "Public Sans, ui-sans-serif, system-ui, Segoe UI, Roboto, sans-serif"
    fontSize: "clamp(30px, 3.8vw, 47px)"
    fontWeight: 300
    lineHeight: 1.15
    letterSpacing: "normal"
  headline:
    fontFamily: "Public Sans, ui-sans-serif, system-ui, Segoe UI, Roboto, sans-serif"
    fontSize: "34px"
    fontWeight: 300
    letterSpacing: "normal"
  title:
    fontFamily: "Public Sans, ui-sans-serif, system-ui, Segoe UI, Roboto, sans-serif"
    fontSize: "24px"
    fontWeight: 300
    letterSpacing: "-0.015em"
  body:
    fontFamily: "Public Sans, ui-sans-serif, system-ui, Segoe UI, Roboto, sans-serif"
    fontSize: "17px"
    fontWeight: 300
    letterSpacing: "normal"
  small:
    fontFamily: "Public Sans, ui-sans-serif, system-ui, Segoe UI, Roboto, sans-serif"
    fontSize: "14px"
    fontWeight: 300
    letterSpacing: "normal"
  label:
    fontFamily: "Public Sans, ui-sans-serif, system-ui, Segoe UI, Roboto, sans-serif"
    fontSize: "12px"
    fontWeight: 700
    letterSpacing: "0.05em"
rounded:
  sm: "24px"
  md: "24px"
  lg: "24px"
spacing:
  s1: "4px"
  s2: "8px"
  s3: "12px"
  s4: "16px"
  s5: "24px"
  s6: "32px"
  s7: "48px"
  s8: "64px"
components:
  button-primary:
    backgroundColor: "{colors.rust-terracotta}"
    textColor: "{colors.parchment}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "8px 12px"
  button-primary-hover:
    backgroundColor: "{colors.terracotta-deep}"
    textColor: "{colors.parchment}"
  button-ghost:
    backgroundColor: "{colors.vellum}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "8px 12px"
  button-danger:
    backgroundColor: "{colors.vellum}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "8px 12px"
  button-danger-hover:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.parchment}"
  card:
    backgroundColor: "{colors.vellum}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "12px 12px 24px"
  chip:
    backgroundColor: "{colors.parchment}"
    textColor: "{colors.sepia}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "4px 8px"
  input:
    backgroundColor: "{colors.vellum}"
    textColor: "{colors.ink}"
    typography: "{typography.small}"
    rounded: "{rounded.sm}"
    padding: "4px 8px"
    height: "35px"
  toolbar:
    backgroundColor: "{colors.rust-terracotta}"
    textColor: "{colors.parchment}"
    typography: "{typography.label}"
    padding: "12px clamp(8px, 1vw, 20px) 12px clamp(16px, 4vw, 72px)"
  masthead:
    backgroundColor: "{colors.press-black}"
    textColor: "{colors.parchment}"
    height: "56px"
---

# Design System: Design Warehouse

## Overview

**Creative North Star: "The Measured Room"**

Nothing in this interface was chosen by taste. Every value was measured off a
screenshot the app itself catalogued, and then honoured — including where the
measurement was inconvenient. The page is hung off its left margin at 4% with
1% on the right, because that is what the capture did, and tidying it into a
symmetry would have been a decision the evidence did not support. The stylesheet
records the reasoning beside each value, so the system is falsifiable rather
than merely consistent: anyone can check a token against the capture it came
from.

The result is warm, editorial and deliberate. Beige grounds, a single copper
band across the toolbar, and a generous inset make it read closer to a printed
reference than to application chrome. Colour is spent in exactly two places —
the accent and the toolbar band — and everything else is ground, space and
tracking. All three measured type steps are capitals, and the smallest of them
is the only bold one, so the heavy end of the page is its labels rather than its
headings.

This is a room the product furnishes for other people's designs. The interface
holds screenshots whose colours are not ours to choose, and it recedes so they
can be compared. That is why surfaces are borderless where our own ground sits
beneath them, and why the few places a control sits on a *stranger's* image are
the exceptions that take an edge.

**Key Characteristics:**
- Warm neutral grounds with a single copper accent; no second hue anywhere
- One radius (24px) at every size, so every control is a lozenge
- One variable face, cut at 300 and 700 — contrast by weight, never by family
- Capitals and letter-spacing carry hierarchy; ornament does not
- Borderless by default; an edge means something specific
- Asymmetric page inset, preserved from the measurement

## Colors

A warm neutral palette with one accent, drawn from a single catalogued
screenshot; the light theme's grounds run parchment to vellum, and the dark
theme is derived from the capture's own measured black band rather than by
inverting the light one.

### Primary
- **Rust Terracotta** (`#a1593e`): The only accent in the system. Primary
  actions, links, focus, the toolbar band, and the mark on a severity icon. It
  reads **4.89:1 on parchment**, which is what lets it be actual type rather
  than only a fill — a threshold most muted accents miss. On vellum it drops to
  3.81 and becomes a fill only.
- **Deep Terracotta** (`#844e38`): The hover state, at 6.27:1. Hover goes
  *darker* here, against the usual convention, because the accent's label is
  the page colour rather than the ink — lightening the fill is what would drop
  the pair below AA.
- **Burnt Umber** (`#5c3517`): The deepest step, at 9.92:1. Used as a solid
  fill where the accent must carry small light type, and as the avatar ground.

### Neutral
- **Parchment** (`#fbf7ec`): The page. A pale warm paper, and the light on
  which everything else is judged.
- **Vellum** (`#e4dbcc`): Every raised surface — cards, panels, fields, the
  elevated ground. Note that it is **darker** than the page, not lighter.
- **Raised Vellum** (`#f0e9dc`): The hover step, which moves back *up* toward
  the page rather than further down.
- **Press Black** (`#2b2b2b`): The masthead band. Taken from the capture's
  full-width footer, and the ground the entire dark theme is built from.
- **Ink** (`#322d2f`): Body text, at 12.64:1 on parchment. Also the destructive
  semantic, because this palette holds no red.
- **Sepia** (`#4f433e`) and **Faded Sepia** (`#6b594e`): The secondary and
  tertiary text tiers, at 8.90:1 and 6.20:1 on the page. Faded Sepia is the
  placeholder tier and still clears AA at 4.84:1 on a surface.
- **Clay Rule** (`#b38470`): The control border, and the only rule that appears
  by default anywhere.
- **Hairline** (`#dad9d3`) and **Dry Clay** (`#c5b4a1`): Dividers and muted
  fills. Dry Clay is also what a placeholder shape is drawn in.
- **Stone** (`#a89b8b`), **Ochre** (`#c08b55`), **Umber Mark** (`#917662`):
  The remaining measured fills. Ochre doubles as the warning semantic. Umber
  Mark is **never used as type** — it sits at 3.95:1 and is a mark only.

### Named Rules

**The Two Places Rule.** Colour appears in exactly two places: the accent and
the toolbar band. Everything else is ground, space and tracking. A third hue is
not a variation on this system, it is a different one.

**The No Red Rule.** This palette contains no red and no green, because the
screenshot it was measured from contained neither. Severity therefore cannot be
carried by hue: `--danger` resolves to the body-text ink in light and to the
page cream in dark, and `--success` to a brown and a tan. **Any state that must
be distinguishable must carry a drawn mark and a word.** Colour may reinforce
it; colour may never be the only signal.

**The Borderless Ground Rule.** Thirty-six of the forty-two measured blocks
carry no border, and the app follows that wherever its own ground is underneath.
The exception is a control sitting on a catalogued screenshot, whose colour is
arbitrary — there an edge is not decoration, it is the only thing keeping the
control visible. The page colour on a pale capture measures 1.02:1.

## Typography

**Display Font:** Public Sans (with `ui-sans-serif`, `system-ui`, Segoe UI, Roboto)
**Body Font:** Public Sans — the same face
**Label/Mono Font:** `ui-monospace` / SFMono-Regular / Menlo for measured values only

**Character:** One variable grotesque doing every job, cut at 300 and 700 and
nothing between. The capture measured three steps whose contrast came entirely
from weight, so a family with a single mid cut could not have set it; the range
is the point. Self-hosted as a 27 KB latin subset, because the app must work
with the network off and opening it should not tell a font CDN that you did.

### Hierarchy
- **Display** (300, `clamp(30px, 3.8vw, 47px)`, 1.15): Page and empty-state
  headings. The ratio to body is 2.76, honoured exactly from the measurement.
- **Headline** (300, 34px): Section headings in wide layouts.
- **Title** (300, 24px, -0.015em): Panel titles — the drawer, the sync panel.
- **Body** (300, 17px): Running prose and field values.
- **Small** (300, 14px): Secondary prose, toasts, help text.
- **Label** (700, 12px, +0.05em, uppercase): Field captions, chips, buttons,
  counts. The only bold in the system.

### Named Rules

**The Heavy Label Rule.** The smallest step is the only bold one — a 700 at
12px against a 300 at 34px. This inversion is measured, not stylistic: the
capture's small row had a 4px stem where its display had 5 on 91px of ink. The
labels are the heavy end of this design, and reversing that reverses the system.

**The Caption-Only Capitals Rule.** `text-transform: uppercase` belongs to the
label role — captions, chips, buttons, counts. It must never reach a sentence.
A `<label>` that wraps a control and its explanation is prose, not a caption;
scope caps to the caption itself (`.field > label[for]`), or a data-loss warning
ends up set in 12px tracked capitals.

## Layout

A single column of content hung off the left margin. The page inset is
**asymmetric and deliberately so** — `clamp(16px, 4vw, 72px)` on the left
against `clamp(8px, 1vw, 20px)` on the right, preserved from a capture that
measured 4% and 1%. It is not a centred column that drifted.

The spacing scale is eight steps — **4, 8, 12, 16, 24, 32, 48, 64** — and
nothing in the stylesheet resolves to anything else. The catalog is a grid of
equal-height tiles whose track floor uses `min()` rather than a bare `minmax()`,
so a 300px preferred width collapses to the column width on a narrow phone
instead of overflowing the page sideways.

Two bands are fixed to the top and stay there: the masthead (56px) and the
filter toolbar directly beneath it. Both are sticky, because the controls that
govern what is on screen must not scroll away from the thing they govern.

Breakpoints are 900, 760, 700 and 460px. At the narrowest the catalog drops to
one tile per row and the toolbar becomes a single horizontally scrolling strip
with a fade at its right edge; controls that appear on hover with a mouse are
permanently visible on a touch screen.

### Named Rules

**The Eight Steps Rule.** Every padding, margin and gap resolves to one of the
eight spacing tokens. There is no `6px`, no `10px`, no arbitrary nudge — and an
inline style carrying one is drift, not an exception.

**The 320 Rule.** The page never scrolls sideways at 320px, the reference width
WCAG measures reflow against. Flex rows that hold labelled controls need
`min-width: 0` on the container as well as its children, and the room comes out
of padding before it comes out of a word.

## Elevation & Depth

**Depth is tonal first.** The ladder is parchment → vellum → raised vellum: a
raised thing is a *deeper* beige, not a paler one, which inverts the usual
convention and is measured. Shadow is secondary reinforcement, not the
mechanism — seven of forty-two measured blocks were lifted, so lifting is rare
and means something.

Where a shadow does appear it is soft and thrown **down and to the left**, which
is what the capture measured. That direction is an observed fact about the
current skin rather than a system invariant; a later reskin measuring a
different cast should follow its own evidence.

### Shadow Vocabulary
- **Small** (`-2px 2px 4px rgb(0 0 0 / 0.08)`): Controls resting on an image.
- **Standard** (`-4px 3px 7px rgb(0 0 0 / 0.12)`): Cards and raised panels.
- **Large** (`-7px 5px 14px rgb(0 0 0 / 0.16)`): Overlays and the open menu.

### Named Rules

**The Tonal-First Rule.** Reach for the next ground step before reaching for a
shadow. A shadow on a surface that is not genuinely raised above the page is
decoration, and this system has no budget for it.

## Shapes

One radius, and it is large: **24px at every size**. `--radius-sm`, `--radius`
and `--radius-lg` are all the same value on purpose. On a 35px control that
clamps to a lozenge, and the softness of that geometry against precise tracked
capitals is the tension the system runs on.

Borders are the exception rather than the rule. `--edge` is a *transparent* 1px
so that a rule can be added by changing a colour rather than a box model;
`--edge-control` is the visible 1px Clay Rule that a control needs to be found;
`--edge-dashed` marks a field nobody has filled in yet.

### Named Rules

**The One Radius Rule.** Every corner in the system is 24px. A component that
wants a tighter corner is asking to be a different component.

**The Dashed-Means-Empty Rule.** A dashed border means "nothing was written
here", and it means nothing else. It is how a blank field is distinguished from
a recorded one by shape rather than by a fainter grey.

## Components

Character in a phrase: **quiet until they matter**. A control is a fill and the
space around it; only the primary action and the destructive ones take a colour
or an edge. Restraint is the default and emphasis is earned.

### Buttons
- **Shape:** Fully lozenged (24px radius), `8px 12px` padding, label typography
  — 12px, 700, +0.05em, uppercase.
- **Primary:** Rust Terracotta fill with parchment type. Hover goes *darker* to
  Deep Terracotta, opening the pair from 4.89 to 6.27.
- **Ghost:** Vellum fill, ink type, transparent border. The default for
  everything that is not the one primary action on a surface.
- **Danger:** Ruled at rest — border and text in `--danger`, at label weight —
  and fills on hover. In a palette with no red, the *edge* is the signal: a
  destructive control is the only outlined one in a row of borderless peers.
- **Focus:** `0 0 0 2px` focus-ring plus `0 0 0 3px` focus, applied on
  `:focus-visible`.

### Chips
- **Style:** Parchment fill on a vellum surface, sepia label type, 24px radius,
  `4px 8px`.
- **State:** An accent chip (`chip-accent`) marks an active filter. Chips are
  static labels unless they carry an action.

### Cards / Containers
- **Corner Style:** 24px.
- **Background:** Vellum, on a parchment page.
- **Shadow Strategy:** Standard shadow; tonal step does most of the work.
- **Border:** None. `--edge` is transparent by default.
- **Internal Padding:** `12px 12px 24px`. Fixed height so footers align across
  a row and can be read down the page.

### Inputs / Fields
- **Style:** Vellum fill, Clay Rule border, 24px radius, 35px tall.
- **Empty:** Dashed border via `:placeholder-shown` — structurally different
  from a filled field, not merely fainter.
- **Focus:** The focus shadow, on `:focus-visible`.

### Navigation
- **Masthead:** A full-width Press Black band, 56px, borderless and without a
  shadow. It carries four levels of type on it — page colour at 13.23, vellum
  at 10.32, dry clay at 7.02 and ochre at 4.76.
- **Toolbar:** A full-width Rust Terracotta band directly beneath, its controls
  taking the page colour. Both are sticky.

### Measured-value samples
The system's signature component. A measurement is **drawn at its own scale on
the catalogued design's own ground**, never printed as a string: a corner
rendered at the radius that was measured, a hairline at its measured width and
colour, an elevation rebuilt from its falloff, a contrast pair set as real type
on real ground with its ratio and rating beside it. Each carries how many
samples agreed.

## Do's and Don'ts

### Do:
- **Do** resolve every padding, margin and gap to the eight-step scale
  (4/8/12/16/24/32/48/64).
- **Do** carry severity with a drawn mark and a word. Colour may reinforce; it
  may never be the only signal, because this palette has no red and no green.
- **Do** give a control an edge when it sits on a catalogued screenshot. That
  is the one ground whose colour is not ours.
- **Do** reach for the next tonal step before reaching for a shadow.
- **Do** draw a measurement at its own scale rather than printing it as text.
- **Do** show how firmly a value is known — measured, estimated, or blank —
  and how many samples agreed.
- **Do** apply `:focus-visible` styling to every interactive control; the
  `--focus-shadow` token exists for exactly this.

### Don't:
- **Don't** introduce a third hue. The accent and the toolbar band are the two
  places colour lives.
- **Don't** let `text-transform: uppercase` reach a sentence. Capitals belong to
  the label role.
- **Don't** tighten a corner. Every radius in the system is 24px.
- **Don't** centre the page. The 4%/1% inset is measured and asymmetric.
- **Don't** add a border to a surface sitting on our own ground; borderless is
  the measured default.
- **Don't** animate a layout property. Transitions belong on colour, border,
  opacity and transform.
- **Don't** kill motion wholesale under `prefers-reduced-motion`. Nearly all
  motion here is state feedback; remove travel and repetition, keep the colour
  and border changes that carry meaning.
