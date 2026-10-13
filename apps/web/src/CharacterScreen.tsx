import {
  type ArcType,
  CHARACTER_ROLES,
  CHARACTER_SWATCHES,
  type CharacterDraft,
  type CharacterSummary,
  messages,
  type UUID,
} from "@starline/core";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { useActiveProject } from "./active-project";
import { BacklinksPanel } from "./BacklinksPanel";
import { draftOf, patchOf } from "./characterDraft";
import { useCharacters, useDeleteCharacter, useRestoreEntity, useUpdateCharacter } from "./data";
import { CharacterGallery } from "./Gallery";
import { useOpenEntity } from "./openEntity";
import { CharacterRelationships } from "./relationships/CharacterRelationships";
import { TagPicker } from "./TagPicker";
import { useUndoStore } from "./undo";
import { useAutosave } from "./useAutosave";

const ARC_TYPES: readonly ArcType[] = [
  "none",
  "positive_change",
  "flat",
  "negative_fall",
  "negative_corruption",
  "negative_disillusionment",
];

/** Dossier v1 — the overview tab: identity, arc, and the Snowflake quartet. */
export function CharacterScreen() {
  const { characterId } = useParams({ from: "/people/$characterId" });
  const { project } = useActiveProject();
  const characters = useCharacters(project?.id ?? null);
  const character = characters.data?.find((candidate) => candidate.id === characterId) ?? null;

  if (project === null || characters.data === undefined) {
    return <p className="text-sm text-muted">{messages.common.loading}</p>;
  }
  if (character === null) {
    return <p className="text-sm text-muted">{messages.people.empty}</p>;
  }
  return <DossierForm key={character.id} projectId={project.id} character={character} />;
}

function DossierForm({ projectId, character }: { projectId: UUID; character: CharacterSummary }) {
  const [draft, setDraft] = useState<CharacterDraft>(() => draftOf(character));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const navigate = useNavigate();
  const update = useUpdateCharacter();
  const remove = useDeleteCharacter();
  const restore = useRestoreEntity();
  const pushUndo = useUndoStore((state) => state.push);
  const openEntity = useOpenEntity();

  useAutosave(draft, async (value) => {
    const patch = patchOf(value);
    if (patch === null) return true;
    try {
      await update.mutateAsync({ projectId, characterId: character.id, patch });
      return true;
    } catch {
      return false;
    }
  });

  const set = <K extends keyof CharacterDraft>(key: K, value: CharacterDraft[K]) => {
    setDraft((previous) => ({ ...previous, [key]: value }));
  };

  const onDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    await remove.mutateAsync({ projectId, characterId: character.id }).catch(() => undefined);
    pushUndo(messages.undo.characterDeleted, async () => {
      await restore.mutateAsync({ projectId, entityType: "character", entityId: character.id });
    });
    await navigate({ to: "/people" });
  };

  const labelClass = "text-xs font-medium tracking-wide text-muted uppercase";

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center gap-3">
        <button
          type="button"
          className="sl-btn"
          aria-label={messages.people.back}
          onClick={() => void navigate({ to: "/people" })}
        >
          ←
        </button>
        <h1 className="min-w-0 flex-1 truncate text-xl font-semibold tracking-tight">
          {draft.name || messages.dossier.name}
        </h1>
      </header>

      <section className="sl-card flex flex-col gap-3 p-5">
        <div>
          <label className={labelClass} htmlFor="character-name">
            {messages.dossier.name}
          </label>
          <input
            id="character-name"
            className="sl-input mt-1"
            value={draft.name}
            onChange={(event) => set("name", event.target.value)}
          />
        </div>

        <div className="flex flex-wrap gap-3">
          <div>
            <label className={labelClass} htmlFor="character-role">
              {messages.dossier.role}
            </label>
            <select
              id="character-role"
              className="sl-input mt-1"
              value={draft.role}
              onChange={(event) => set("role", event.target.value as CharacterDraft["role"])}
            >
              {CHARACTER_ROLES.map((role) => (
                <option key={role} value={role}>
                  {messages.roles[role]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="character-arc">
              {messages.dossier.arc}
            </label>
            <select
              id="character-arc"
              className="sl-input mt-1"
              value={draft.arcType}
              onChange={(event) => set("arcType", event.target.value as ArcType)}
            >
              {ARC_TYPES.map((arc) => (
                <option key={arc} value={arc}>
                  {messages.arcs[arc]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className={labelClass}>{messages.dossier.colour}</legend>
          <div className="flex flex-wrap gap-2">
            {CHARACTER_SWATCHES.map((colour) => (
              <button
                key={colour}
                type="button"
                aria-label={colour}
                aria-pressed={draft.color === colour}
                className={
                  draft.color === colour
                    ? "h-7 w-7 rounded-full outline-2 outline-offset-2 outline-accent"
                    : "h-7 w-7 rounded-full"
                }
                style={{ background: colour }}
                onClick={() => set("color", colour)}
              />
            ))}
          </div>
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-2">
          {(["motivation", "goal", "conflict", "epiphany"] as const).map((field) => (
            <div key={field}>
              <label className={labelClass} htmlFor={`character-${field}`}>
                {messages.dossier[field]}
              </label>
              <textarea
                id={`character-${field}`}
                className="sl-textarea mt-1"
                rows={3}
                value={draft[field]}
                onChange={(event) => set(field, event.target.value)}
              />
            </div>
          ))}
        </div>

        <div>
          <label className={labelClass} htmlFor="character-one-line">
            {messages.dossier.oneLine}
          </label>
          <input
            id="character-one-line"
            className="sl-input mt-1"
            value={draft.oneLine}
            onChange={(event) => set("oneLine", event.target.value)}
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="character-one-paragraph">
            {messages.dossier.oneParagraph}
          </label>
          <textarea
            id="character-one-paragraph"
            className="sl-textarea mt-1"
            rows={5}
            value={draft.oneParagraphText}
            onChange={(event) => set("oneParagraphText", event.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1">
          <span className="sl-label">{messages.tags.picker}</span>
          <TagPicker projectId={projectId} entityType="character" entityId={character.id} />
        </div>

        <CharacterRelationships projectId={projectId} characterId={character.id} />

        <CharacterGallery projectId={projectId} characterId={character.id} />

        <BacklinksPanel
          projectId={projectId}
          targetType="character"
          targetId={character.id}
          onNavigate={(source) => openEntity(source.sourceType, source.sourceId)}
        />
      </section>

      <button type="button" className="sl-btn" onClick={() => void onDelete()}>
        {confirmDelete ? messages.people.deleteConfirm : messages.people.delete}
      </button>
    </div>
  );
}
