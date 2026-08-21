# Design Warehouse

A catalog for design screenshots. Paste or drop a screenshot, and it is filed as a
vignette in a photo-album grid with a footer of design metadata — palette, contrast,
type scale, layout structure, effects — that Claude Code and Claude Design can read
back when building a prototype.

Everything runs in the browser. Images and specs live in IndexedDB on the machine
you use; nothing is uploaded anywhere and there is no server to run.

## Installing it

### Windows

Get **`Design Warehouse <version> Setup.exe`** and run it. It is built by the
`Build desktop installer` workflow, and there are two places to get it:

- **From a release** — the [Releases page](../../releases), once a `v*` tag has been
  pushed. `git tag v0.1.0 && git push origin v0.1.0` builds the installer and attaches
  it to a new release.
- **From a build** — the [Actions tab](../../actions/workflows/build-desktop.yml):
  open the most recent run and download the `design-warehouse-windows` artifact. This
  works with no tag, and is the quickest way to get an installer right now. Artifacts
  are a zip and expire after 30 days.

One installer covers both x64 and ARM64 machines. It installs per-user, so Windows
never asks for an administrator password and the catalog stays with the account that
created it; you can choose the folder, and it adds Start menu and desktop shortcuts.
A **Portable** `.exe` is built alongside it if you would rather run it from a USB
stick without installing — note that a portable copy still keeps its catalog in your
Windows user profile, not next to the executable.

To uninstall: Settings → Apps → Design Warehouse. Your catalog is deliberately left
in place, so reinstalling picks up where you left off. Back it up first
(**File → Back up the catalog…**) if you want it gone or moved.

### macOS and Linux

Run it from source — there is no signed macOS build, and an unsigned one would be
quarantined by Gatekeeper:

```bash
npm install
npm run desktop     # builds, then opens the desktop window
```

Or use it as a plain web app in any browser:

```bash
npm run dev         # http://localhost:5173
```

A Linux AppImage can be produced locally with `npm run dist:linux`.

## Building the Windows installer yourself

On Windows:

```bash
npm ci
npm run dist:win    # writes release/Design Warehouse <version> Setup.exe
```

NSIS packaging needs a Windows toolchain, so this does not cross-compile from macOS
or Linux. The repository's `Build desktop installer` workflow runs it on a
`windows-latest` runner instead: trigger it by hand from the Actions tab, or push a
`v*` tag to build and attach the installer to a release.

The installer is unsigned. Windows SmartScreen will show a "Windows protected your
PC" warning on first run — *More info* → *Run anyway*. Signing it needs a code
signing certificate; once you have one, set `CSC_LINK` and `CSC_KEY_PASSWORD` as
repository secrets and pass them to the packaging step.

## Running from source

```bash
npm install
npm run dev         # web app with hot reload
npm run desktop:dev # desktop window against the dev server, with hot reload
npm run build       # emits dist/
npm run preview     # serves dist/ locally
```

`dist/` is a plain static bundle with relative asset paths, so it can also be dropped
on any static host.

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

The catalog lives in one place on one machine: a browser profile on the web, or your
user profile in the desktop app (**Help → Where is my catalog stored?** opens the
exact folder). **⬇** in the header writes a single JSON file with the images inlined;
**⬆** restores one — that file is how a catalog moves between machines. The app also
asks for persistent storage so the catalog is not evicted under storage pressure.

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
    desktop.ts     the Electron bridge, absent and unused in a browser
  components/      the shell, masonry grid, card, and spec editor
  hooks/           object-URL management for thumbnails and full images
electron/
  main.cjs         desktop shell: app:// protocol, window state, menu, clipboard
  preload.cjs      the two calls exposed to the renderer
scripts/
  make-icons.mjs   regenerates build/icon.ico and build/icon.png
  desktop-dev.mjs  runs the shell against the Vite dev server
```

## Notes on the desktop build

The renderer is the same bundle the web build produces. The shell adds four things:

- It serves the app over an `app://` scheme registered as standard and secure.
  A `file://` page gets an opaque origin and Chromium refuses to open IndexedDB on
  one, which would leave the catalog unable to store anything.
- **Paste** reads the clipboard through Electron rather than `navigator.clipboard`,
  which needs a permission grant and misses bitmaps put there by screenshot tools.
  <kbd>Ctrl</kbd>+<kbd>V</kbd> remains the native paste, so it still works inside the
  spec editor's text fields; the menu item is <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>V</kbd>.
- The window remembers its size, position and maximised state between launches, and
  a second launch focuses the running window rather than opening a rival copy of the
  catalog.
- The renderer is sandboxed with context isolation on and node integration off, under
  a content security policy that permits no network access at all. The preload
  exposes exactly two functions.

