import {
  messages,
  PLOTLINE_KINDS,
  type RichText,
  SCENE_OUTCOMES,
  SCENE_STATUSES,
  type SceneDetail,
  type SceneDraft,
  TIME_OF_DAY_OPTIONS,
  type UUID,
} from "@starline/core";
import { useEffect, useState } from "react";
import { CustomFieldsSection } from "./CustomFields";
import {
  useCharacters,
  useCreatePlotline,
  useDeleteScene,
  usePlotlines,
  useRestoreEntity,
  useSceneDetail,
  useSetSceneCharacters,
  useSetScenePlotline,
  useUpdateScene,
} from "./data";
import { TagPicker } from "./TagPicker";
import { useUndoStore } from "./undo";
import { useAutosave } from "./useAutosave";

type SheetDraft = SceneDraft & { synopsis: RichText };

function draftOf(detail: SceneDetail): SheetDraft {
  return {
    title: detail.title,
    status: detail.status,
    povCharacterId: detail.povCharacterId,
    locationId: detail.locationId,
    objective: detail.objective,
    obstacle: detail.obstacle,
    outcome: detail.outcome,
    outcomeNote: detail.outcomeNote,
    emotionStart: detail.emotionStart,
    emotionEnd: detail.emotionEnd,
    storyTime: detail.storyTime,
    storyTimeLabel: detail.storyTimeLabel,
    timeOfDay: detail.timeOfDay,
    targetWordCount: detail.targetWordCount,
    synopsis: detail.synopsis,
  };
}

/**
 * The scene editor as a full-height sheet (spec §4.3.4 field order, minus the draft body
 * which arrives with the writing slice). Scalar fields autosave through one debounced
 * `updateScene`; joins (cast, plotlines, tags) write immediately on tap.
 */
export function SceneSheet({
  projectId,
  sceneId,
  onClose,
}: {
  projectId: UUID;
  sceneId: UUID;
  onClose: () => void;
}) {
  const detail = useSceneDetail(projectId, sceneId);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <button
        type="button"
        className="sl-sheet-backdrop"
        aria-label={messages.common.close}
        onClick={onClose}
      />
      <section
        className="sl-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={messages.sceneSheet.heading}
      >
        {detail.data ? (
          <SceneSheetBody
            key={sceneId}
            projectId={projectId}
            detail={detail.data}
            onClose={onClose}
          />
        ) : (
          <p className="text-sm text-muted">{messages.common.loading}</p>
        )}
      </section>
    </>
  );
}

function SceneSheetBody({
  projectId,
  detail,
  onClose,
}: {
  projectId: UUID;
  detail: SceneDetail;
  onClose: () => void;
}) {
  const sceneId = detail.id;
  const characters = useCharacters(projectId);
  const plotlines = usePlotlines(projectId);
  const updateScene = useUpdateScene();
  const deleteScene = useDeleteScene();
  const restore = useRestoreEntity();
  const pushUndo = useUndoStore((state) => state.push);
  const setCharacters = useSetSceneCharacters();
  const setPlotline = useSetScenePlotline();
  const createPlotline = useCreatePlotline();

  const [draft, setDraft] = useState<SheetDraft>(() => draftOf(detail));
  const [newPlotline, setNewPlotline] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const flush = useAutosave(draft, async (value) => {
    try {
      await updateScene.mutateAsync({ projectId, sceneId, patch: value });
      return true;
    } catch {
      return false;
    }
  });

  const patch = (partial: Partial<SheetDraft>) =>
    setDraft((previous) => ({ ...previous, ...partial }));

  const toggleCharacter = (characterId: UUID) => {
    const current = new Set(detail.presentCharacterIds);
    if (current.has(characterId)) current.delete(characterId);
    else current.add(characterId);
    setCharacters.mutate({ projectId, sceneId, characterIds: [...current] });
  };

  const onDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    await flush();
    await deleteScene.mutateAsync({ projectId, sceneId });
    pushUndo(messages.undo.sceneDeleted, async () => {
      await restore.mutateAsync({ projectId, entityType: "scene", entityId: sceneId });
    });
    onClose();
  };

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight">{messages.sceneSheet.heading}</h2>
        <button
          type="button"
          className="sl-btn"
          aria-label={messages.common.close}
          onClick={onClose}
        >
          ✕
        </button>
      </header>

      <div className="flex flex-col gap-1">
        <label className="sl-label" htmlFor="scene-title">
          {messages.sceneSheet.title}
        </label>
        <input
          id="scene-title"
          className="sl-input"
          value={draft.title}
          placeholder={messages.sceneSheet.titlePlaceholder}
          aria-label={messages.sceneSheet.title}
          onChange={(event) => patch({ title: event.target.value })}
        />
      </div>

      <div className="flex gap-3">
        <div className="flex flex-1 flex-col gap-1">
          <label className="sl-label" htmlFor="scene-status">
            {messages.sceneSheet.status}
          </label>
          <select
            id="scene-status"
            className="sl-select"
            value={draft.status}
            aria-label={messages.sceneSheet.status}
            onChange={(event) => patch({ status: event.target.value as SceneDraft["status"] })}
          >
            {SCENE_STATUSES.map((status) => (
              <option key={status} value={status}>
                {messages.scenes.status[status]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-1 flex-col gap-1">
          <label className="sl-label" htmlFor="scene-pov">
            {messages.sceneSheet.pov}
          </label>
          <select
            id="scene-pov"
            className="sl-select"
            value={draft.povCharacterId ?? ""}
            aria-label={messages.sceneSheet.pov}
            onChange={(event) =>
              patch({
                povCharacterId: event.target.value === "" ? null : (event.target.value as UUID),
              })
            }
          >
            <option value="">{messages.sceneSheet.povNone}</option>
            {(characters.data ?? []).map((character) => (
              <option key={character.id} value={character.id}>
                {character.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <span className="sl-label">{messages.sceneSheet.location}</span>
        {detail.locationName !== null ? (
          <span className="sl-chip w-fit">{detail.locationName}</span>
        ) : (
          <p className="text-xs text-muted">{messages.sceneSheet.locationEmpty}</p>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <span className="sl-label">{messages.sceneSheet.characters}</span>
        {(characters.data ?? []).length === 0 ? (
          <p className="text-xs text-muted">{messages.sceneSheet.charactersEmpty}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {(characters.data ?? []).map((character) => {
              const present = detail.presentCharacterIds.includes(character.id);
              return (
                <button
                  key={character.id}
                  type="button"
                  className="sl-chip-toggle"
                  data-on={present}
                  aria-pressed={present}
                  onClick={() => toggleCharacter(character.id)}
                >
                  {character.name}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label className="sl-label" htmlFor="scene-objective">
          {messages.sceneSheet.objective}
        </label>
        <textarea
          id="scene-objective"
          className="sl-textarea"
          rows={2}
          value={draft.objective}
          placeholder={messages.sceneSheet.objectivePlaceholder}
          aria-label={messages.sceneSheet.objective}
          onChange={(event) => patch({ objective: event.target.value })}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="sl-label" htmlFor="scene-obstacle">
          {messages.sceneSheet.obstacle}
        </label>
        <textarea
          id="scene-obstacle"
          className="sl-textarea"
          rows={2}
          value={draft.obstacle}
          placeholder={messages.sceneSheet.obstaclePlaceholder}
          aria-label={messages.sceneSheet.obstacle}
          onChange={(event) => patch({ obstacle: event.target.value })}
        />
      </div>

      <fieldset className="sl-fieldset">
        <legend className="sl-label">{messages.sceneSheet.outcome}</legend>
        <div className="sl-seg">
          {SCENE_OUTCOMES.map((outcome) => (
            <button
              key={outcome}
              type="button"
              className="sl-seg-item"
              data-on={draft.outcome === outcome}
              aria-pressed={draft.outcome === outcome}
              onClick={() => patch({ outcome })}
            >
              {messages.outcomes[outcome]}
            </button>
          ))}
        </div>
        <input
          className="sl-input mt-1"
          value={draft.outcomeNote}
          placeholder={messages.sceneSheet.outcomeNotePlaceholder}
          aria-label={messages.sceneSheet.outcomeNote}
          onChange={(event) => patch({ outcomeNote: event.target.value })}
        />
      </fieldset>

      <div className="flex gap-3">
        <div className="flex flex-1 flex-col gap-1">
          <label className="sl-label" htmlFor="scene-emotion-start">
            {messages.sceneSheet.emotionStart}
          </label>
          <input
            id="scene-emotion-start"
            className="sl-input"
            value={draft.emotionStart}
            placeholder={messages.sceneSheet.emotionPlaceholder}
            aria-label={messages.sceneSheet.emotionStart}
            onChange={(event) => patch({ emotionStart: event.target.value })}
          />
        </div>
        <div className="flex flex-1 flex-col gap-1">
          <label className="sl-label" htmlFor="scene-emotion-end">
            {messages.sceneSheet.emotionEnd}
          </label>
          <input
            id="scene-emotion-end"
            className="sl-input"
            value={draft.emotionEnd}
            placeholder={messages.sceneSheet.emotionPlaceholder}
            aria-label={messages.sceneSheet.emotionEnd}
            onChange={(event) => patch({ emotionEnd: event.target.value })}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <span className="sl-label">{messages.sceneSheet.plotlines}</span>
        {(plotlines.data ?? []).length === 0 ? (
          <p className="text-xs text-muted">{messages.sceneSheet.plotlinesEmpty}</p>
        ) : (
          <div className="flex flex-col gap-2">
            {(plotlines.data ?? []).map((plotline) => {
              const attached = detail.plotlines.find((entry) => entry.plotlineId === plotline.id);
              return (
                <div key={plotline.id} className="flex flex-col gap-1">
                  <button
                    type="button"
                    className="sl-chip-toggle w-fit"
                    data-on={attached !== undefined}
                    aria-pressed={attached !== undefined}
                    onClick={() =>
                      setPlotline.mutate({
                        projectId,
                        sceneId,
                        plotlineId: plotline.id,
                        attached: attached === undefined,
                        beat: attached?.beat ?? "",
                      })
                    }
                  >
                    {plotline.name} · {messages.plotlineKinds[plotline.kind]}
                  </button>
                  {attached !== undefined ? (
                    <input
                      className="sl-input"
                      defaultValue={attached.beat}
                      placeholder={messages.sceneSheet.beatPlaceholder}
                      aria-label={`${plotline.name} ${messages.sceneSheet.beatPlaceholder}`}
                      onBlur={(event) => {
                        const beat = event.target.value.trim();
                        if (beat !== attached.beat) {
                          setPlotline.mutate({
                            projectId,
                            sceneId,
                            plotlineId: plotline.id,
                            attached: true,
                            beat,
                          });
                        }
                      }}
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
        <div className="mt-1 flex gap-2">
          <input
            className="sl-input flex-1"
            value={newPlotline}
            placeholder={messages.sceneSheet.plotlineNamePlaceholder}
            aria-label={messages.sceneSheet.newPlotline}
            onChange={(event) => setNewPlotline(event.target.value)}
          />
          <button
            type="button"
            className="sl-btn"
            disabled={newPlotline.trim().length === 0 || createPlotline.isPending}
            onClick={() => {
              const name = newPlotline.trim();
              if (name.length === 0) return;
              void createPlotline
                .mutateAsync({ projectId, name, kind: PLOTLINE_KINDS[1] })
                .then((result) => {
                  setNewPlotline("");
                  return setPlotline.mutateAsync({
                    projectId,
                    sceneId,
                    plotlineId: result.plotlineId,
                    attached: true,
                  });
                });
            }}
          >
            {messages.sceneSheet.plotlineCreate}
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <span className="sl-label">{messages.sceneSheet.lore}</span>
        <p className="text-xs text-muted">{messages.sceneSheet.loreEmpty}</p>
      </div>

      <div className="flex gap-3">
        <div className="flex flex-1 flex-col gap-1">
          <label className="sl-label" htmlFor="scene-story-time">
            {messages.sceneSheet.storyTime}
          </label>
          <input
            id="scene-story-time"
            className="sl-input"
            type="number"
            step="any"
            value={draft.storyTime ?? ""}
            placeholder={messages.sceneSheet.storyTimePlaceholder}
            aria-label={messages.sceneSheet.storyTime}
            onChange={(event) => {
              const raw = event.target.value;
              patch({ storyTime: raw === "" ? null : Number(raw) });
            }}
          />
        </div>
        <div className="flex flex-1 flex-col gap-1">
          <label className="sl-label" htmlFor="scene-story-label">
            {messages.sceneSheet.storyTimeLabel}
          </label>
          <input
            id="scene-story-label"
            className="sl-input"
            value={draft.storyTimeLabel}
            placeholder={messages.sceneSheet.storyTimeLabelPlaceholder}
            aria-label={messages.sceneSheet.storyTimeLabel}
            onChange={(event) => patch({ storyTimeLabel: event.target.value })}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className="sl-label" htmlFor="scene-time-of-day">
          {messages.sceneSheet.timeOfDay}
        </label>
        <select
          id="scene-time-of-day"
          className="sl-select"
          value={draft.timeOfDay}
          aria-label={messages.sceneSheet.timeOfDay}
          onChange={(event) => patch({ timeOfDay: event.target.value as SceneDraft["timeOfDay"] })}
        >
          {TIME_OF_DAY_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {messages.timeOfDay[option]}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <span className="sl-label">{messages.sceneSheet.tags}</span>
        <TagPicker projectId={projectId} entityType="scene" entityId={sceneId} />
      </div>

      <CustomFieldsSection
        projectId={projectId}
        ownerType="scene"
        target="scene"
        ownerId={sceneId}
        legend={messages.fieldDefs.heading}
      />

      <div className="flex flex-col gap-1">
        <label className="sl-label" htmlFor="scene-target-words">
          {messages.sceneSheet.targetWords}
        </label>
        <input
          id="scene-target-words"
          className="sl-input w-32"
          type="number"
          min={0}
          inputMode="numeric"
          value={draft.targetWordCount ?? ""}
          aria-label={messages.sceneSheet.targetWords}
          onChange={(event) => {
            const raw = event.target.value;
            patch({
              targetWordCount: raw === "" ? null : Number.parseInt(raw, 10) || 0,
            });
          }}
        />
      </div>

      <div className="mt-2 flex justify-between gap-2 border-t border-line pt-4">
        <button
          type="button"
          className="sl-btn"
          data-danger={confirmDelete}
          onClick={() => void onDelete()}
        >
          {confirmDelete ? messages.scenes.deleteConfirm : messages.sceneSheet.deleteScene}
        </button>
        <button type="button" className="sl-btn sl-btn-primary" onClick={onClose}>
          {messages.common.close}
        </button>
      </div>
    </div>
  );
}
