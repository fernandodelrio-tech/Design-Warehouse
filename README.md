# Design Warehouse

A catalog for design screenshots. Paste or drop a screenshot, and it is filed as a
vignette in a photo-album grid with a footer of design metadata — palette, contrast,
type scale, layout structure, effects — that Claude Code and Claude Design can read
back when building a prototype.

Everything runs in the browser. Images and specs live in IndexedDB on the machine
you use; nothing is uploaded anywhere and there is no server to run.

## Running it

```bash
npm install
npm run dev      # http://localhost:5173
```

For a production build:

```bash
npm run build    # emits dist/
npm run preview  # serves dist/ locally
```

`dist/` is a plain static bundle with relative asset paths, so it can be dropped on
any static host or opened through a local file server.

## Getting designs in

| Method | How |
| --- | --- |
| Clipboard | Press <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>V</kbd> anywhere in the app, or use the **Paste** button |
| Files | **Files** button — pick one or many images |
| Folder | **Folder** button, or drag a directory onto the window; subfolders are walked |
| Drag & drop | Drop images or folders anywhere on the page |

PNG, JPEG, WebP, GIF, AVIF, BMP and SVG are accepted. Non-images in a folder are
skipped and reported rather than failing the import.

## What gets measured automatically

Every image is analysed on arrival, on a downsampled copy of the pixels:

- **Palette** — median-cut quantization into up to 8 colors, merged by perceptual
  distance, each with its share of the canvas and a guessed role (background,
  surface, text, accent, border, muted).
- **Contrast** — WCAG 2.1 ratios and ratings for the text/accent pairs against the
  background and surface colors.
- **Color scheme and saturation** — light, dark or mixed; muted, moderate or vivid.
- **Layout** — column count and gutter positions from vertical edge-energy troughs,
  section breaks from horizontal ones, content margins, and a density figure
  (how much of the canvas carries detail versus flat space).
- **Capture facts** — dimensions, aspect ratio, orientation, file size and type.

These are heuristics on pixels, labelled as measured or estimated in the output, and
every one of them is editable.

## What you fill in

Font families, weights and sizes cannot be read off a bitmap honestly, so the app
does not guess them — it leaves them blank and gives you a fast editor instead:

- Category, platform, style keywords, tags, source URL, notes
- Color tokens: rename, retype the hex, and describe where each one is used
- Type scale: family, base size, and a row per step (size / weight / leading / tracking)
- Layout: structure, columns, max width, gutter, spacing scale, radius, borders, breakpoints
- Components present, effects (shadows, gradients, blur, motion, iconography, imagery)
- Interactions, accessibility notes, and free-form replication notes for Claude

Empty fields are dropped from every export, so a short spec is always a fully
populated one.

## Getting designs out

From a card, hover and hit the copy icon. From the detail drawer:

- **Copy prompt for Claude** — the spec wrapped in a build instruction, ready to paste
  into Claude Code or Claude Design
- **Spec** — the same spec as plain markdown
- **JSON** — a design-token document (color, typography, layout, effects, plus the
  measured layout figures)
- **CSS** — `:root` custom properties for the tokens, type scale and spacing scale
- **.md / Image** — download the spec or the original screenshot

Select several cards to copy or download one document covering all of them — useful
for seeding a whole project with a reference set.

## Backups

The catalog lives in one browser profile. **⬇** in the header writes a single JSON
file with the images inlined; **⬆** restores one. The app also asks the browser for
persistent storage so the catalog is not evicted under storage pressure.

## Layout of the code

```
src/
  lib/
    types.ts       the data model: image facts, auto analysis, editable spec
    color.ts       hex/rgb/hsl, WCAG luminance and contrast, color naming
    palette.ts     median-cut quantization and color role assignment
    layout.ts      column, section, margin and density heuristics
    image.ts       decoding, thumbnailing, pixel sampling
    analyze.ts     orchestrates analysis and seeds a spec from it
    spec.ts        markdown / prompt / token-JSON / CSS exporters
    db.ts          IndexedDB: metadata and blobs in separate stores
    ingest.ts      clipboard, file, folder and drag-drop intake
    transfer.ts    clipboard writes, downloads, catalog backup and restore
  components/      the shell, masonry grid, card, and spec editor
  hooks/           object-URL management for thumbnails and full images
```
