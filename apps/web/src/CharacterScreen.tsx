import {
  type ArcType,
  CHARACTER_ROLES,
  CHARACTER_SWATCHES,
  type CharacterDraft,
  type CharacterSummary,
  messages,
  type UUID,
} from "@starline/core";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { useActiveProject } from "./active-project";
import { BacklinksPanel } from "./BacklinksPanel";
import { draftOf, patchOf } from "./characterDraft";
import { useCharacters, useDeleteCharacter, useRestoreEntity, useUpdateCharacter } from "./data";
import { CharacterGallery } from "./Gallery";
import { useOpenEntity } from "./openEntity";
import { CharacterRelationships } from "./relationships/CharacterRelationships";
import { useSessionStore } from "./session";
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

/** Slice 29: the dossier's tabs, in the order the spec lists them (overview keeps its v1 content). */
const TABS = [
  "overview",
  "psychology",
  "storyArc",
  "appearance",
  "backstory",
  "voice",
  "appearances",
  "gallery",
  "custom",
] as const;
type DossierTab = (typeof TABS)[number];

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
  const [tab, setTab] = useState<DossierTab>("overview");
  const navigate = useNavigate();
  const update = useUpdateCharacter();
  const remove = useDeleteCharacter();
  const restore = useRestoreEntity();
  const pushUndo = useUndoStore((state) => state.push);
  const openEntity = useOpenEntity();
  const session = useSessionStore((state) => state.session);

  const appearances = useQuery({
    queryKey: ["sharedScenes", session?.name ?? null, projectId, character.id],
    enabled: session !== null,
    queryFn: async () => {
      if (!session) throw new Error("no session");
      const rows = await session.driver.query<{
        id: string;
        title: string;
        chapter_title: string | null;
      }>(
        `SELECT s.id, s.title, c.title AS chapter_title
           FROM scene_character sc
           JOIN scene s ON s.id = sc.scene_id
           LEFT JOIN chapter c ON c.id = s.chapter_id
          WHERE sc.character_id = ? AND s.project_id = ? AND s.deleted_at IS NULL
          ORDER BY s.order_key`,
        [character.id, projectId],
      );
      return rows.map((row) => ({
        id: row.id,
        title: row.title,
        chapterTitle: row.chapter_title ?? "",
      }));
    },
  });

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

  const area = (key: keyof CharacterDraft, label: string, rows = 3) => (
    <div key={key}>
      <label className={labelClass} htmlFor={`character-${key}`}>
        {label}
      </label>
      <textarea
        id={`character-${key}`}
        className="sl-textarea mt-1"
        rows={rows}
        value={String(draft[key])}
        onChange={(event) => set(key, event.target.value as CharacterDraft[typeof key])}
      />
    </div>
  );

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

      <div role="tablist" aria-label={messages.dossier.name} className="sl-tabs">
        {TABS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`sl-dossier-tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`sl-dossier-panel-${id}`}
            data-testid={`sl-dossier-${id}`}
            className={tab === id ? "sl-dossier-tab sl-dossier-tab-active" : "sl-dossier-tab"}
            onClick={() => setTab(id)}
          >
            {messages.dossier.tabs[id]}
          </button>
        ))}
      </div>

      {tab === "overview" ? (
        <section
          role="tabpanel"
          id="sl-dossier-panel-overview"
          aria-labelledby="sl-dossier-tab-overview"
          data-testid="sl-dossier-panel"
          className="sl-card flex flex-col gap-3 p-5"
        >
          <div className="grid gap-3 sm:grid-cols-2">
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
            <div>
              <label className={labelClass} htmlFor="character-role">
                {messages.dossier.role}
              </label>
              <select
                id="character-role"
                className="sl-select mt-1"
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
              <label className={labelClass} htmlFor="character-pronouns">
                {messages.dossier.pronouns}
              </label>
              <input
                id="character-pronouns"
                className="sl-input mt-1"
                value={draft.pronouns}
                onChange={(event) => set("pronouns", event.target.value)}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="character-age">
                {messages.dossier.age}
              </label>
              <input
                id="character-age"
                className="sl-input mt-1"
                value={draft.age}
                onChange={(event) => set("age", event.target.value)}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="character-occupation">
                {messages.dossier.occupation}
              </label>
              <input
                id="character-occupation"
                className="sl-input mt-1"
                value={draft.occupation}
                onChange={(event) => set("occupation", event.target.value)}
              />
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
        </section>
      ) : null}

      {tab === "psychology" ? (
        <section
          role="tabpanel"
          id="sl-dossier-panel-psychology"
          aria-labelledby="sl-dossier-tab-psychology"
          data-testid="sl-dossier-panel"
          className="sl-card grid gap-3 p-5 sm:grid-cols-2"
        >
          {area("motivation", messages.dossier.motivation)}
          {area("goal", messages.dossier.goal)}
          {area("conflict", messages.dossier.conflict)}
          {area("epiphany", messages.dossier.epiphany)}
          {area("want", messages.dossier.want)}
          {area("need", messages.dossier.need)}
          {area("lie", messages.dossier.lie)}
          {area("truth", messages.dossier.truth)}
          <div>
            <label className={labelClass} htmlFor="character-flaws">
              {messages.dossier.flaws}
            </label>
            <input
              id="character-flaws"
              className="sl-input mt-1"
              value={draft.flaws}
              onChange={(event) => set("flaws", event.target.value)}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="character-strengths">
              {messages.dossier.strengths}
            </label>
            <input
              id="character-strengths"
              className="sl-input mt-1"
              value={draft.strengths}
              onChange={(event) => set("strengths", event.target.value)}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="character-fears">
              {messages.dossier.fears}
            </label>
            <input
              id="character-fears"
              className="sl-input mt-1"
              value={draft.fears}
              onChange={(event) => set("fears", event.target.value)}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="character-values">
              {messages.dossier.values}
            </label>
            <input
              id="character-values"
              className="sl-input mt-1"
              value={draft.values}
              onChange={(event) => set("values", event.target.value)}
            />
          </div>
          {area("internalConflictText", messages.dossier.internalConflict)}
          {area("externalConflictText", messages.dossier.externalConflict)}
        </section>
      ) : null}

      {tab === "storyArc" ? (
        <section
          role="tabpanel"
          id="sl-dossier-panel-storyArc"
          aria-labelledby="sl-dossier-tab-storyArc"
          data-testid="sl-dossier-panel"
          className="sl-card flex flex-col gap-3 p-5"
        >
          <div>
            <label className={labelClass} htmlFor="character-arc">
              {messages.dossier.arc}
            </label>
            <select
              id="character-arc"
              className="sl-select mt-1"
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
          {area("ghostText", messages.dossier.ghost)}
          {area("storylineText", messages.dossier.storyline, 6)}
        </section>
      ) : null}

      {tab === "appearance" ? (
        <section
          role="tabpanel"
          id="sl-dossier-panel-appearance"
          aria-labelledby="sl-dossier-tab-appearance"
          data-testid="sl-dossier-panel"
          className="sl-card flex flex-col gap-3 p-5"
        >
          {area("appearanceText", messages.dossier.appearance, 6)}
        </section>
      ) : null}

      {tab === "backstory" ? (
        <section
          role="tabpanel"
          id="sl-dossier-panel-backstory"
          aria-labelledby="sl-dossier-tab-backstory"
          data-testid="sl-dossier-panel"
          className="sl-card flex flex-col gap-3 p-5"
        >
          {area("backstoryText", messages.dossier.backstory, 8)}
        </section>
      ) : null}

      {tab === "voice" ? (
        <section
          role="tabpanel"
          id="sl-dossier-panel-voice"
          aria-labelledby="sl-dossier-tab-voice"
          data-testid="sl-dossier-panel"
          className="sl-card flex flex-col gap-3 p-5"
        >
          {area("voiceNotesText", messages.dossier.voice, 6)}
        </section>
      ) : null}

      {tab === "appearances" ? (
        <section
          role="tabpanel"
          id="sl-dossier-panel-appearances"
          aria-labelledby="sl-dossier-tab-appearances"
          data-testid="sl-dossier-panel"
          className="sl-card flex flex-col gap-2 p-5"
        >
          {(appearances.data ?? []).length === 0 ? (
            <p className="text-sm text-muted">{messages.dossier.noAppearances}</p>
          ) : (
            (appearances.data ?? []).map((scene) => (
              <div key={scene.id} className="sl-recent-row">
                <span className="sl-recent-title">
                  {scene.title.trim().length > 0 ? scene.title : messages.scenes.unassigned}
                </span>
              </div>
            ))
          )}
        </section>
      ) : null}

      {tab === "gallery" ? (
        <section
          role="tabpanel"
          id="sl-dossier-panel-gallery"
          aria-labelledby="sl-dossier-tab-gallery"
          data-testid="sl-dossier-panel"
          className="sl-card flex flex-col gap-3 p-5"
        >
          <CharacterGallery projectId={projectId} characterId={character.id} />
        </section>
      ) : null}

      {tab === "custom" ? (
        <section
          role="tabpanel"
          id="sl-dossier-panel-custom"
          aria-labelledby="sl-dossier-tab-custom"
          data-testid="sl-dossier-panel"
          className="sl-card flex flex-col gap-3 p-5"
        >
          <CustomFieldValues projectId={projectId} characterId={character.id} />
        </section>
      ) : null}

      <BacklinksPanel
        projectId={projectId}
        targetType="character"
        targetId={character.id}
        onNavigate={(source) => openEntity(source.sourceType, source.sourceId)}
      />

      <button type="button" className="sl-btn" onClick={() => void onDelete()}>
        {confirmDelete ? messages.people.deleteConfirm : messages.people.delete}
      </button>
    </div>
  );
}

/** The Custom tab: the character's own field values, read from the shared field engine. */
function CustomFieldValues({ projectId, characterId }: { projectId: UUID; characterId: UUID }) {
  const session = useSessionStore((state) => state.session);
  const values = useQuery({
    queryKey: ["characterFields", session?.name ?? null, projectId, characterId],
    enabled: session !== null,
    queryFn: async () => {
      if (!session) throw new Error("no session");
      const defs = await session.driver.query<{ id: string; label: string }>(
        `SELECT id, label FROM custom_field_def
          WHERE project_id = ? AND target_type = 'character' AND deleted_at IS NULL
          ORDER BY order_key`,
        [projectId],
      );
      const rows = await session.driver.query<{ def_id: string; value: string }>(
        "SELECT def_id, value FROM custom_field_value WHERE owner_type = 'character' AND owner_id = ?",
        [characterId],
      );
      const byDef = new Map(rows.map((row) => [row.def_id, row.value]));
      return defs.map((def) => {
        const raw = byDef.get(def.id);
        let text = "";
        if (raw !== undefined) {
          try {
            const parsed: unknown = JSON.parse(raw);
            text = typeof parsed === "string" ? parsed : JSON.stringify(parsed);
          } catch {
            text = raw;
          }
        }
        return { id: def.id, label: def.label, text };
      });
    },
  });

  const rows = values.data ?? [];
  if (rows.length === 0) {
    return <p className="text-sm text-muted">{messages.dossier.customEmpty}</p>;
  }
  return (
    <dl className="flex flex-col gap-2" data-testid="sl-dossier-custom-values">
      {rows.map((row) => (
        <div key={row.id} className="flex flex-col">
          <dt className="text-xs font-medium tracking-wide text-muted uppercase">{row.label}</dt>
          <dd className="text-sm">{row.text}</dd>
        </div>
      ))}
    </dl>
  );
}
