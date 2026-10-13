import type { SqlValue } from "../commands";
import type { ArcType, CharacterRole } from "../entities";
import type { UUID } from "../primitives";
import { countWords, type RichText } from "../richtext";
import type { CharacterSummary } from "./types";

/** The read-only statement surface a storage driver satisfies for queries. */
export interface CharacterQueryRunner {
  query<T = Record<string, unknown>>(sql: string, params?: readonly SqlValue[]): Promise<T[]>;
}

/** Active characters of a project, in manual order. */
export async function listCharacters(
  runner: CharacterQueryRunner,
  projectId: UUID,
): Promise<CharacterSummary[]> {
  const rows = await runner.query<{
    id: string;
    project_id: string;
    name: string;
    aliases: string;
    role: string;
    color: string;
    arc_type: string;
    one_line: string;
    one_paragraph_text: string;
    motivation: string;
    goal: string;
    conflict: string;
    epiphany: string;
    pronouns: string;
    age: string;
    occupation: string;
    want: string;
    need: string;
    lie: string;
    truth: string;
    flaws: string;
    strengths: string;
    fears: string;
    values: string;
    internal_conflict_text: string;
    external_conflict_text: string;
    ghost_text: string;
    voice_notes_text: string;
    appearance_text: string;
    backstory_text: string;
    storyline_json: string | null;
    storyline_text: string;
    order_key: string;
    updated_at: number;
  }>(
    `SELECT id, project_id, name, aliases, role, color, arc_type, one_line,
            one_paragraph_text, motivation, goal, conflict, epiphany,
            pronouns, age, occupation, want, need, lie, truth,
            flaws, strengths, fears, "values",
            internal_conflict_text, external_conflict_text,
            ghost_text, voice_notes_text, appearance_text, backstory_text,
            storyline_json, storyline_text, order_key, updated_at
       FROM character
      WHERE project_id = ? AND deleted_at IS NULL
      ORDER BY order_key`,
    [projectId],
  );
  return rows.map((row) => ({
    id: row.id as UUID,
    projectId: row.project_id as UUID,
    name: row.name,
    aliases: parseJson<string[]>(row.aliases, []),
    role: row.role as CharacterRole,
    color: row.color,
    arcType: row.arc_type as ArcType,
    oneLine: row.one_line,
    oneParagraphText: row.one_paragraph_text,
    motivation: row.motivation,
    goal: row.goal,
    conflict: row.conflict,
    epiphany: row.epiphany,
    pronouns: row.pronouns,
    age: row.age,
    occupation: row.occupation,
    want: row.want,
    need: row.need,
    lie: row.lie,
    truth: row.truth,
    flaws: row.flaws,
    strengths: row.strengths,
    fears: row.fears,
    values: row.values,
    internalConflictText: row.internal_conflict_text,
    externalConflictText: row.external_conflict_text,
    ghostText: row.ghost_text,
    voiceNotesText: row.voice_notes_text,
    appearanceText: row.appearance_text,
    backstoryText: row.backstory_text,
    storylineText: row.storyline_text,
    storyline: {
      json: parseJson<RichText["json"]>(row.storyline_json ?? "", null),
      text: row.storyline_text,
      wordCount: countWords(row.storyline_text),
    },
    orderKey: row.order_key,
    updatedAt: row.updated_at,
  }));
}

export async function getCharacter(
  runner: CharacterQueryRunner,
  projectId: UUID,
  characterId: UUID,
): Promise<CharacterSummary | null> {
  const all = await listCharacters(runner, projectId);
  return all.find((character) => character.id === characterId) ?? null;
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback; // defensive: our own writes are always valid JSON
  }
}
