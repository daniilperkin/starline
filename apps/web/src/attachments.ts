/**
 * Browser-side attachment plumbing (PLAN slice 14): turn a picked/pasted/dropped `File` into an
 * attachment row, and turn an attachment row back into something an <img> can show.
 *
 * Everything here stays on-device: bytes go straight from the File into the library, the SHA-256
 * comes from WebCrypto and the thumbnail from a canvas. Nothing is ever uploaded (spec §5.2).
 */
import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_MIMES,
  ATTACHMENT_THUMB_PX,
  attachmentKind,
  createAttachment,
  messages,
  readAttachmentBytes,
  readAttachmentThumb,
  sha256Hex,
  type UUID,
} from "@starline/core";
import type { TauriStorageDriver } from "@starline/driver-wasm";
import { useEffect, useState } from "react";
import { runCommand } from "./data";

export interface IngestOutcome {
  attachmentId: UUID;
  deduped: boolean;
}

export class AttachmentError extends Error {}

function assertSupported(file: File): void {
  if (!(ATTACHMENT_MIMES as readonly string[]).includes(file.type)) {
    throw new AttachmentError(messages.attachments.unsupported.replace("{name}", file.name));
  }
  if (file.size === 0 || file.size > ATTACHMENT_MAX_BYTES) {
    throw new AttachmentError(messages.attachments.tooLarge.replace("{name}", file.name));
  }
}

/** 256 px WebP, drawn on a canvas — the only image processing the app does. */
async function makeThumb(bitmap: ImageBitmap): Promise<Uint8Array | null> {
  const scale = Math.min(1, ATTACHMENT_THUMB_PX / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (context === null) return null;
  context.drawImage(bitmap, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((result) => resolve(result), "image/webp", 0.8);
  });
  if (blob === null) return null;
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Stores one file as an attachment. Images get their pixel size and a thumbnail; PDFs get neither
 * (there is no PDF renderer in the bundle by design) and are shown as a glyph tile instead.
 */
export async function ingestAttachment(
  driver: TauriStorageDriver,
  projectId: UUID,
  file: File,
): Promise<IngestOutcome> {
  assertSupported(file);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const sha256 = await sha256Hex(bytes);
  const kind = attachmentKind(file.type);
  let width: number | null = null;
  let height: number | null = null;
  let thumb: Uint8Array | null = null;
  if (kind === "image") {
    try {
      const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: file.type }));
      width = bitmap.width;
      height = bitmap.height;
      thumb = await makeThumb(bitmap);
      bitmap.close();
    } catch {
      // A file that claims to be an image but cannot be decoded is still stored — the tile
      // falls back to a glyph, exactly like a PDF.
      width = null;
      height = null;
      thumb = null;
    }
  }
  const result = await runCommand(driver, createAttachment, {
    projectId,
    fileName: file.name || "attachment",
    mimeType: file.type,
    bytes,
    sha256,
    width,
    height,
    thumb,
  });
  return { attachmentId: result.attachmentId, deduped: result.deduped };
}

/** Ingest every file of a picker/paste/drop, reporting the first failure by name. */
export async function ingestFiles(
  driver: TauriStorageDriver,
  projectId: UUID,
  files: readonly File[],
): Promise<IngestOutcome[]> {
  const outcomes: IngestOutcome[] = [];
  for (const file of files) {
    outcomes.push(await ingestAttachment(driver, projectId, file));
  }
  return outcomes;
}

const urlCache = new Map<string, string>();

function cacheKey(attachmentId: string, thumb: boolean): string {
  return `${thumb ? "t" : "f"}:${attachmentId}`;
}

/**
 * An object URL for one attachment (thumbnail or full bytes). Cached per session: galleries
 * redraw on every invalidation and re-reading a blob for each tile would be wasteful.
 */
export async function attachmentUrl(
  driver: TauriStorageDriver,
  attachmentId: UUID,
  options: { thumb?: boolean } = {},
): Promise<string | null> {
  const key = cacheKey(attachmentId, options.thumb === true);
  const cached = urlCache.get(key);
  if (cached !== undefined) return cached;
  const bytes =
    options.thumb === true
      ? await readAttachmentThumb(driver, attachmentId)
      : await readAttachmentBytes(driver, attachmentId);
  if (bytes === null || bytes.byteLength === 0) return null;
  const url = URL.createObjectURL(new Blob([bytes as BlobPart]));
  urlCache.set(key, url);
  return url;
}

/** Drops every cached URL — the library is closing, or the file underneath changed. */
export function clearAttachmentUrls(): void {
  for (const url of urlCache.values()) URL.revokeObjectURL(url);
  urlCache.clear();
}

export function useAttachmentUrl(
  driver: TauriStorageDriver | null,
  attachmentId: UUID | null,
  options: { thumb?: boolean } = {},
): string | null {
  const [url, setUrl] = useState<string | null>(null);
  const thumb = options.thumb === true;
  useEffect(() => {
    let alive = true;
    if (driver === null || attachmentId === null) {
      setUrl(null);
      return;
    }
    void attachmentUrl(driver, attachmentId, { thumb }).then((next) => {
      if (alive) setUrl(next);
    });
    return () => {
      alive = false;
    };
  }, [driver, attachmentId, thumb]);
  return url;
}

/** Human-readable file size for tiles and the viewer. */
export function formatBytes(bytes: number): string {
  return messages.attachments.size.replace("{kb}", String(Math.max(1, Math.round(bytes / 1024))));
}
