import type { EpochMs, OrderKey, UUID } from "../primitives";

/**
 * Attachments (spec §3.1 `Attachment`, PLAN slice 14): images and PDFs that live inside the
 * library file itself. Bytes are split into `attachment_blob` so listing a gallery never reads
 * them; identity is the SHA-256, so pasting the same picture twice reuses one row.
 */

export const ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024; // the CHECK in the schema, verbatim
export const ATTACHMENT_THUMB_PX = 256;

export const ATTACHMENT_IMAGE_MIMES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;

export const ATTACHMENT_MIMES = [...ATTACHMENT_IMAGE_MIMES, "application/pdf"] as const;
export type AttachmentMime = (typeof ATTACHMENT_MIMES)[number];

export type AttachmentKind = "image" | "pdf";

export function attachmentKind(mimeType: string): AttachmentKind | null {
  if ((ATTACHMENT_IMAGE_MIMES as readonly string[]).includes(mimeType)) return "image";
  if (mimeType === "application/pdf") return "pdf";
  return null;
}

export function attachmentExtension(fileName: string, mimeType: string): string {
  const fromName = fileName.includes(".") ? fileName.split(".").pop()?.toLowerCase() : null;
  if (fromName && /^[a-z0-9]{1,5}$/.test(fromName)) return fromName;
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/gif") return "gif";
  if (mimeType === "application/pdf") return "pdf";
  return "bin";
}

/** Metadata only — galleries and pickers never carry bytes (that is what `attachment_blob` is for). */
export interface AttachmentSummary {
  id: UUID;
  projectId: UUID;
  fileName: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  width: number | null;
  height: number | null;
  hasThumb: boolean;
  createdAt: EpochMs;
}

export interface GalleryItem extends AttachmentSummary {
  caption: string;
  orderKey: OrderKey;
}

/** The single-image slots the schema gives entities (scene has none — spec §3.3). */
export const IMAGE_SLOT_TARGETS = ["project", "character", "lore_entry"] as const;
export type ImageSlotTarget = (typeof IMAGE_SLOT_TARGETS)[number];
