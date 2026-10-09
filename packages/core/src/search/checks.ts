import type { SqlValue } from "../commands";
import type { UUID } from "../primitives";
import { type NameEntry, nearDuplicatePairs } from "./text";
import type { CheckItem, ConsistencyCheck } from "./types";

/**
 * Consistency checks (PLAN slice 7, spec §4.x): the "something is probably missing" list. Every
 * check is a read that returns rows the writer can act on; nothing here blocks or auto-fixes,
 * because a blank summary is often deliberate and only the author knows which.
 */

export interface CheckRunner {
  query<T = Record<string, unknown>>(sql: string, params?: readonly SqlValue[]): Promise<T[]>;
}

interface Row {
  id: string;
  title: string;
  extra: string | null;
}

function toItems(rows: readonly Row[], entityType: string): CheckItem[] {
  return rows.map((row) => ({
    entityType,
    entityId: row.id as UUID,
    title: row.title.trim() || "(untitled)",
    detail: row.extra ?? "",
  }));
}

/** Lore entries and characters whose one-line/summary is still empty. */
async function emptyTexts(runner: CheckRunner, projectId: UUID): Promise<ConsistencyCheck[]> {
  const lore = await runner.query<Row>(
    `SELECT id, name AS title, kind AS extra FROM lore_entry
      WHERE project_id = ? AND deleted_at IS NULL AND TRIM(summary) = '' AND TRIM(body_text) = ''
      ORDER BY name`,
    [projectId],
  );
  const characters = await runner.query<Row>(
    `SELECT id, name AS title, role AS extra FROM character
      WHERE project_id = ? AND deleted_at IS NULL AND TRIM(one_line) = ''
      ORDER BY name`,
    [projectId],
  );
  const checks: ConsistencyCheck[] = [];
  if (lore.length > 0) {
    checks.push({
      id: "lore-empty",
      severity: "info",
      label: "Lore entries with no summary or notes",
      hint: "A one-line summary is what the @-picker and the backlink snippets show.",
      items: toItems(lore, "lore"),
    });
  }
  if (characters.length > 0) {
    checks.push({
      id: "character-empty",
      severity: "info",
      label: "Characters without a one-line description",
      hint: "Step 3 asks for a one-liner for every character; blanks are the usual leftovers.",
      items: toItems(characters, "character"),
    });
  }
  return checks;
}

/** Lore entries nothing points at: no mentions, no scene links, no children, not pinned. */
async function unusedLore(runner: CheckRunner, projectId: UUID): Promise<ConsistencyCheck[]> {
  const rows = await runner.query<Row>(
    `SELECT e.id, e.name AS title, e.kind AS extra
       FROM lore_entry e
      WHERE e.project_id = ? AND e.deleted_at IS NULL AND e.pinned = 0
        AND NOT EXISTS (
          SELECT 1 FROM mention m
           WHERE m.target_type = 'lore' AND m.target_id = e.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM scene_lore sl WHERE sl.lore_entry_id = e.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM lore_entry child
           WHERE child.parent_entry_id = e.id AND child.deleted_at IS NULL
        )
      ORDER BY e.kind, e.name`,
    [projectId],
  );
  if (rows.length === 0) return [];
  return [
    {
      id: "lore-unused",
      severity: "info",
      label: "Lore nothing links to yet",
      hint: "No mentions, no scene links and no sub-entries — either link it or pin it as intentional.",
      items: toItems(rows, "lore"),
    },
  ];
}

/**
 * Factions with no typed links at all. The full "faction without members" rule needs the
 * relationship slice (8); this is the honest version until `entity_link` gets its editor.
 */
async function factionsWithoutLinks(
  runner: CheckRunner,
  projectId: UUID,
): Promise<ConsistencyCheck[]> {
  const rows = await runner.query<Row>(
    `SELECT e.id, e.name AS title, '' AS extra FROM lore_entry e
      WHERE e.project_id = ? AND e.deleted_at IS NULL AND e.kind = 'faction'
        AND NOT EXISTS (
          SELECT 1 FROM entity_link l
           WHERE (l.from_type = 'lore' AND l.from_id = e.id) OR (l.to_type = 'lore' AND l.to_id = e.id)
        )
      ORDER BY e.name`,
    [projectId],
  );
  if (rows.length === 0) return [];
  return [
    {
      id: "faction-unlinked",
      severity: "info",
      label: "Factions without typed links",
      hint: "Typed links (member_of, located_in) arrive with the relationship slice; mentions count too.",
      items: toItems(rows, "lore"),
    },
  ];
}

/** Near-duplicate names across characters and lore — the classic "two spellings" slip. */
async function duplicateNames(runner: CheckRunner, projectId: UUID): Promise<ConsistencyCheck[]> {
  const characters = await runner.query<{ id: string; name: string }>(
    "SELECT id, name FROM character WHERE project_id = ? AND deleted_at IS NULL",
    [projectId],
  );
  const lore = await runner.query<{ id: string; name: string }>(
    "SELECT id, name FROM lore_entry WHERE project_id = ? AND deleted_at IS NULL",
    [projectId],
  );
  const entries: NameEntry[] = [
    ...characters.map((row) => ({ entityType: "character", entityId: row.id, name: row.name })),
    ...lore.map((row) => ({ entityType: "lore", entityId: row.id, name: row.name })),
  ];
  const pairs = nearDuplicatePairs(entries);
  if (pairs.length === 0) return [];
  return [
    {
      id: "duplicate-names",
      severity: "warning",
      label: "Names that differ by a letter or two",
      hint: "Check these pairs before the cast grows — merging later is more work than renaming now.",
      items: pairs.map((pair) => ({
        entityType: pair.a.entityType,
        entityId: pair.a.entityId as UUID,
        title: pair.a.name,
        detail: `vs ${pair.b.name} (${pair.b.entityType})`,
      })),
    },
  ];
}

/** Scenes that still have no synopsis text — the step-9 gap the writer skipped. */
async function thinScenes(runner: CheckRunner, projectId: UUID): Promise<ConsistencyCheck[]> {
  const rows = await runner.query<Row>(
    `SELECT s.id, COALESCE(NULLIF(TRIM(s.title), ''), '(untitled scene)') AS title,
            COALESCE(c.title, '') AS extra
       FROM scene s LEFT JOIN chapter c ON c.id = s.chapter_id
      WHERE s.project_id = ? AND s.deleted_at IS NULL AND TRIM(s.synopsis_text) = ''
      ORDER BY s.order_key`,
    [projectId],
  );
  if (rows.length === 0) return [];
  return [
    {
      id: "scene-thin",
      severity: "info",
      label: "Scenes without a synopsis",
      hint: "Step 9 expands each scene; an empty synopsis means the scene is still a title.",
      items: toItems(rows, "scene"),
    },
  ];
}

/** Runs every check; an empty result means the project has nothing to nag about. */
export async function runConsistencyChecks(
  runner: CheckRunner,
  projectId: UUID,
): Promise<ConsistencyCheck[]> {
  const checks: ConsistencyCheck[] = [];
  checks.push(...(await emptyTexts(runner, projectId)));
  checks.push(...(await unusedLore(runner, projectId)));
  checks.push(...(await factionsWithoutLinks(runner, projectId)));
  checks.push(...(await thinScenes(runner, projectId)));
  checks.push(...(await duplicateNames(runner, projectId)));
  return checks;
}
