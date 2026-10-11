import {
  defaultDirected,
  MAX_SENTIMENT,
  MIN_SENTIMENT,
  messages,
  plural,
  RELATIONSHIP_KIND_GLYPHS,
  RELATIONSHIP_KINDS,
  type RelationshipCharacter,
  type RelationshipEdge,
  type RelationshipGroupSummary,
  type RelationshipKind,
  richTextFromPlain,
  type SceneSummary,
  type UUID,
} from "@starline/core";
import { useEffect, useRef, useState } from "react";

import {
  useCreateRelationship,
  useDeleteRelationship,
  useSharedScenes,
  useUpdateRelationship,
} from "../data";
import { useUndoStore } from "../undo";

/**
 * Add/edit one relationship (PLAN slice 8, spec §4.2.3 "Create edge" popover grown into the
 * phone-sized sheet): character pair, kind, sentiment, direction, secrecy, group, lifetime and
 * notes. Everything is local state until Save — a slider drag must not fire a command per pixel.
 */
export interface EdgeSheetProps {
  projectId: UUID;
  characters: RelationshipCharacter[];
  groups: RelationshipGroupSummary[];
  scenes: SceneSummary[];
  /** Prefill for a new edge (matrix cell, node drag, dossier "add relationship"). */
  initial?: { sourceId?: UUID | null; targetId?: UUID | null };
  /** The edge being edited; absent = creating. */
  edge?: RelationshipEdge | null;
  onClose: () => void;
}

export function EdgeSheet({
  projectId,
  characters,
  groups,
  scenes,
  initial,
  edge = null,
  onClose,
}: EdgeSheetProps) {
  const editing = edge !== null;
  const [sourceId, setSourceId] = useState<UUID | "">(edge?.sourceId ?? initial?.sourceId ?? "");
  const [targetId, setTargetId] = useState<UUID | "">(edge?.targetId ?? initial?.targetId ?? "");
  const [kind, setKind] = useState<RelationshipKind>(edge?.kind ?? "friend");
  const [customLabel, setCustomLabel] = useState(edge?.customLabel ?? "");
  const [sentiment, setSentiment] = useState(edge?.sentiment ?? 0);
  const [directed, setDirected] = useState(
    edge?.directed ?? defaultDirected(edge?.kind ?? "friend"),
  );
  const [secret, setSecret] = useState(edge?.secret ?? false);
  const [groupId, setGroupId] = useState<UUID | "">(edge?.groupId ?? "");
  const [startsAt, setStartsAt] = useState<UUID | "">(edge?.startsAtSceneId ?? "");
  const [endsAt, setEndsAt] = useState<UUID | "">(edge?.endsAtSceneId ?? "");
  const [notes, setNotes] = useState(edge?.notes.text ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const create = useCreateRelationship();
  const update = useUpdateRelationship();
  const remove = useDeleteRelationship();
  const pushUndo = useUndoStore((state) => state.push);
  const shared = useSharedScenes(projectId, sourceId || null, targetId || null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const nameOf = (id: UUID | "") =>
    characters.find((character) => character.id === id)?.name ?? "—";
  const canSave = sourceId !== "" && targetId !== "" && sourceId !== targetId;

  const onSave = async () => {
    if (!canSave || busy) return;
    setBusy(true);
    setError(null);
    try {
      const notesRich = richTextFromPlain(notes);
      const patch = {
        kind,
        customLabel,
        directed,
        sentiment,
        secret,
        groupId: groupId === "" ? null : groupId,
        startsAtSceneId: startsAt === "" ? null : startsAt,
        endsAtSceneId: endsAt === "" ? null : endsAt,
        notes: notesRich,
      };
      if (editing && edge) {
        await update.mutateAsync({ projectId, relationshipId: edge.id, patch });
      } else {
        await create.mutateAsync({ projectId, sourceId, targetId, ...patch });
      }
      onClose();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message.includes("already exists") ? messages.relationships.duplicate : message);
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async () => {
    if (!edge || busy) return;
    setBusy(true);
    try {
      await remove.mutateAsync({ projectId, relationshipId: edge.id });
      pushUndo(messages.relationships.deleted, async () => {
        await create.mutateAsync({
          projectId,
          sourceId: edge.sourceId,
          targetId: edge.targetId,
          kind: edge.kind,
          customLabel: edge.customLabel,
          directed: edge.directed,
          sentiment: edge.sentiment,
          secret: edge.secret,
          groupId: edge.groupId,
          startsAtSceneId: edge.startsAtSceneId,
          endsAtSceneId: edge.endsAtSceneId,
          notes: edge.notes,
        });
      });
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className="sl-sheet-backdrop"
        aria-label={messages.relationships.close}
        onClick={onClose}
      />
      <section
        className="sl-sheet sl-edge-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={editing ? messages.relationships.edit : messages.relationships.add}
        data-testid="sl-edge-sheet"
      >
        <header className="flex items-center gap-2">
          <h2 ref={headingRef} tabIndex={-1} className="text-base font-semibold">
            {editing ? messages.relationships.edit : messages.relationships.add}
          </h2>
          <button type="button" className="sl-btn-small ml-auto" onClick={onClose}>
            {messages.relationships.close}
          </button>
        </header>

        <div className="sl-edge-pair">
          <div className="sl-field">
            <label className="sl-label" htmlFor="sl-edge-from">
              {messages.relationships.from}
            </label>
            <select
              id="sl-edge-from"
              className="sl-input"
              value={sourceId}
              onChange={(event) => setSourceId(event.target.value as UUID)}
            >
              <option value="">{messages.relationships.pickTwo}</option>
              {characters.map((character) => (
                <option key={character.id} value={character.id}>
                  {character.name}
                </option>
              ))}
            </select>
          </div>
          <div className="sl-field">
            <label className="sl-label" htmlFor="sl-edge-to">
              {messages.relationships.to}
            </label>
            <select
              id="sl-edge-to"
              className="sl-input"
              value={targetId}
              onChange={(event) => setTargetId(event.target.value as UUID)}
            >
              <option value="">{messages.relationships.pickTwo}</option>
              {characters.map((character) => (
                <option key={character.id} value={character.id}>
                  {character.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {sourceId !== "" && targetId !== "" && sourceId !== targetId ? (
          <p className="sl-edge-pair-hint" data-testid="sl-edge-shared">
            {nameOf(sourceId)} {messages.relationships.pairSeparator} {nameOf(targetId)} ·{" "}
            {shared.data && shared.data.total > 0
              ? plural(messages.relationships.sharedScenes, shared.data.total)
              : messages.relationships.none}
          </p>
        ) : null}

        <div className="sl-edge-fields">
          <div className="sl-field">
            <label className="sl-label" htmlFor="sl-edge-kind">
              {messages.relationships.kind}
            </label>
            <select
              id="sl-edge-kind"
              className="sl-input"
              value={kind}
              onChange={(event) => {
                const next = event.target.value as RelationshipKind;
                setKind(next);
                setDirected(defaultDirected(next));
              }}
            >
              {RELATIONSHIP_KINDS.map((option) => (
                <option key={option} value={option}>
                  {RELATIONSHIP_KIND_GLYPHS[option]} {messages.relationshipKinds[option]}
                </option>
              ))}
            </select>
          </div>

          {kind === "custom" ? (
            <div className="sl-field">
              <label className="sl-label" htmlFor="sl-edge-label">
                {messages.relationships.customLabel}
              </label>
              <input
                id="sl-edge-label"
                className="sl-input"
                placeholder={messages.relationships.customLabelPlaceholder}
                value={customLabel}
                onChange={(event) => setCustomLabel(event.target.value)}
              />
            </div>
          ) : null}

          <label className="sl-field">
            <span className="sl-label">
              {messages.relationships.sentiment}:{" "}
              {messages.relationships.feelings[String(sentiment) as "-5"]}
            </span>
            <input
              className="sl-slider"
              type="range"
              min={MIN_SENTIMENT}
              max={MAX_SENTIMENT}
              step={1}
              value={sentiment}
              onChange={(event) => setSentiment(Number(event.target.value))}
              data-testid="sl-edge-sentiment"
            />
            <span className="text-xs text-muted">{messages.relationships.sentimentHint}</span>
          </label>

          <div className="sl-edge-toggles">
            <label className="sl-check">
              <input
                type="checkbox"
                checked={directed}
                onChange={(event) => setDirected(event.target.checked)}
              />
              {messages.relationships.directed}
            </label>
            <label className="sl-check">
              <input
                type="checkbox"
                checked={secret}
                onChange={(event) => setSecret(event.target.checked)}
                data-testid="sl-edge-secret"
              />
              {messages.relationships.secret}
            </label>
          </div>

          <div className="sl-field">
            <label className="sl-label" htmlFor="sl-edge-group">
              {messages.relationships.group}
            </label>
            <select
              id="sl-edge-group"
              className="sl-input"
              value={groupId}
              onChange={(event) => setGroupId(event.target.value as UUID)}
            >
              <option value="">{messages.relationships.noGroup}</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
          </div>

          <div className="sl-edge-pair">
            <div className="sl-field">
              <label className="sl-label" htmlFor="sl-edge-start">
                {messages.relationships.startsAt}
              </label>
              <select
                id="sl-edge-start"
                className="sl-input"
                value={startsAt}
                onChange={(event) => setStartsAt(event.target.value as UUID)}
              >
                <option value="">{messages.relationships.openEnded}</option>
                {scenes.map((scene) => (
                  <option key={scene.id} value={scene.id}>
                    {scene.title}
                  </option>
                ))}
              </select>
            </div>
            <div className="sl-field">
              <label className="sl-label" htmlFor="sl-edge-end">
                {messages.relationships.endsAt}
              </label>
              <select
                id="sl-edge-end"
                className="sl-input"
                value={endsAt}
                onChange={(event) => setEndsAt(event.target.value as UUID)}
              >
                <option value="">{messages.relationships.openEnded}</option>
                {scenes.map((scene) => (
                  <option key={scene.id} value={scene.id}>
                    {scene.title}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="sl-field">
            <label className="sl-label" htmlFor="sl-edge-notes">
              {messages.relationships.notes}
            </label>
            <textarea
              id="sl-edge-notes"
              className="sl-input sl-textarea"
              rows={3}
              placeholder={messages.relationships.notesPlaceholder}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>
        </div>

        {error ? (
          <p className="sl-error" role="alert">
            {error}
          </p>
        ) : null}

        <footer className="sl-edge-actions">
          {editing ? (
            <button
              type="button"
              className="sl-btn-small sl-danger"
              onClick={() => void onDelete()}
              disabled={busy}
              data-testid="sl-edge-delete"
            >
              {messages.relationships.delete}
            </button>
          ) : null}
          <button
            type="button"
            className="sl-btn ml-auto"
            onClick={() => void onSave()}
            disabled={!canSave || busy}
            data-testid="sl-edge-save"
          >
            {messages.relationships.save}
          </button>
        </footer>
      </section>
    </>
  );
}
