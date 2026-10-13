import type {
  CharacterContextInfo,
  CharacterDraft,
  CharacterPatch,
  CharacterSummary,
} from "@starline/core";

/** Row → form state. Shared by the step 3 cards and the dossier. */
export function draftOf(character: CharacterSummary): CharacterDraft {
  return {
    name: character.name,
    role: character.role,
    color: character.color,
    arcType: character.arcType,
    oneLine: character.oneLine,
    oneParagraphText: character.oneParagraphText,
    motivation: character.motivation,
    goal: character.goal,
    conflict: character.conflict,
    epiphany: character.epiphany,
    pronouns: character.pronouns,
    age: character.age,
    occupation: character.occupation,
    want: character.want,
    need: character.need,
    lie: character.lie,
    truth: character.truth,
    flaws: character.flaws,
    strengths: character.strengths,
    fears: character.fears,
    values: character.values,
    internalConflictText: character.internalConflictText,
    externalConflictText: character.externalConflictText,
    ghostText: character.ghostText,
    voiceNotesText: character.voiceNotesText,
    appearanceText: character.appearanceText,
    backstoryText: character.backstoryText,
    storylineText: character.storylineText,
  };
}

/**
 * Full patch minus a blank name — autosave must not throw an error storm while the
 * writer has momentarily cleared the field. Returns null when there is nothing to write.
 */
export function patchOf(draft: CharacterDraft): CharacterPatch | null {
  const patch: CharacterPatch = { ...draft };
  if (patch.name === undefined || patch.name.trim().length === 0) delete patch.name;
  return Object.keys(patch).length === 0 ? null : patch;
}

/** CharacterSummary → the validator context slice (S3 quartet + S5 storyline). */
export function toContextInfo(character: CharacterSummary): CharacterContextInfo {
  return {
    id: character.id,
    role: character.role,
    motivation: character.motivation,
    goal: character.goal,
    conflict: character.conflict,
    epiphany: character.epiphany,
    storyline: character.storyline.text,
  };
}
