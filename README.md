# Design Warehouse

A catalog for design screenshots. Paste or drop a screenshot, and it is filed as a
vignette in a photo-album grid with a footer of design metadata — palette, contrast,
type scale, layout structure, effects — that Claude Code and Claude Design can read
back when building a prototype.

Everything runs in the browser. Images and specs live in IndexedDB on the machine
you use; nothing is uploaded anywhere and there is no server to run.

## Where you can run it

| | How to get it |
| --- | --- |
| **Web** | [The hosted app](https://fernandodelrio-tech.github.io/Design-Warehouse/) — nothing to install, works in any browser |
| **Windows** | The installer, below |
| **macOS / Linux** | From source, below |

Each of these stores its catalog locally, in that browser profile or that user
profile. Connect them to Google Drive (below) and they share one catalog; leave it
switched off and nothing ever leaves the machine. Either way there is no server in
the middle — the app talks to your Drive as you, or to nothing at all.

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

Open [the hosted app](https://fernandodelrio-tech.github.io/Design-Warehouse/) in a
browser, or run the desktop window from source — there is no signed macOS build, and
an unsigned one would be quarantined by Gatekeeper:

```bash
npm install
npm run desktop     # builds, then opens the desktop window
```

A Linux AppImage can be produced locally with `npm run dist:linux`.

## The hosted web app

`Deploy web app` publishes the built renderer to GitHub Pages on every push to the
default branch, and can be run by hand from the Actions tab.

**One-time setup:** open **Settings → Pages**, and under *Build and deployment* set
**Source** to **GitHub Actions**. The workflow tries to enable this itself, but the
token it runs with is usually not permitted to, in which case it fails with those
instructions in the run summary. Once the setting is on, re-run the workflow and the
app is live at:

```
https://fernandodelrio-tech.github.io/Design-Warehouse/
```

The repository is public, so that page is reachable by anyone with the link. Only the
app is published — every catalog lives in its own visitor's browser, so no designs
are exposed by it.

It is a static bundle with relative asset paths, so it works from a repository
subpath, and it can equally be dropped on any other static host. The app needs no
network once loaded — everything it does happens in the browser.

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

### How designs get named

A filename you chose is kept — `stripe-pricing-page.png` becomes *Stripe pricing
page*. A filename that says nothing — a clipboard paste, `IMG_4471.PNG`,
`Screenshot 2026-08-21 at 10.32.14.png`, `Untitled-1` — earns a name instead:

| The design | Named |
| --- | --- |
| Dark dashboard, red accent | **Ember Console** |
| Light landing page, blue accent | **Azure Overture** |
| Warm mobile screen, orange accent | **Copper Handheld** |
| Dark editor, teal accent | **Cypress Workbench** |
| Dark dashboard, no colour in it | **Basalt Observatory** |

The colour word comes from the accent's hue, the noun from the kind of screen, so
the name still tells you something — and the factual line under it on the card keeps
carrying the measurements. It is entirely deterministic: the same design always earns
the same name, with no model call, so it works offline and in the packaged app.

A second red dashboard becomes *Crimson Cockpit* rather than *Ember Console 2* —
names are drawn from the whole vocabulary before numbering is used at all. Every
title is editable in the detail drawer.

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

## Arranging the grid

Two controls in the filter bar, remembered between sessions.

**Sort by** — date added (newest, oldest), recently edited, name A–Z or Z–A,
category, style, light to dark, colour around the wheel, density sparse to dense,
capture size, or favourites first.

**Group by** — breaks the grid into labelled sections with counts: category, style
keyword, tag, month added, colour scheme, colour family, platform, density,
orientation, column count, or how it arrived. Sorting still applies inside each
section.

Grouping by tag or style keyword puts a design under *each* of the ones it carries,
which is what makes it useful for classifying; anything with none lands in a
remainder section at the end.

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

## Signing in, and sharing a catalog across devices

Sign in with Google and this catalog becomes yours: it is kept in step with a
**Design Warehouse** folder in your own Drive, so the web app and the desktop app
show the same designs. Sign-in is optional — without it the app works exactly as
before, storing everything locally and syncing nothing.

### Each person gets their own catalog

Signing in opens a catalog belonging to that Google account, keyed on the account's
permanent Google id rather than its email address. Two people using the same
computer, the same browser profile, or the same installed copy of the app see only
their own designs; switching accounts swaps the whole catalog, and neither can reach
the other's. Anything catalogued before you signed in stays in a signed-out catalog,
and the sync panel offers to move it into your account the first time.

### One OAuth client per person

Each person signs in with their own OAuth client ID. The app claims a client ID for
the account that first used it, and refuses to let a second account sign in with the
same one — you get told to create your own instead.

Worth knowing what that does and does not buy you. A Google client ID identifies an
*application*, not a person: normally everyone using an app shares one, and what
keeps users apart is the account they sign in as. That is what does the real work
here — the account decides which catalog opens and whose Drive is written to. The
client-ID rule is enforced per device, because without a server there is nowhere to
keep a registry, so two people on two machines could still pick the same one. It
would not let either read the other's designs.

**How it works.** Each design is stored as two files — its image and its spec — plus
a small marker for each deletion. There is no shared index file, so two devices
syncing at the same moment write different objects instead of racing over one.
Every record carries the time it was last edited, and where the same design was
edited in both places the more recent edit replaces the other. A deletion is
recorded rather than just applied, so it sticks instead of being pulled back from
the other device on the next sync.

The app asks for `openid email profile` to know which account you are, and
`drive.file` for storage — that one grants access only to files the app created
itself, and none at all to the rest of your Drive. Images upload once; editing a
spec afterwards only re-sends the small JSON file.

### One-time Google setup

There is no server, so the app signs in as you, and that needs an OAuth client from
your own Google Cloud project. It is free, and the two builds need different client
types.

1. At [console.cloud.google.com](https://console.cloud.google.com/), create a project
   (or pick one) and enable the **Google Drive API** under *APIs & Services →
   Library*.
2. Under *APIs & Services → OAuth consent screen*, choose **External**, fill in the
   app name and your email, and add the scopes `openid`, `email`, `profile` and
   `https://www.googleapis.com/auth/drive.file`. Add yourself as a test user.
   That scope is non-sensitive, so publishing the app needs no Google review — and
   publishing is worth doing, because grants issued while the app is still in
   *Testing* expire after a week.
3. To switch publishing status to **In production**, the Branding page also needs an
   **Application home page** and an **Application privacy policy link** — those two are
   optional while in Testing but required to publish. Once Pages is enabled they are:

   ```
   https://fernandodelrio-tech.github.io/Design-Warehouse/
   https://fernandodelrio-tech.github.io/Design-Warehouse/privacy.html
   ```

   Using them means adding `fernandodelrio-tech.github.io` under *Authorized domains*,
   which Google requires you to verify once in
   [Search Console](https://search.google.com/search-console). Staying in *Testing* skips
   all of this at the cost of reconnecting weekly.
4. Under *APIs & Services → Credentials*, create the client you need:
   - **For the desktop app** — *Create credentials → OAuth client ID → Desktop app*.
     Copy the client ID and client secret into the app's sync panel. Google issues a
     secret for desktop clients and documents it as not confidential; it is handed
     straight to the keychain and never read back, so the field appears empty
     afterwards.
   - **For the web app** — *Create credentials → OAuth client ID → Web application*.
     Add your Pages URL (and `http://localhost:5173` for development) as an
     authorized JavaScript origin. Copy the client ID into the sync panel.
5. Open the cloud button in either app, paste the client ID, and press **Sign in
   with Google**. The consent screen opens in your real browser, not an embedded
   window.

Do the same on the other device with the same Google account, and the two catalogs
converge on the next sync. Someone else using the app needs their own client ID from
step 3, in their own Google Cloud project.

### What this does and does not protect

Neither build keeps a Google credential where the page can reach it, by different
routes.

In the **desktop app**, the refresh token and the client secret live in your
operating system's keychain — DPAPI on Windows, Keychain on macOS, libsecret on
Linux — held by the process outside the page. The renderer receives short-lived
access tokens and nothing else; the secret field is write-only, which is why it shows
no value once one is set. On a system with no keyring available it falls back to a
permission-restricted file and the sync panel says so plainly rather than implying
protection it does not have.

In the **web app** there is no credential at rest at all: the access token is a
variable in memory, so it is gone when the tab closes and there is no refresh token
to store. Both builds run under the same content security policy — no inline scripts,
and the only outbound connections permitted are to Google, and only if you sign in.
Nothing else the app does touches the network, including the account avatar, which is
drawn locally rather than fetched from Google.

Your designs, though, are stored **unencrypted** in the browser's storage or your
user profile. The separation between accounts keeps catalogs apart *in the app*; it
is not a security boundary. Anyone who can use that browser profile or that computer
account can read any catalog on it by inspecting storage directly. On a machine only
you use, that is the same exposure as any other local file. On a shared one, separate
operating system accounts or browser profiles are the real answer — no app-level
scheme beats them.

If you want the local copy gone when you walk away, turn on **Delete this device's
copy when I sign out** in the sync panel. Anything unsynced is pushed to Drive first,
and sign-out is abandoned if that push fails, so the option can never be the thing
that loses a design. If the device has never synced at all, it warns before deleting
anything.

Designs in Drive are stored unencrypted too — readable by Google and by anyone with
access to that Google account. End-to-end encryption would change that, at the cost
of a passphrase on every device and a catalog that is unrecoverable if you forget it.

### If you would rather not use Drive

Leave sync switched off and use **⬇** / **⬆** in the header, which write and restore
a single backup file holding every design. That moves a catalog between machines by
hand, with nothing leaving them in between.

## Backups

The catalog lives in one place on one machine, and each way of running the app has
its own (see the table at the top): a browser profile on the web, or your user
profile in the desktop app (**Help → Where is my catalog stored?** opens the exact
folder). **⬇** in the header writes a single JSON file with the images inlined;
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
    title.ts       decides whether a filename is worth keeping as a title
    naming.ts      names a design when it is not — evocative, and deterministic
    grouping.ts    the sort and group-by options behind the grid controls
    accounts.ts    who is signed in, and which catalog is theirs
    session.ts     switching accounts: swap catalogs, adopt a signed-out one
  lib/sync/
    engine.ts      two-way reconciliation, last edit wins
    drive.ts       Google Drive as the shared folder
    auth.ts        signing in: loopback on the desktop, GIS in a browser
    types.ts       the narrow interface the engine is written against
    spec.ts        markdown / prompt / token-JSON / CSS exporters
    db.ts          IndexedDB: metadata and blobs in separate stores
    ingest.ts      clipboard, file, folder and drag-drop intake
    transfer.ts    clipboard writes, downloads, catalog backup and restore
    desktop.ts     the Electron bridge, absent and unused in a browser
  components/      the shell, masonry grid, card, and spec editor
  hooks/           object-URL management for thumbnails and full images
electron/
  main.cjs         desktop shell: app:// protocol, window state, menu, clipboard
  google-auth.cjs  the OAuth loopback flow, kept out of the renderer
  preload.cjs      the calls exposed to the renderer
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

