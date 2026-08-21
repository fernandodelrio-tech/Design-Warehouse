import type { DesignRecord } from '../types';
import type { RemoteEntry, RemoteKind, RemoteStore } from './types';

/**
 * Google Drive as the shared folder.
 *
 * Files are flat and one-per-thing — `record-<id>.json`, `image-<id>`,
 * `tombstone-<id>.json` — rather than a single catalog file. Two devices
 * syncing at once therefore touch different objects instead of racing to
 * overwrite one manifest.
 *
 * The scope used is `drive.file`, which only grants access to files this app
 * itself created. It cannot read anything else in the Drive.
 */

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
/** Identity as well as Drive: the app needs to know whose catalog this is. */
export const AUTH_SCOPES = `openid email profile ${DRIVE_SCOPE}`;
export const FOLDER_NAME = 'Design Warehouse';

const FOLDER_MIME = 'application/vnd.google-apps.folder';

export class DriveError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'DriveError';
  }
}

/** Supplies a valid access token, refreshing it when the old one has expired. */
export type TokenSource = () => Promise<string>;

async function call(
  token: TokenSource,
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${await token()}`);
  const response = await fetch(url, { ...init, headers });

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = await response.json();
      detail = body?.error?.message ?? detail;
    } catch {
      // Not a JSON error body; the status text will have to do.
    }
    if (/insufficient authentication scopes/i.test(detail)) {
      throw new DriveError(
        'Google Drive access was not granted to this sign-in. Sign out, sign in again, ' +
          'and make sure the Drive tick box on the consent screen is ticked.',
        response.status,
      );
    }
    if (response.status === 401 || response.status === 403) {
      throw new DriveError(`Google Drive refused the request: ${detail}`, response.status);
    }
    throw new DriveError(`Google Drive error: ${detail}`, response.status);
  }
  return response;
}

interface DriveFile {
  id: string;
  name: string;
  appProperties?: Record<string, string>;
}

/** Finds the catalog folder, creating it the first time. */
export async function ensureFolder(token: TokenSource): Promise<string> {
  const query = encodeURIComponent(
    `name='${FOLDER_NAME}' and mimeType='${FOLDER_MIME}' and trashed=false`,
  );
  const found = await call(token, `${API}/files?q=${query}&fields=files(id)&pageSize=10`);
  const { files } = (await found.json()) as { files: DriveFile[] };
  if (files.length > 0) return files[0].id;

  const created = await call(token, `${API}/files?fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: FOLDER_MIME }),
  });
  return ((await created.json()) as DriveFile).id;
}

function nameFor(kind: RemoteKind, designId: string): string {
  return kind === 'image' ? `image-${designId}` : `${kind}-${designId}.json`;
}

function multipart(metadata: unknown, body: Blob, contentType: string): { body: Blob; type: string } {
  const boundary = `dw-${Math.random().toString(36).slice(2)}-${body.size}`;
  const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(
    metadata,
  )}\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`;
  return {
    body: new Blob([head, body, `\r\n--${boundary}--`]),
    type: `multipart/related; boundary=${boundary}`,
  };
}

export function createDriveStore(token: TokenSource, folderId: string): RemoteStore {
  const upload = async (
    entry: Omit<RemoteEntry, 'fileId'>,
    body: Blob,
    contentType: string,
  ): Promise<void> => {
    const metadata = {
      name: nameFor(entry.kind, entry.designId),
      parents: [folderId],
      // The stamp rides on the file so a sync can decide what changed from the
      // listing alone, without downloading anything.
      appProperties: {
        dwId: entry.designId,
        dwKind: entry.kind,
        dwStamp: String(entry.stamp),
      },
    };
    const part = multipart(metadata, body, contentType);
    await call(token, `${UPLOAD}/files?uploadType=multipart&fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': part.type },
      body: part.body,
    });
  };

  return {
    async list(): Promise<RemoteEntry[]> {
      const entries: RemoteEntry[] = [];
      let pageToken: string | undefined;
      const query = encodeURIComponent(`'${folderId}' in parents and trashed=false`);

      do {
        const url =
          `${API}/files?q=${query}&pageSize=1000` +
          `&fields=nextPageToken,files(id,name,appProperties)` +
          (pageToken ? `&pageToken=${pageToken}` : '');
        const response = await call(token, url);
        const page = (await response.json()) as { files: DriveFile[]; nextPageToken?: string };

        for (const file of page.files) {
          const props = file.appProperties;
          // Anything without our properties was not written by this app's sync.
          if (!props?.dwId || !props.dwKind) continue;
          entries.push({
            fileId: file.id,
            designId: props.dwId,
            kind: props.dwKind as RemoteKind,
            stamp: Number(props.dwStamp) || 0,
          });
        }
        pageToken = page.nextPageToken;
      } while (pageToken);

      return entries;
    },

    async readRecord(fileId) {
      const response = await call(token, `${API}/files/${fileId}?alt=media`);
      return (await response.json()) as DesignRecord;
    },

    async readImage(fileId) {
      const response = await call(token, `${API}/files/${fileId}?alt=media`);
      return response.blob();
    },

    async writeRecord(entry, record) {
      await upload(
        entry,
        new Blob([JSON.stringify(record)], { type: 'application/json' }),
        'application/json',
      );
    },

    async writeImage(entry, image) {
      await upload(entry, image, image.type || 'application/octet-stream');
    },

    async writeTombstone(entry) {
      await upload(
        entry,
        new Blob([JSON.stringify({ deletedAt: entry.stamp })], { type: 'application/json' }),
        'application/json',
      );
    },

    async remove(fileId) {
      await call(token, `${API}/files/${fileId}`, { method: 'DELETE' });
    },
  };
}
