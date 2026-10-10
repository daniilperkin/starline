import type { Command } from "../commands";
import { epochNow, newUuid, orderKeyBetween, type UUID } from "../primitives";
import { sha256Hex } from "./hash";
import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_MIMES,
  IMAGE_SLOT_TARGETS,
  type ImageSlotTarget,
} from "./types";

/** Entity image slot → (table, column). The only place these identifiers are spelled. */
const IMAGE_SLOT_COLUMNS: Record<ImageSlotTarget, { table: string; column: string }> = {
  project: { table: "project", column: "cover_attachment_id" },
  character: { table: "character", column: "avatar_attachment_id" },
  lore_entry: { table: "lore_entry", column: "image_attachment_id" },
};

export interface CreateAttachmentArgs {
  projectId: UUID;
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
  /** Precomputed by callers that already hashed (the web ingest path); core hashes otherwise. */
  sha256?: string;
  width?: number | null;
  height?: number | null;
  /** 256 px WebP thumbnail for images; null for PDFs (no renderer in the bundle). */
  thumb?: Uint8Array | null;
}

export interface CreateAttachmentResult {
  attachmentId: UUID;
  sha256: string;
  /** True when the same bytes were already in the library — no new row, no new bytes. */
  deduped: boolean;
}

/**
 * Store one attachment (spec §4.4.2): images and PDFs up to 20 MB, deduped by SHA-256 per
 * project. Metadata and bytes go in together; the blob is a separate table so galleries stay cheap.
 */
export const createAttachment: Command<CreateAttachmentArgs, CreateAttachmentResult> = {
  name: "attachment.create",
  async run(ctx, args) {
    if (!(ATTACHMENT_MIMES as readonly string[]).includes(args.mimeType)) {
      throw new Error(`unsupported attachment type: ${args.mimeType}`);
    }
    if (args.bytes.byteLength === 0) throw new Error("attachment is empty");
    if (args.bytes.byteLength > ATTACHMENT_MAX_BYTES) {
      throw new Error(`attachment exceeds ${ATTACHMENT_MAX_BYTES} bytes`);
    }
    const fileName = (args.fileName.trim() || "attachment").slice(0, 255);
    const sha256 = args.sha256 ?? (await sha256Hex(args.bytes));

    const existing = await ctx.tx.query<{ id: string }>(
      `SELECT id FROM attachment WHERE project_id = ? AND sha256 = ?`,
      [args.projectId, sha256],
    );
    if (existing[0]) {
      return {
        result: { attachmentId: existing[0].id as UUID, sha256, deduped: true },
        changes: [],
      };
    }

    const attachmentId = newUuid();
    const now = epochNow();
    await ctx.tx.query(
      `INSERT INTO attachment (id, project_id, file_name, mime_type, byte_size, sha256,
                               width, height, thumb, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        attachmentId,
        args.projectId,
        fileName,
        args.mimeType,
        args.bytes.byteLength,
        sha256,
        args.width ?? null,
        args.height ?? null,
        args.thumb ?? null,
        now,
      ],
    );
    await ctx.tx.query(`INSERT INTO attachment_blob (attachment_id, data) VALUES (?, ?)`, [
      attachmentId,
      args.bytes,
    ]);
    return {
      result: { attachmentId, sha256, deduped: false },
      changes: [
        { table: "attachment", op: "insert", id: attachmentId, parentIds: [args.projectId] },
      ],
    };
  },
};

export interface DeleteAttachmentArgs {
  projectId: UUID;
  attachmentId: UUID;
}

/**
 * Hard delete (the schema has no trash for bytes): the blob, every gallery row and every image
 * slot referencing it go with it — the FKs are `ON DELETE SET NULL` / `CASCADE` for exactly this.
 */
export const deleteAttachment: Command<DeleteAttachmentArgs, { deleted: boolean }> = {
  name: "attachment.delete",
  async run(ctx, args) {
    const found = await ctx.tx.query<{ id: string }>(
      `SELECT id FROM attachment WHERE id = ? AND project_id = ?`,
      [args.attachmentId, args.projectId],
    );
    if (found.length === 0) return { result: { deleted: false }, changes: [] };
    await ctx.tx.query(`DELETE FROM attachment WHERE id = ? AND project_id = ?`, [
      args.attachmentId,
      args.projectId,
    ]);
    return {
      result: { deleted: true },
      changes: [
        { table: "attachment", op: "delete", id: args.attachmentId, parentIds: [args.projectId] },
      ],
    };
  },
};

export interface AttachToGalleryArgs {
  projectId: UUID;
  characterId: UUID;
  attachmentId: UUID;
  caption?: string;
}

/** Character gallery (spec §3.1 `character_gallery`): many images per character, captioned. */
export const attachToGallery: Command<AttachToGalleryArgs, { attached: boolean }> = {
  name: "attachment.gallery.attach",
  async run(ctx, args) {
    const attachment = await ctx.tx.query<{ id: string }>(
      `SELECT id FROM attachment WHERE id = ? AND project_id = ?`,
      [args.attachmentId, args.projectId],
    );
    if (attachment.length === 0) throw new Error("attachment not found in this project");
    const character = await ctx.tx.query<{ id: string }>(
      `SELECT id FROM character WHERE id = ? AND project_id = ? AND deleted_at IS NULL`,
      [args.characterId, args.projectId],
    );
    if (character.length === 0) throw new Error("character not found in this project");

    const existing = await ctx.tx.query<{ attachment_id: string }>(
      `SELECT attachment_id FROM character_gallery WHERE character_id = ? AND attachment_id = ?`,
      [args.characterId, args.attachmentId],
    );
    if (existing.length > 0) {
      if (args.caption !== undefined) {
        await ctx.tx.query(
          `UPDATE character_gallery SET caption = ? WHERE character_id = ? AND attachment_id = ?`,
          [args.caption.trim(), args.characterId, args.attachmentId],
        );
      }
      return { result: { attached: false }, changes: [] };
    }
    const last = await ctx.tx.query<{ order_key: string }>(
      `SELECT order_key FROM character_gallery WHERE character_id = ? ORDER BY order_key DESC LIMIT 1`,
      [args.characterId],
    );
    await ctx.tx.query(
      `INSERT INTO character_gallery (character_id, attachment_id, caption, order_key)
       VALUES (?, ?, ?, ?)`,
      [
        args.characterId,
        args.attachmentId,
        args.caption?.trim() ?? "",
        orderKeyBetween(last[0]?.order_key ?? null, null),
      ],
    );
    return {
      result: { attached: true },
      changes: [
        {
          table: "character_gallery",
          op: "update",
          id: args.characterId,
          parentIds: [args.projectId],
        },
      ],
    };
  },
};

export interface DetachFromGalleryArgs {
  projectId: UUID;
  characterId: UUID;
  attachmentId: UUID;
}

/** Removes the gallery row only — the attachment itself stays in the library. */
export const detachFromGallery: Command<DetachFromGalleryArgs, { detached: boolean }> = {
  name: "attachment.gallery.detach",
  async run(ctx, args) {
    const existing = await ctx.tx.query<{ attachment_id: string }>(
      `SELECT attachment_id FROM character_gallery WHERE character_id = ? AND attachment_id = ?`,
      [args.characterId, args.attachmentId],
    );
    if (existing.length === 0) return { result: { detached: false }, changes: [] };
    await ctx.tx.query(
      `DELETE FROM character_gallery WHERE character_id = ? AND attachment_id = ?`,
      [args.characterId, args.attachmentId],
    );
    return {
      result: { detached: true },
      changes: [
        {
          table: "character_gallery",
          op: "update",
          id: args.characterId,
          parentIds: [args.projectId],
        },
      ],
    };
  },
};

export interface SetEntityImageArgs {
  projectId: UUID;
  target: ImageSlotTarget;
  entityId: UUID;
  /** null clears the slot. */
  attachmentId: UUID | null;
}

/** The single-image slots: project cover, character avatar, lore entry image. */
export const setEntityImage: Command<SetEntityImageArgs, { updated: boolean }> = {
  name: "attachment.setImage",
  async run(ctx, args) {
    if (!(IMAGE_SLOT_TARGETS as readonly string[]).includes(args.target)) {
      throw new Error(`unknown image slot target: ${args.target}`);
    }
    if (args.attachmentId !== null) {
      const attachment = await ctx.tx.query<{ id: string }>(
        `SELECT id FROM attachment WHERE id = ? AND project_id = ?`,
        [args.attachmentId, args.projectId],
      );
      if (attachment.length === 0) throw new Error("attachment not found in this project");
    }
    const { table, column } = IMAGE_SLOT_COLUMNS[args.target];
    // `project` keys on its own id — every other table is scoped by `project_id`.
    const scoped = table === "project";
    const row = await ctx.tx.query<{ id: string }>(
      scoped
        ? `SELECT id FROM ${table} WHERE id = ?`
        : `SELECT id FROM ${table} WHERE id = ? AND project_id = ?`,
      scoped ? [args.entityId] : [args.entityId, args.projectId],
    );
    if (row.length === 0) throw new Error(`${args.target} not found in this project`);
    await ctx.tx.query(`UPDATE ${table} SET ${column} = ?, updated_at = ? WHERE id = ?`, [
      args.attachmentId,
      epochNow(),
      args.entityId,
    ]);
    return {
      result: { updated: true },
      changes: [{ table, op: "update", id: args.entityId, parentIds: [args.projectId] }],
    };
  },
};
