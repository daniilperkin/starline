import type { SqlValue } from "../commands";
import type { EpochMs, OrderKey, UUID } from "../primitives";
import type { AttachmentSummary, GalleryItem } from "./types";

/** The read-only statement surface a storage driver satisfies for queries. */
export interface AttachmentsQueryRunner {
  query<T = Record<string, unknown>>(sql: string, params?: readonly SqlValue[]): Promise<T[]>;
}

interface AttachmentRow {
  id: string;
  project_id: string;
  file_name: string;
  mime_type: string;
  byte_size: number;
  sha256: string;
  width: number | null;
  height: number | null;
  thumb: Uint8Array | null;
  created_at: number;
}

const ATTACHMENT_COLUMNS = `id, project_id, file_name, mime_type, byte_size, sha256,
                            width, height, thumb, created_at`;

function toSummary(row: AttachmentRow): AttachmentSummary {
  return {
    id: row.id as UUID,
    projectId: row.project_id as UUID,
    fileName: row.file_name,
    mimeType: row.mime_type,
    byteSize: row.byte_size,
    sha256: row.sha256,
    width: row.width,
    height: row.height,
    hasThumb: row.thumb !== null,
    createdAt: row.created_at as EpochMs,
  };
}

/** Metadata only — no blob column in the SELECT, so a gallery of 200 images stays cheap. */
export async function listProjectAttachments(
  runner: AttachmentsQueryRunner,
  projectId: UUID,
): Promise<AttachmentSummary[]> {
  const rows = await runner.query<AttachmentRow>(
    `SELECT ${ATTACHMENT_COLUMNS} FROM attachment WHERE project_id = ? ORDER BY created_at, id`,
    [projectId],
  );
  return rows.map(toSummary);
}

export async function getAttachment(
  runner: AttachmentsQueryRunner,
  projectId: UUID,
  attachmentId: UUID,
): Promise<AttachmentSummary | null> {
  const rows = await runner.query<AttachmentRow>(
    `SELECT ${ATTACHMENT_COLUMNS} FROM attachment WHERE id = ? AND project_id = ?`,
    [attachmentId, projectId],
  );
  const row = rows[0];
  return row ? toSummary(row) : null;
}

/** A character's gallery in order. Joins the metadata table only — bytes stay on disk. */
export async function listCharacterGallery(
  runner: AttachmentsQueryRunner,
  characterId: UUID,
): Promise<GalleryItem[]> {
  const rows = await runner.query<AttachmentRow & { caption: string; order_key: string }>(
    `SELECT a.id, a.project_id, a.file_name, a.mime_type, a.byte_size, a.sha256,
            a.width, a.height, a.thumb, a.created_at, g.caption, g.order_key
       FROM character_gallery g JOIN attachment a ON a.id = g.attachment_id
      WHERE g.character_id = ?
      ORDER BY g.order_key`,
    [characterId],
  );
  return rows.map((row) => ({
    ...toSummary(row),
    caption: row.caption,
    orderKey: row.order_key as OrderKey,
  }));
}

/** The 256 px WebP thumbnail, for grid tiles. Null when the attachment has none (PDFs). */
export async function readAttachmentThumb(
  runner: AttachmentsQueryRunner,
  attachmentId: UUID,
): Promise<Uint8Array | null> {
  const rows = await runner.query<{ thumb: Uint8Array | null }>(
    `SELECT thumb FROM attachment WHERE id = ?`,
    [attachmentId],
  );
  return rows[0]?.thumb ?? null;
}

/** The full bytes — the viewer, the share sheet and the zip export read through this. */
export async function readAttachmentBytes(
  runner: AttachmentsQueryRunner,
  attachmentId: UUID,
): Promise<Uint8Array | null> {
  const rows = await runner.query<{ data: Uint8Array | null }>(
    `SELECT data FROM attachment_blob WHERE attachment_id = ?`,
    [attachmentId],
  );
  return rows[0]?.data ?? null;
}
