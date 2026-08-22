# Design Warehouse

A catalog for design screenshots. Paste or drop a screenshot, and it is filed as a
vignette in a grid of equal tiles with a footer of design metadata — palette,
contrast, type scale, layout structure, effects — that Claude Code and Claude Design
can read back when building a prototype.

Everything runs in the browser. Images and specs live in IndexedDB on the machine you
use; nothing is uploaded anywhere and there is no server to run.

## Running it

[**The hosted app**](https://fernandodelrio-tech.github.io/Design-Warehouse/) — nothing
to install, and it works the same on a phone, a tablet or a laptop. Or from source:

```bash
npm install
npm run dev         # hot reload on http://localhost:5173
npm run build       # emits dist/
npm run preview     # serves dist/ locally
```

`dist/` is a plain static bundle with relative asset paths, so it works from a
repository subpath and can be dropped on any static host.

Each browser you open it in stores its own catalog. Connect them to Google Drive
(below) and they share one; leave it switched off and nothing ever leaves the
machine. Either way there is no server in the middle — the app talks to your Drive
as you, or to nothing at all.

## Publishing it

`Deploy web app` publishes the built app to GitHub Pages on every push to the default
branch, and can be run by hand from the Actions tab.

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

## Look and feel

The app wears **Ochre Broadsheet**, a design catalogued in the app itself and then
applied back to it. Its measurements drive the interface directly:

| | |
| --- | --- |
| **Colour** | Eight measured tokens, exact — ground `#faf0e6`, panel `#ece4da`, ink `#171616`, slate `#a7c5d7`, fire `#e77843`, rule `#708188`, lime `#bff365`, umber `#47413c` |
| **Spacing** | 4 · 8 · 12 · 16 · 24 · 32 · 48 · 64, and nothing in between |
| **Type scale** | 12 · 14 · 16 · 20 · 24 · 32, sharing four steps with the spacing scale so both land on one grid |
| **Corners** | Zero, everywhere |
| **Faces** | Fraunces for the wordmark and headings, Newsreader for anything you read, Archivo Narrow for every control and label |

The accent measures **2.61:1** on the page ground, which fails at every size, so it is
never type on the page: it is a fill, and buttons, chips and the account mark are ink
knocked out of it at 6.16:1. Interaction states the design never had — a hover, a third
text level, a destructive colour — are derived from the measured tokens with
`color-mix` rather than invented, and each one says in the stylesheet what it measures
against the surface it sits on.

**The night edition.** The design measured a light scheme, so light *is* the design and
the dark toggle is the one part of the skin that is not. Rather than invent eight dark
values it re-casts the same measured tokens around the ink ground — ink becomes the
page, ground becomes the type, umber becomes the panel — and derives only the two levels
ink leaves no room for.

Every text pair in both themes is checked against its WCAG threshold by walking the real
DOM, across the empty state, the catalog, the detail drawer and the sync panel.

The three faces are self-hosted from `src/styles/fonts/` — 126 KB of latin-subset woff2,
seven static instances. The app has to work with the network switched off, and opening it
should not tell a font CDN that you did.

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
the same name, with no model call, so it works offline.

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

Every tile is the same height, whatever shape the screenshot is, so the footers line
up across a row and can be read down the page. A screenshot taller than its tile is
cropped from the top — the part that identifies it — and marked *Full length on
open*; opening it shows the whole thing, scrolling if it is long. **Size** sets how
wide the tiles are, and the tile height follows from it.

The layout adapts down to a phone: the catalog drops to one tile per row, the filter
bar becomes a single scrolling strip, and the detail and sync panels take the whole
screen. Card actions that appear on hover with a mouse are simply always visible on
a touch screen.

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

- **Copy prompt for Claude** — the spec wrapped in instructions for *applying* it to
  something. Paste it into Claude Code or Claude Design and say what the target is —
  your app, a page, a component, a deck. The prompt opens with a line to replace:

  ```
  ## Apply it to

  > **[ REPLACE THIS LINE — what should this design be applied to? ]**
  ```

  Naming the target in your own message works just as well; the prompt says to use
  that and ignore the placeholder, and to ask rather than guess if neither is there.

  The rest of it is the part worth having. It establishes that a catalogued design is
  a visual *language* and not a page to reproduce — the screenshot's own content is
  explicitly out of scope — then says to restyle rather than re-architect, to redefine
  the target's existing tokens rather than bolt a second system alongside them, to
  derive the states a screenshot never had (hover, focus, disabled, a second theme) by
  mixing the measured colours rather than inventing new ones, and to keep a measured
  hex even where its contrast fails while never using that pair for text.

- **Spec** — the same spec as plain markdown
- **JSON** — a design-token document (color, typography, layout, effects, plus the
  measured layout figures)
- **CSS** — `:root` custom properties for the tokens, type scale and spacing scale
- **.md / Image** — download the spec or the original screenshot

Select several cards to copy or download one document covering all of them — useful
for seeding a whole project with a reference set. That export carries the same framing:
these are languages to apply to something, not pages to rebuild.

## Signing in, and sharing a catalog across devices

Sign in with Google and this catalog becomes yours: it is kept in step with a
**Design Warehouse** folder in your own Drive, so every browser you sign in from
shows the same designs. Sign-in is optional — without it the app works exactly as
before, storing everything locally and syncing nothing.

### Each person gets their own catalog

Signing in opens a catalog belonging to that Google account, keyed on the account's
permanent Google id rather than its email address. Two people using the same
computer or the same browser profile see only their own designs; switching accounts
swaps the whole catalog, and neither can reach the other's. Anything catalogued
before you signed in stays in a signed-out catalog, and the sync panel offers to move
it into your account the first time.

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

**When it syncs.** On launch, and a couple of seconds after any catalog event —
adding, editing, favouriting, re-analysing, restoring or deleting a design. A burst
is coalesced into one sync, and leaving the tab pushes immediately rather than
waiting out the delay, which matters on a phone where the page may be frozen before
the timer runs. Turn **Automatic sync** off in the sync panel to leave it entirely to
the **Sync now** button.

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

There is no server, so the app signs in as you, and that needs a **Web application**
OAuth client from your own Google Cloud project. It is free.

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
   **Application home page** and an **Application privacy policy link** — optional while
   in Testing, required to publish. This path is confirmed to work end to end:

   1. Enable Pages and let `Deploy web app` publish the site, so the URLs below resolve.
   2. In [Search Console](https://search.google.com/search-console), add a **URL prefix**
      property for `https://fernandodelrio-tech.github.io/Design-Warehouse/` and verify by
      the **HTML tag** method. The token lives in `index.html`; replace it with whichever
      one Search Console shows you and redeploy before verifying. DNS verification cannot
      be used — `github.io` is GitHub's domain, so there is no zone to add a TXT record to.
   3. Back on Branding, set:

      ```
      Application home page:         https://fernandodelrio-tech.github.io/Design-Warehouse/
      Application privacy policy:    https://fernandodelrio-tech.github.io/Design-Warehouse/privacy.html
      ```

   4. Under **Authorized domains**, add the bare host `fernandodelrio-tech.github.io` —
      no scheme, no path, no trailing slash. A red *Missing domain* notice before this
      step is normal; it means the URLs reference a domain not yet registered, not that
      the domain was refused. A verified `github.io` host is accepted.
   5. Save, then **Audience → Publish app**.

   Staying in *Testing* skips all of this, at the cost of Google expiring the sign-in
   every 7 days. After publishing, sign out and back in once: a grant issued while in
   Testing keeps its 7-day clock, and only a fresh one is long-lived.

   > When redeploying the site, use **Run workflow** on the branch rather than **Re-run**
   > on an old run. A re-run rebuilds that old commit and republishes it, which can
   > silently overwrite a newer deploy — that is what breaks verification most often.

4. Under *APIs & Services → Credentials*, choose *Create credentials → OAuth client
   ID → **Web application***. Add your Pages URL (and `http://localhost:5173` for
   development) as an authorized JavaScript origin. There is no client secret to
   handle and no redirect URI to configure — the browser flow uses neither. Copy the
   client ID.
5. Open the cloud button in the app, paste the client ID, and press **Sign in with
   Google**.

   **Tick the Drive box.** Google asks for each permission separately and the Drive
   one is not ticked by default, so it is easy to approve identity alone. Sign-in then
   succeeds and the first sync fails on *insufficient authentication scopes*. The app
   now catches a short grant at sign-in and says so; if you see it, sign in again and
   allow the app to see and manage the files it creates in your Drive.

Open the app on another device with the same Google account, paste the same client
ID, and the two catalogs converge on the next sync. Someone else using the app needs
their own client ID, in their own Google Cloud project.

### What this does and does not protect

There is no Google credential at rest anywhere: the access token is a variable in
memory, so it is gone when the tab closes, and the browser flow issues no refresh
token and needs no client secret. The app runs under a content security policy with
no inline scripts, and the only outbound connections it permits are to Google, and
only if you sign in. Nothing else the app does touches the network, including the
account avatar, which is drawn locally rather than fetched from Google.

Your designs, though, are stored **unencrypted** in the browser's storage. The
separation between accounts keeps catalogs apart *in the app*; it is not a security
boundary. Anyone who can use that browser profile can read any catalog in it by
inspecting storage directly. On a machine only you use, that is the same exposure as
any other local file. On a shared one, separate operating system accounts or browser
profiles are the real answer — no app-level scheme beats them.

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

The catalog lives in the browser profile you use, and each profile has its own.
**⬇** in the header writes a single JSON file with the images inlined; **⬆** restores
one — that file is how a catalog moves between machines. The app also
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
    auth.ts        signing in with Google Identity Services
    types.ts       the narrow interface the engine is written against
    spec.ts        markdown / prompt / token-JSON / CSS exporters
    db.ts          IndexedDB: metadata and blobs in separate stores
    ingest.ts      clipboard, file, folder and drag-drop intake
    transfer.ts    clipboard writes, downloads, catalog backup and restore
  components/      the shell, catalog grid, card, and spec editor
  hooks/           object-URL management for thumbnails and full images
```
