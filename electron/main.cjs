'use strict';

/**
 * Desktop shell for Design Warehouse.
 *
 * The renderer is the same build that `npm run build` produces; this process
 * only serves it, keeps the window's size between launches, and bridges the
 * native clipboard.
 */

const {
  app,
  BrowserWindow,
  Menu,
  clipboard,
  dialog,
  ipcMain,
  protocol,
  screen,
  shell,
} = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const googleAuth = require('./google-auth.cjs');

const APP_SCHEME = 'app';
const APP_HOST = 'design-warehouse';
const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;
const DIST = path.join(__dirname, '..', 'dist');
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL || '';

/**
 * Served over a custom scheme rather than file://.
 *
 * A file:// page gets an opaque origin, and Chromium refuses to open IndexedDB
 * on one — the catalog would fail to store anything at all. A scheme registered
 * as `standard` and `secure` gives a stable, trusted origin that persists
 * across launches and upgrades, which is exactly what the catalog needs.
 */
protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

// Everything the app needs is bundled; nothing is fetched from the network.
const CSP =
  "default-src 'self'; " +
  "script-src 'self'; " +
  "style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: blob:; " +
  "font-src 'self' data:; " +
  "connect-src 'self' data: blob: https://www.googleapis.com; " +
  // No script-src exception for Google here: the desktop build signs in through
  // the system browser, so it never loads Google's script into the page.
  "media-src 'self' blob:; " +
  "object-src 'none'; " +
  "base-uri 'none'; " +
  "form-action 'none'; " +
  "frame-ancestors 'none'";

function registerAppProtocol() {
  protocol.handle(APP_SCHEME, async (request) => {
    const { pathname } = new URL(request.url);
    const relative = decodeURIComponent(pathname).replace(/^\/+/, '') || 'index.html';
    const resolved = path.resolve(DIST, relative);

    // Refuse anything that escapes the bundle directory.
    if (resolved !== DIST && !resolved.startsWith(DIST + path.sep)) {
      return new Response('Forbidden', { status: 403 });
    }

    try {
      const body = await fsp.readFile(resolved);
      const headers = {
        'Content-Type': MIME_TYPES[path.extname(resolved).toLowerCase()] || 'application/octet-stream',
        'Content-Security-Policy': CSP,
      };
      return new Response(body, { status: 200, headers });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

// --- window bounds --------------------------------------------------------

const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');

const DEFAULT_BOUNDS = { width: 1360, height: 900 };

/**
 * Remembered bounds are only reused if they still land on a monitor that is
 * currently attached. Restoring a position from an unplugged second screen
 * opens the window somewhere the user cannot see or reach it.
 */
function isOnAnAttachedDisplay(state) {
  if (typeof state.x !== 'number' || typeof state.y !== 'number') return false;
  return screen.getAllDisplays().some(({ workArea }) => {
    const overlapX =
      Math.min(state.x + state.width, workArea.x + workArea.width) - Math.max(state.x, workArea.x);
    const overlapY =
      Math.min(state.y + state.height, workArea.y + workArea.height) -
      Math.max(state.y, workArea.y);
    // Insist on enough of the title bar being reachable to drag the window.
    return overlapX > 120 && overlapY > 40;
  });
}

function readWindowState() {
  try {
    const state = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    if (typeof state.width !== 'number' || typeof state.height !== 'number') {
      return DEFAULT_BOUNDS;
    }
    const bounds = {
      width: Math.max(480, state.width),
      height: Math.max(420, state.height),
      maximized: !!state.maximized,
    };
    // Let Electron centre the window when the old position is unusable.
    return isOnAnAttachedDisplay(state) ? { ...bounds, x: state.x, y: state.y } : bounds;
  } catch {
    // First launch, or the file was removed. Fall through to the defaults.
  }
  return DEFAULT_BOUNDS;
}

function saveWindowState(window) {
  if (!window || window.isDestroyed()) return;
  const bounds = window.isMaximized() ? window.getNormalBounds() : window.getBounds();
  try {
    fs.writeFileSync(
      stateFile(),
      JSON.stringify({ ...bounds, maximized: window.isMaximized() }),
    );
  } catch {
    // Losing the remembered size is not worth interrupting a quit for.
  }
}

// --- window ---------------------------------------------------------------

let mainWindow = null;

function sendMenuAction(action) {
  mainWindow?.webContents.send('menu-action', action);
}

function createWindow() {
  const state = readWindowState();

  mainWindow = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    minWidth: 480,
    minHeight: 420,
    show: false,
    backgroundColor: '#0b0d12',
    title: 'Design Warehouse',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });

  if (state.maximized) mainWindow.maximize();

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('close', () => saveWindowState(mainWindow));
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Links go to the user's browser; nothing navigates the app window away.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:$/.test(new URL(url).protocol)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed = DEV_SERVER_URL || APP_ORIGIN;
    if (!url.startsWith(allowed)) {
      event.preventDefault();
      if (/^https?:/.test(url)) void shell.openExternal(url);
    }
  });

  if (DEV_SERVER_URL) {
    void mainWindow.loadURL(DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    void mainWindow.loadURL(`${APP_ORIGIN}/index.html`);
  }
}

// --- menu -----------------------------------------------------------------

function buildMenu() {
  const template = [
    {
      label: '&File',
      submenu: [
        {
          // Deliberately not Ctrl+V: a custom accelerator on that key would be
          // consumed before the page sees it, breaking paste inside the spec
          // editor's text fields. Ctrl+V stays the Edit menu's native role,
          // which still delivers a clipboard image to the app's paste handler.
          label: 'Paste design from clipboard',
          accelerator: 'CommandOrControl+Shift+V',
          click: () => sendMenuAction('paste'),
        },
        { type: 'separator' },
        {
          label: 'Add images…',
          accelerator: 'CommandOrControl+O',
          click: () => sendMenuAction('add-files'),
        },
        {
          label: 'Add a folder…',
          accelerator: 'CommandOrControl+Shift+O',
          click: () => sendMenuAction('add-folder'),
        },
        { type: 'separator' },
        {
          label: 'Back up the catalog…',
          accelerator: 'CommandOrControl+S',
          click: () => sendMenuAction('backup'),
        },
        {
          label: 'Restore a backup…',
          click: () => sendMenuAction('restore'),
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: '&Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'delete' },
        { role: 'selectAll' },
        { type: 'separator' },
        {
          label: 'Find in catalog',
          accelerator: 'CommandOrControl+F',
          click: () => sendMenuAction('search'),
        },
      ],
    },
    {
      label: '&View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: '&Help',
      submenu: [
        {
          label: 'Where is my catalog stored?',
          click: () => {
            void dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'Catalog storage',
              message: 'Your designs are stored on this computer only.',
              detail:
                `Images and specs live in this folder:\n\n${app.getPath('userData')}\n\n` +
                'Nothing is uploaded anywhere. Use File → Back up the catalog to copy ' +
                'everything into a single file you can move to another machine.',
              buttons: ['Close', 'Open folder'],
              defaultId: 0,
            }).then(({ response }) => {
              if (response === 1) void shell.openPath(app.getPath('userData'));
            });
          },
        },
        {
          label: 'About Design Warehouse',
          click: () => {
            void dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'About Design Warehouse',
              message: `Design Warehouse ${app.getVersion()}`,
              detail:
                'A local-first catalog of design screenshots.\n\n' +
                `Electron ${process.versions.electron} · Chromium ${process.versions.chrome}`,
              buttons: ['Close'],
            });
          },
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// --- clipboard bridge -----------------------------------------------------

/**
 * The packaged app reads the clipboard through Electron rather than
 * `navigator.clipboard.read()`, which needs a permission grant and silently
 * returns nothing when the clipboard holds a bitmap put there by a screenshot
 * tool. `clipboard.readImage()` has neither problem.
 */
ipcMain.handle('clipboard:read-image', () => {
  const image = clipboard.readImage();
  if (image.isEmpty()) return null;
  const png = image.toPNG();
  return png.length > 0 ? png : null;
});

// --- google drive sync ----------------------------------------------------

/**
 * The client secret and refresh token stay in this process. The renderer can
 * ask for a short-lived access token and nothing more.
 */
ipcMain.handle('google:authorize', (_event, options) => googleAuth.authorize(options ?? {}));
ipcMain.handle('google:token', () => googleAuth.accessToken());
ipcMain.handle('google:disconnect', () => googleAuth.disconnect());
ipcMain.handle('google:status', () => googleAuth.status());
ipcMain.handle('google:cancel', () => googleAuth.cancel());
ipcMain.handle('google:set-credentials', (_event, options) =>
  googleAuth.setCredentials(options ?? {}),
);

// --- lifecycle ------------------------------------------------------------

if (!app.requestSingleInstanceLock()) {
  // A second copy would fight the first over the same IndexedDB files.
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.setAppUserModelId('com.designwarehouse.app');

  app.whenReady().then(() => {
    registerAppProtocol();

    // Nothing in this app needs the camera, microphone, or location.
    const allowed = new Set(['clipboard-sanitized-write']);
    app.on('web-contents-created', (_event, contents) => {
      contents.session.setPermissionRequestHandler((_wc, permission, callback) =>
        callback(allowed.has(permission)),
      );
      contents.session.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));
    });

    buildMenu();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
