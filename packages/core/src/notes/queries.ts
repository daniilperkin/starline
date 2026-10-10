import type { SqlValue } from "../commands";
import type { EntityType } from "../entities";
import type { EpochMs, OrderKey, UUID } from "../primitives";
import { countWords, type PMDoc } from "../richtext";
import {
  NOTE_STALE_MS,
  NOTE_STATUSES,
  type NoteKind,
  type NoteStatus,
  type NoteSummary,
  type StaleIdea,
} from "./types";

/** The read-only statement surface a storage driver satisfies for queries. */
export interface NotesQueryRunner {
  query<T = Record<string, unknown>>(sql: string, params?: readonly SqlValue[]): Promise<T[]>;
}

interface NoteRow {
  id: string;
  title: string;
  kind: string;
  status: string;
  body_json: string | null;
  body_text: string;
  source_url: string;
  pinned: number;
  color: string | null;
  order_key: string;
  promoted_to_type: string | null;
  promoted_to_id: string | null;
  created_at: number;
  updated_at: number;
}

const NOTE_COLUMNS = `id, title, kind, status, body_json, body_text, source_url, pinned, color,
                      order_key, promoted_to_type, promoted_to_id, created_at, updated_at`;

function parseJson<T>(raw: string, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback; // a hand-edited file must not brick the board
  }
}

function toSummary(row: NoteRow, projectId: UUID): NoteSummary {
  return {
    id: row.id as UUID,
    projectId,
    title: row.title,
    kind: row.kind as NoteKind,
    status: row.status as NoteStatus,
    body: {
      json: parseJson<PMDoc | null>(row.body_json ?? "", null),
      text: row.body_text,
      wordCount: countWords(row.body_text),
    },
    sourceUrl: row.source_url,
    pinned: row.pinned === 1,
    color: row.color,
    orderKey: row.order_key as OrderKey,
    promotedToType: row.promoted_to_type as EntityType | null,
    promotedToId: row.promoted_to_id as UUID | null,
    createdAt: row.created_at as EpochMs,
    updatedAt: row.updated_at as EpochMs,
  };
}

export interface ListNotesOptions {
  status?: NoteStatus;
  kind?: NoteKind;
  pinnedOnly?: boolean;
  /** Case-insensitive substring over title + body (the board's filter box). */
  search?: string;
}

/**
 * The board's read (spec §4.4.2): pinned notes first, then board order, filtered by column, kind
 * or a substring. One query — the board redraws on every keystroke of the filter box.
 */
export async function listNotes(
  runner: NotesQueryRunner,
  projectId: UUID,
  options: ListNotesOptions = {},
): Promise<NoteSummary[]> {
  const where: string[] = ["project_id = ?", "deleted_at IS NULL"];
  const params: SqlValue[] = [projectId];
  if (options.status) {
    where.push("status = ?");
    params.push(options.status);
  }
  if (options.kind) {
    where.push("kind = ?");
    params.push(options.kind);
  }
  if (options.pinnedOnly) where.push("pinned = 1");
  const search = options.search?.trim();
  if (search) {
    where.push("(title LIKE ? ESCAPE '\\' OR body_text LIKE ? ESCAPE '\\')");
    const escaped = search.replace(/[\\%_]/g, (match) => `\\${match}`);
    params.push(`%${escaped}%`, `%${escaped}%`);
  }
  const rows = await runner.query<NoteRow>(
    `SELECT ${NOTE_COLUMNS} FROM idea_note
      WHERE ${where.join(" AND ")}
      ORDER BY pinned DESC, order_key`,
    params,
  );
  return rows.map((row) => toSummary(row, projectId));
}

export async function getNote(
  runner: NotesQueryRunner,
  projectId: UUID,
  noteId: UUID,
): Promise<NoteSummary | null> {
  const rows = await runner.query<NoteRow>(
    `SELECT ${NOTE_COLUMNS} FROM idea_note WHERE id = ? AND project_id = ? AND deleted_at IS NULL`,
    [noteId, projectId],
  );
  const row = rows[0];
  return row ? toSummary(row, projectId) : null;
}

/** Column counts for the board headers — always all four keys, zero included. */
export async function countNotesByStatus(
  runner: NotesQueryRunner,
  projectId: UUID,
): Promise<Record<NoteStatus, number>> {
  const counts: Record<NoteStatus, number> = { inbox: 0, incubating: 0, used: 0, archived: 0 };
  const rows = await runner.query<{ status: string; count: number }>(
    `SELECT status, COUNT(*) AS count FROM idea_note
      WHERE project_id = ? AND deleted_at IS NULL GROUP BY status`,
    [projectId],
  );
  for (const row of rows) {
    if ((NOTE_STATUSES as readonly string[]).includes(row.status)) {
      counts[row.status as NoteStatus] = row.count;
    }
  }
  return counts;
}

/**
 * "Revisit these ideas" (spec §4.4.2): incubating notes untouched for over 30 days, stalest first.
 * A nudge in the dashboard only — no notifications, no network.
 */
export async function listStaleIdeas(
  runner: NotesQueryRunner,
  projectId: UUID,
  now: number = Date.now(),
  olderThanMs: number = NOTE_STALE_MS,
): Promise<StaleIdea[]> {
  const rows = await runner.query<{ id: string; title: string; kind: string; updated_at: number }>(
    `SELECT id, title, kind, updated_at FROM idea_note
      WHERE project_id = ? AND status = 'incubating' AND deleted_at IS NULL AND updated_at <= ?
      ORDER BY updated_at ASC LIMIT 5`,
    [projectId, now - olderThanMs],
  );
  return rows.map((row) => ({
    id: row.id as UUID,
    title: row.title.trim() || "(untitled note)",
    kind: row.kind as NoteKind,
    updatedAt: row.updated_at as EpochMs,
    ageDays: Math.floor((now - row.updated_at) / (24 * 60 * 60 * 1000)),
  }));
}
