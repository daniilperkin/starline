import type { SqlValue } from "../commands";
import type { LoreKind } from "../entities";
import type { UUID } from "../primitives";
import { countWords, type RichText } from "../richtext";
import {
  LORE_KIND_GLYPHS,
  type LoreCategory,
  type LoreCategoryNode,
  type LoreEntryDetail,
  type LoreEntrySummary,
  type Mentionable,
} from "./types";

/** Worldbuilding reads (spec §3.7). Trees are built in memory from one flat, ordered query. */

export interface LoreQueryRunner {
  query<T = Record<string, unknown>>(sql: string, params?: readonly SqlValue[]): Promise<T[]>;
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback; // defensive: our own writes are always valid JSON
  }
}

export async function listLoreCategories(
  runner: LoreQueryRunner,
  projectId: UUID,
): Promise<LoreCategory[]> {
  const rows = await runner.query<{
    id: string;
    project_id: string;
    parent_id: string | null;
    name: string;
    icon: string;
    color: string | null;
    default_kind: string | null;
    order_key: string;
  }>(
    `SELECT id, project_id, parent_id, name, icon, color, default_kind, order_key
       FROM lore_category WHERE project_id = ? AND deleted_at IS NULL ORDER BY order_key`,
    [projectId],
  );
  return rows.map((row) => ({
    id: row.id as UUID,
    projectId: row.project_id as UUID,
    parentId: row.parent_id as UUID | null,
    name: row.name,
    icon: row.icon,
    color: row.color as LoreCategory["color"],
    defaultKind: row.default_kind as LoreKind | null,
    orderKey: row.order_key,
  }));
}

/** Nests the flat category list; `entryCount` comes from the entries the caller already has. */
export function buildCategoryTree(
  categories: LoreCategory[],
  entryCounts: Map<string, number> = new Map(),
): LoreCategoryNode[] {
  const nodes = new Map<string, LoreCategoryNode>();
  for (const category of categories) {
    nodes.set(category.id, {
      ...category,
      children: [],
      entryCount: entryCounts.get(category.id) ?? 0,
    });
  }
  const roots: LoreCategoryNode[] = [];
  for (const category of categories) {
    const node = nodes.get(category.id);
    if (!node) continue;
    const parent = category.parentId === null ? null : nodes.get(category.parentId);
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

export async function listLoreEntries(
  runner: LoreQueryRunner,
  projectId: UUID,
  filter: { categoryId?: UUID | null; kind?: LoreKind } = {},
): Promise<LoreEntrySummary[]> {
  const conditions = ["project_id = ?", "deleted_at IS NULL"];
  const params: Array<SqlValue> = [projectId];
  if (filter.categoryId !== undefined) {
    conditions.push("category_id IS ?");
    params.push(filter.categoryId);
  }
  if (filter.kind !== undefined) {
    conditions.push("kind = ?");
    params.push(filter.kind);
  }
  const rows = await runner.query<{
    id: string;
    project_id: string;
    category_id: string | null;
    parent_entry_id: string | null;
    kind: string;
    custom_kind_label: string;
    name: string;
    aliases: string;
    summary: string;
    pinned: number;
    order_key: string;
    updated_at: number;
  }>(
    `SELECT id, project_id, category_id, parent_entry_id, kind, custom_kind_label, name, aliases,
            summary, pinned, order_key, updated_at
       FROM lore_entry WHERE ${conditions.join(" AND ")}
      ORDER BY pinned DESC, order_key`,
    params,
  );
  return rows.map((row) => ({
    id: row.id as UUID,
    projectId: row.project_id as UUID,
    categoryId: row.category_id as UUID | null,
    parentEntryId: row.parent_entry_id as UUID | null,
    kind: row.kind as LoreKind,
    customKindLabel: row.custom_kind_label,
    name: row.name,
    aliases: parseJson<string[]>(row.aliases, []),
    summary: row.summary,
    pinned: row.pinned === 1,
    orderKey: row.order_key,
    updatedAt: row.updated_at,
  }));
}

/** Entries per category (for the tree's counts); uncategorised entries are not counted. */
export async function countEntriesByCategory(
  runner: LoreQueryRunner,
  projectId: UUID,
): Promise<Map<string, number>> {
  const rows = await runner.query<{ category_id: string; n: number }>(
    `SELECT category_id, COUNT(*) AS n FROM lore_entry
      WHERE project_id = ? AND deleted_at IS NULL AND category_id IS NOT NULL
      GROUP BY category_id`,
    [projectId],
  );
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.category_id, Number(row.n));
  return counts;
}

export async function getLoreEntry(
  runner: LoreQueryRunner,
  projectId: UUID,
  entryId: UUID,
): Promise<LoreEntryDetail | null> {
  const rows = await runner.query<{
    id: string;
    project_id: string;
    category_id: string | null;
    parent_entry_id: string | null;
    kind: string;
    custom_kind_label: string;
    name: string;
    aliases: string;
    summary: string;
    body_json: string | null;
    body_text: string;
    image_attachment_id: string | null;
    pinned: number;
    order_key: string;
    updated_at: number;
  }>(
    `SELECT id, project_id, category_id, parent_entry_id, kind, custom_kind_label, name, aliases,
            summary, body_json, body_text, image_attachment_id, pinned, order_key, updated_at
       FROM lore_entry WHERE id = ? AND project_id = ? AND deleted_at IS NULL`,
    [entryId, projectId],
  );
  const row = rows[0];
  if (!row) return null;
  const body: RichText = {
    json: parseJson<RichText["json"]>(row.body_json ?? "", null),
    text: row.body_text,
    wordCount: countWords(row.body_text),
  };
  return {
    id: row.id as UUID,
    projectId: row.project_id as UUID,
    categoryId: row.category_id as UUID | null,
    parentEntryId: row.parent_entry_id as UUID | null,
    kind: row.kind as LoreKind,
    customKindLabel: row.custom_kind_label,
    name: row.name,
    aliases: parseJson<string[]>(row.aliases, []),
    summary: row.summary,
    body,
    imageAttachmentId: row.image_attachment_id as UUID | null,
    pinned: row.pinned === 1,
    orderKey: row.order_key,
    updatedAt: row.updated_at,
  };
}

/** Ancestor names from the root down to (and including) the given category. */
export function categoryPath(categories: LoreCategory[], categoryId: UUID | null): LoreCategory[] {
  if (categoryId === null) return [];
  const byId = new Map(categories.map((category) => [category.id, category]));
  const path: LoreCategory[] = [];
  let current = byId.get(categoryId);
  let guard = 0;
  while (current && guard < 64) {
    path.unshift(current);
    current = current.parentId === null ? undefined : byId.get(current.parentId);
    guard += 1;
  }
  return path;
}

/** Ancestor entries from the root down to the given entry (exclusive of the entry itself). */
export function entryPath(entries: LoreEntrySummary[], entryId: UUID | null): LoreEntrySummary[] {
  if (entryId === null) return [];
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const path: LoreEntrySummary[] = [];
  let current = byId.get(entryId);
  let guard = 0;
  while (current?.parentEntryId && guard < 64) {
    const parent = byId.get(current.parentEntryId);
    if (!parent) break;
    path.unshift(parent);
    current = parent;
    guard += 1;
  }
  return path;
}

/** Everything the @-picker can link to: characters and lore entries, names sorted. */
export async function listMentionables(
  runner: LoreQueryRunner,
  projectId: UUID,
): Promise<Mentionable[]> {
  const characters = await runner.query<{
    id: string;
    name: string;
    role: string;
    updated_at: number;
  }>(
    `SELECT id, name, role, updated_at FROM character
      WHERE project_id = ? AND deleted_at IS NULL ORDER BY name COLLATE NOCASE`,
    [projectId],
  );
  const lore = await runner.query<{
    id: string;
    name: string;
    kind: string;
    custom_kind_label: string;
    updated_at: number;
  }>(
    `SELECT id, name, kind, custom_kind_label, updated_at FROM lore_entry
      WHERE project_id = ? AND deleted_at IS NULL ORDER BY name COLLATE NOCASE`,
    [projectId],
  );
  // Spec §4.4.2: `@` offers characters, lore, scenes and notes — a note can be referenced from
  // prose and vice versa, which is exactly what the backlink panel shows.
  const scenes = await runner.query<{
    id: string;
    title: string;
    synopsis_text: string;
    updated_at: number;
  }>(
    `SELECT id, title, synopsis_text, updated_at FROM scene
      WHERE project_id = ? AND deleted_at IS NULL ORDER BY order_key`,
    [projectId],
  );
  const notes = await runner.query<{
    id: string;
    title: string;
    body_text: string;
    updated_at: number;
  }>(
    `SELECT id, title, body_text, updated_at FROM idea_note
      WHERE project_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 100`,
    [projectId],
  );
  return [
    ...characters.map((row) => ({
      id: row.id as UUID,
      type: "character" as const,
      label: row.name,
      glyph: "◍",
      detail: row.role,
      updatedAt: row.updated_at as number,
    })),
    ...lore.map((row) => ({
      id: row.id as UUID,
      type: "lore" as const,
      label: row.name,
      glyph: LORE_KIND_GLYPHS[row.kind as LoreKind] ?? "✧",
      detail: row.kind === "custom" ? row.custom_kind_label : row.kind.replace(/_/g, " "),
      updatedAt: row.updated_at as number,
    })),
    ...scenes.map((row) => ({
      id: row.id as UUID,
      type: "scene" as const,
      label: row.title.trim() || firstLineOf(row.synopsis_text) || "(untitled scene)",
      glyph: "▤",
      detail: "scene",
      updatedAt: row.updated_at as number,
    })),
    ...notes.map((row) => ({
      id: row.id as UUID,
      type: "note" as const,
      label: row.title.trim() || firstLineOf(row.body_text) || "(untitled note)",
      glyph: "✦",
      detail: "note",
      updatedAt: row.updated_at as number,
    })),
  ];
}

function firstLineOf(text: string): string {
  return text.split("\n")[0]?.trim() ?? "";
}
