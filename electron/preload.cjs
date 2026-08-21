'use strict';

/**
 * The only bridge between the renderer and Node. Context isolation is on and
 * the renderer stays sandboxed, so this exposes two narrow, typed calls rather
 * than any part of Electron itself.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('designWarehouse', {
  isDesktop: true,
  version: process.versions.electron,

  /** Returns PNG bytes for a bitmap on the clipboard, or null if there isn't one. */
  async readClipboardImage() {
    const bytes = await ipcRenderer.invoke('clipboard:read-image');
    // Copied into a plain ArrayBuffer: a Buffer is a view onto a shared pool,
    // and only the exact bytes should cross the context bridge.
    return bytes ? new Uint8Array(bytes).buffer : null;
  },

  /**
   * Google Drive sign-in. The consent flow, the client secret and the refresh
   * token all live in the main process; this only ever returns a short-lived
   * access token.
   */
  google: {
    authorize: (options) => ipcRenderer.invoke('google:authorize', options),
    token: () => ipcRenderer.invoke('google:token'),
    disconnect: () => ipcRenderer.invoke('google:disconnect'),
    status: () => ipcRenderer.invoke('google:status'),
    cancel: () => ipcRenderer.invoke('google:cancel'),
  },

  /** Subscribe to the application menu. Returns an unsubscribe function. */
  onMenuAction(handler) {
    const listener = (_event, action) => handler(action);
    ipcRenderer.on('menu-action', listener);
    return () => ipcRenderer.off('menu-action', listener);
  },
});
