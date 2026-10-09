import type { SqlValue } from "../commands";
import type { EpochMs, UUID } from "../primitives";
import type { TrashItem } from "./types";

/** The read-only statement surface a storage driver satisfies for queries. */
export interface TrashQueryRunner {
  query<T = Record<string, unknown>>(sql: string, params?: readonly SqlValue[]): Promise<T[]>;
}

function firstLine(text: string): string {
  return text.split("\n")[0]?.trim() ?? "";
}

/**
 * Everything currently in the Trash, newest first (spec §3.9): a view over rows with
 * `deleted_at != NULL` across the managed tables. Labels mirror how the entity reads
 * elsewhere — a scene without a title falls back to its one-line synopsis.
 */
export async function listTrash(runner: TrashQueryRunner, projectId: UUID): Promise<TrashItem[]> {
  const items: TrashItem[] = [];

  const characters = await runner.query<{ id: string; name: string; deleted_at: number }>(
    `SELECT id, name, deleted_at FROM character
      WHERE project_id = ? AND deleted_at IS NOT NULL`,
    [projectId],
  );
  for (const row of characters) {
    items.push({
      entityType: "character",
      entityId: row.id as UUID,
      deletedAt: row.deleted_at as EpochMs,
      label: row.name,
      detail: "",
    });
  }

  const chapters = await runner.query<{ id: string; title: string; deleted_at: number }>(
    `SELECT id, title, deleted_at FROM chapter
      WHERE project_id = ? AND deleted_at IS NOT NULL`,
    [projectId],
  );
  for (const row of chapters) {
    items.push({
      entityType: "chapter",
      entityId: row.id as UUID,
      deletedAt: row.deleted_at as EpochMs,
      label: row.title,
      detail: "",
    });
  }

  const scenes = await runner.query<{
    id: string;
    title: string;
    synopsis_text: string;
    chapter_title: string | null;
    deleted_at: number;
  }>(
    `SELECT s.id, s.title, s.synopsis_text, c.title AS chapter_title, s.deleted_at
       FROM scene s LEFT JOIN chapter c ON c.id = s.chapter_id
      WHERE s.project_id = ? AND s.deleted_at IS NOT NULL`,
    [projectId],
  );
  for (const row of scenes) {
    items.push({
      entityType: "scene",
      entityId: row.id as UUID,
      deletedAt: row.deleted_at as EpochMs,
      label: row.title.trim() || firstLine(row.synopsis_text) || "(untitled scene)",
      detail: row.chapter_title ?? "",
    });
  }

  const plotlines = await runner.query<{ id: string; name: string; deleted_at: number }>(
    `SELECT id, name, deleted_at FROM plotline
      WHERE project_id = ? AND deleted_at IS NOT NULL`,
    [projectId],
  );
  for (const row of plotlines) {
    items.push({
      entityType: "plotline",
      entityId: row.id as UUID,
      deletedAt: row.deleted_at as EpochMs,
      label: row.name,
      detail: "",
    });
  }

  const lore = await runner.query<{
    id: string;
    name: string;
    summary: string;
    deleted_at: number;
  }>(
    `SELECT id, name, summary, deleted_at FROM lore_entry
      WHERE project_id = ? AND deleted_at IS NOT NULL`,
    [projectId],
  );
  for (const row of lore) {
    items.push({
      entityType: "lore_entry",
      entityId: row.id as UUID,
      deletedAt: row.deleted_at as EpochMs,
      label: row.name,
      detail: row.summary,
    });
  }

  return items.sort((a, b) => b.deletedAt - a.deletedAt);
}
