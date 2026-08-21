/**
 * The desktop shell's bridge, when the app is running inside Electron.
 *
 * Every one of these is optional: the same build runs in a plain browser, where
 * `desktop` is null and the web equivalents are used instead.
 */

export type MenuAction =
  | 'paste'
  | 'add-files'
  | 'add-folder'
  | 'backup'
  | 'restore'
  | 'search';

export interface GoogleProfile {
  sub: string;
  email: string;
  name: string;
  picture: string;
}

export interface GoogleBridge {
  authorize(options: {
    clientId: string;
    clientSecret: string;
    scope: string;
  }): Promise<{ connected: boolean; profile?: GoogleProfile }>;
  token(): Promise<string | null>;
  disconnect(): Promise<{ connected: boolean }>;
  status(): Promise<{
    connected: boolean;
    clientId: string;
    profile: GoogleProfile | null;
    tokenEncrypted: boolean;
  }>;
  cancel(): Promise<{ cancelled: boolean }>;
}

export interface DesktopBridge {
  isDesktop: true;
  version: string;
  readClipboardImage(): Promise<ArrayBuffer | null>;
  google: GoogleBridge;
  onMenuAction(handler: (action: MenuAction) => void): () => void;
}

declare global {
  interface Window {
    designWarehouse?: DesktopBridge;
  }
}

export const desktop: DesktopBridge | null =
  typeof window !== 'undefined' && window.designWarehouse ? window.designWarehouse : null;

export const isDesktop = desktop !== null;

/** The clipboard bitmap as a PNG blob, or null when the clipboard has no image. */
export async function readDesktopClipboardImage(): Promise<Blob | null> {
  if (!desktop) return null;
  const bytes = await desktop.readClipboardImage();
  return bytes ? new Blob([bytes], { type: 'image/png' }) : null;
}

export function onMenuAction(handler: (action: MenuAction) => void): () => void {
  return desktop ? desktop.onMenuAction(handler) : () => {};
}
