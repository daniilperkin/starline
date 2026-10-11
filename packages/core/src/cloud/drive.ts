/**
 * Drive REST client for cloud backup (slice 15, decision 23).
 *
 * Scope: the app's private `appDataFolder` only — the hidden, app-scoped area of the user's own
 * Drive. No other Drive surface is touched, and the client never sees a token: the caller injects
 * an `accessToken()` function, so the Android flow (Firebase + native picker) and the PWA flow
 * (Google Identity Services) share this file unchanged.
 *
 * Uploads are **resumable**, not simple: a snapshot of a library with attachments can exceed the
 * 5 MB a multipart upload allows, and a failed upload of a half-written snapshot would be worse
 * than a slow one. Two requests: create the session, then PUT the bytes.
 *
 * The fetch surface is declared structurally instead of borrowed from `lib.dom` — this package is
 * DOM-free on purpose, and the real `fetch` in a browser, a WebView and Node satisfies these
 * shapes without a cast.
 *
 * This file is on the no-network allowlist (scripts/check-no-network.mjs): it is the one place the
 * app may speak to the network, only to Google hosts, only in the cloud flavour.
 */

export const DRIVE_API = "https://www.googleapis.com/drive/v3";
export const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3/files";
export const DRIVE_APP_DATA_FOLDER = "appDataFolder";

export interface DriveFile {
  id: string;
  name: string;
  size?: number;
  modifiedTime?: string;
}

/** The slice of `fetch`'s response this client uses. */
export interface CloudFetchResponse {
  ok: boolean;
  status: number;
  statusText: string;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface CloudFetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
}

export type CloudFetch = (url: string, init?: CloudFetchInit) => Promise<CloudFetchResponse>;

export class DriveError extends Error {
  readonly status: number;
  readonly reason: string;

  constructor(status: number, reason: string, message: string) {
    super(message);
    this.name = "DriveError";
    this.status = status;
    this.reason = reason;
  }
}

export interface DriveClientOptions {
  /** Returns a fresh OAuth access token (scope `drive.appdata`); called per request. */
  accessToken: () => Promise<string>;
  /** The platform's fetch; injectable for tests. */
  fetchImpl?: CloudFetch;
}

async function errorFrom(response: CloudFetchResponse): Promise<DriveError> {
  let reason = "unknown";
  let message = `${response.status} ${response.statusText}`.trim();
  try {
    const body = (await response.json()) as {
      error?: { message?: string; errors?: Array<{ reason?: string }> };
    };
    if (body.error?.message) message = body.error.message;
    const first = body.error?.errors?.[0]?.reason;
    if (first) reason = first;
  } catch {
    // a non-JSON error body is still an error; the status carries the meaning
  }
  return new DriveError(response.status, reason, message);
}

function queryString(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
}

/** The platform fetch, read off globalThis so this module needs no DOM lib. */
function platformFetch(): CloudFetch | undefined {
  return (globalThis as { fetch?: CloudFetch }).fetch;
}

export class DriveClient {
  private readonly accessToken: () => Promise<string>;
  private readonly fetchImpl: CloudFetch;

  constructor(options: DriveClientOptions) {
    this.accessToken = options.accessToken;
    const injected = options.fetchImpl;
    this.fetchImpl =
      injected ??
      ((url, init) => {
        const native = platformFetch();
        if (!native) {
          throw new DriveError(0, "no_fetch", "this platform provides no fetch");
        }
        return native(url, init);
      });
  }

  private async request(url: string, init: CloudFetchInit = {}): Promise<CloudFetchResponse> {
    const token = await this.accessToken();
    const response = await this.fetchImpl(url, {
      ...init,
      headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw await errorFrom(response);
    return response;
  }

  /** Every snapshot file in the app folder, newest first. */
  async list(): Promise<DriveFile[]> {
    const files: DriveFile[] = [];
    let pageToken: string | undefined;
    do {
      const params: Record<string, string> = {
        spaces: DRIVE_APP_DATA_FOLDER,
        fields: "nextPageToken,files(id,name,size,modifiedTime)",
        pageSize: "1000",
        orderBy: "createdTime desc",
      };
      if (pageToken) params.pageToken = pageToken;
      const response = await this.request(`${DRIVE_API}/files?${queryString(params)}`);
      const body = (await response.json()) as { files?: DriveFile[]; nextPageToken?: string };
      for (const file of body.files ?? []) {
        files.push({ ...file, size: file.size === undefined ? undefined : Number(file.size) });
      }
      pageToken = body.nextPageToken;
    } while (pageToken);
    return files;
  }

  /**
   * Upload bytes as a new file in the app folder (resumable session, one PUT). Returns the file
   * resource, so the caller can record id/size in the manifest without a second lookup.
   */
  async upload(
    name: string,
    bytes: Uint8Array,
    options: { mimeType?: string } = {},
  ): Promise<DriveFile> {
    const mimeType = options.mimeType ?? "application/octet-stream";
    const session = await this.request(
      `${DRIVE_UPLOAD_API}?uploadType=resumable&fields=id,name,size`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Type": mimeType,
          "X-Upload-Content-Length": String(bytes.byteLength),
        },
        body: JSON.stringify({ name, parents: [DRIVE_APP_DATA_FOLDER] }),
      },
    );
    const location = session.headers.get("Location");
    if (!location) {
      throw new DriveError(session.status, "missing_session", "Drive did not return an upload URL");
    }
    const upload = await this.request(location, {
      method: "PUT",
      headers: { "Content-Type": mimeType },
      body: bytes,
    });
    const file = (await upload.json()) as DriveFile;
    return { ...file, size: file.size === undefined ? bytes.byteLength : Number(file.size) };
  }

  /** Download a file's bytes (used by preview and restore). */
  async download(fileId: string): Promise<Uint8Array> {
    const response = await this.request(
      `${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`,
    );
    return new Uint8Array(await response.arrayBuffer());
  }

  /** Delete a file — retention thinning and the explicit "delete from cloud" action. */
  async remove(fileId: string): Promise<void> {
    await this.request(`${DRIVE_API}/files/${encodeURIComponent(fileId)}`, { method: "DELETE" });
  }

  /**
   * Overwrite an existing file in place (the manifest has one stable name). A resumable PATCH
   * keeps the file id, so every reference to it survives the rewrite.
   */
  async replace(fileId: string, bytes: Uint8Array, mimeType = "application/json"): Promise<void> {
    const session = await this.request(
      `${DRIVE_UPLOAD_API}/${encodeURIComponent(fileId)}?uploadType=resumable`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Type": mimeType,
          "X-Upload-Content-Length": String(bytes.byteLength),
        },
        body: JSON.stringify({}),
      },
    );
    const location = session.headers.get("Location");
    if (!location) {
      throw new DriveError(session.status, "missing_session", "Drive did not return an upload URL");
    }
    await this.request(location, {
      method: "PUT",
      headers: { "Content-Type": mimeType },
      body: bytes,
    });
  }
}
