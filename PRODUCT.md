# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Fernando Del Rio, first. Design Warehouse is his own tooling, hosted publicly so
anyone can use it — but his workflow is what decides trade-offs, and an
ambiguity is resolved by what serves the way he works rather than by what a
general audience might prefer.

The situation it is used in: building something with Claude, wanting it to look
like a design already seen elsewhere, and having a screenshot of that design
rather than its source. The job is to turn that screenshot into something Claude
can build from.

## Product Purpose

Catalogue screenshots of designs, measure what can honestly be measured off the
pixels, and hand the result to Claude as a specification it can apply.

A screenshot goes in — pasted, dropped, or picked from a folder. The app
analyses it in the browser (palette and colour roles, WCAG contrast pairs,
colour scheme and saturation, column count, gutters, section breaks, margins,
density, and on a second near-native pass the corner radius, hairline width and
colour, elevation, and type-scale steps), files it as a tile, and seeds an
editable spec from what it found. The spec is what leaves: as a prompt written
for Claude, as markdown, as a token JSON document, as CSS custom properties, or
as a file.

Success is that the design Claude produces from the exported spec reads as the
catalogued design's language, applied to whatever was being built.

## Positioning

**A catalogued design is a visual language, applicable to any artifact — an
app, a deck, a document, a prototype — and not a page to reproduce.** The
screenshot's own content is explicitly out of scope of what gets applied. This
is the claim the product is built around, and it is what the exported prompt
spends most of its words establishing: restyle rather than re-architect,
redefine the target's existing tokens rather than bolt a second system beside
them, derive the states a still frame never had by mixing the measured colours
rather than inventing new ones.

The second half of the position is that the measurements are checkable.
Everything the analyzer reports is derived from pixels by stated methods, is
labelled as measured or estimated, and carries how many samples agreed.

## Operating Context

- Used alongside a Claude session that is already building something. The
  export is written to be pasted into that conversation, and defaults to
  applying itself to whatever the conversation is already working on rather
  than asking for a target.
- **Apply it to** names a different target when needed — "the admin dashboard
  in this repo", "a pitch deck" — and is remembered across designs and
  sessions, because a person restyles one project at a time.
- Screenshots arrive by clipboard paste, file picker, folder import, or
  drag-and-drop, including whole directory trees.
- Several designs can be selected and exported as one document, to seed a
  project with a reference set.
- The catalog is arranged by sort and group-by controls over measured and
  edited properties, and searched across titles, tags, hex values, fonts and
  components.

## Capabilities and Constraints

- Runs entirely in the browser. No backend. Metadata and image blobs live in
  IndexedDB, in separate stores so listing the catalog never pulls megabytes
  into memory.
- Optional Google Drive sync keeps a catalog in step across browsers, using a
  Web OAuth client the user creates in their own Google Cloud project — the app
  talks to the user's Drive as the user, with no server in the middle.
  Reconciliation is last-edit-wins over per-design timestamps, with tombstones
  so a deletion sticks.
- Accepts PNG, JPEG, WebP, GIF, AVIF, BMP and SVG. Non-images in an imported
  folder are skipped and reported rather than failing the import.
- Analysis runs in a Web Worker. The `<img>` decode path some formats need
  (chiefly SVG) has no worker equivalent, so those fall back to the page.
- Naming is deterministic and offline: a filename that says something is kept,
  one that says nothing earns a name from the measured accent hue and the kind
  of screen. No model call is involved.
- Deletion is staged — the record is kept locally for thirty days and can be
  undone — while the tombstone propagates immediately.
- Ships as a static bundle with relative asset paths, deployed to GitHub Pages
  by the `Deploy web app` workflow. Two runtime dependencies: React and
  React DOM.

### Not a capability

- **A desktop application does not exist**, and none is planned. The privacy
  policy used to describe storing designs "in your user profile in the desktop
  app" and holding the Google sign-in "in your operating system's keychain";
  both were stale and have been removed. Nothing in the repository or its
  history implements one.

### Considered and deliberately not binding

Three properties are strongly argued for in the codebase and in the README, and
were put to the author explicitly. None is a commitment — each is a current
implementation choice that later work may trade for something better, and none
should be defended as a rule:

- running entirely on the device with no server;
- leaving unmeasurable fields (font families, component inventories,
  interaction notes) blank rather than guessing them;
- reskinning the app with a design catalogued inside it.

## Brand Commitments

- Name: **Design Warehouse**. Author: Fernando Del Rio. MIT licensed, public
  repository.
- The exported prompt's framing is product substance rather than styling: it
  establishes the language-not-a-page position above, and names its own gaps
  plainly — absence means nobody wrote a value down, not that the design lacks
  one.

## Evidence on Hand

- `README.md` — a thorough account of intake, naming, what is measured and how,
  what the person fills in, arrangement, export, Drive setup, and backups.
- `public/privacy.html` — the privacy policy, and the only public statement
  about where a person's designs live. Behaviour that moves data, or delays its
  removal, has to be reflected there.
- Deployed at `https://fernandodelrio-tech.github.io/Design-Warehouse/`.
- `.impeccable/critique/` — a dated design critique and technical audit of the
  app, with heuristic and dimension scores.
- Ground-truth checks: the fine-detail measurements are validated against a
  canvas painted to a known radius, hairline, elevation and set of text sizes,
  then measured back.

**No testimonials, customers, usage figures, benchmarks, pricing or third-party
endorsements exist.** None should be written.

## Product Principles

1. **A design is a language, not a page.** Everything the product exports
   describes how something should look, never what it should say or contain,
   and it must land on an app, a deck, a document or a prototype equally.
2. **Every measurement declares how firmly it is known.** Measured is
   distinguishable from estimated from blank, sample counts are shown, and a
   contrast figure is reported as fact including where it fails. This is
   binding.
3. **Fernando's workflow breaks ties.** When a decision could go either way,
   the version that serves the way he actually works wins over the version that
   serves a hypothetical general user.
4. **Architecture is not a promise.** Local-first storage, the refusal to guess
   unmeasurable fields, and the self-catalogued skin are how the product works
   today, not what it owes anyone. Later work may replace any of them on merit
   without treating it as a betrayal.
