import {
  formatStoryTimeInput,
  messages,
  parseStoryTimeInput,
  TAG_COLORS,
  type TimelineCalendar,
  type TimelineEventItem,
  type TimelineLaneKind,
  type UUID,
} from "@starline/core";
import { useState } from "react";

import {
  useCharacters,
  useCreateTimelineEvent,
  useDeleteTimelineEvent,
  usePlotlines,
  useTimeline,
  useUpdateTimelineEvent,
} from "../data";
import { useUndoStore } from "../undo";

/**
 * The timeline event editor (spec §4.4.1). Same sheet pattern as the scene and lore sheets:
 * local draft until Save, one command per save, delete with an undo toast that restores the
 * same row (the inverse is `createTimelineEvent` with the captured fields).
 */
export function EventSheet({
  projectId,
  calendar,
  eventId,
  onClose,
}: {
  projectId: UUID;
  calendar: TimelineCalendar;
  eventId: UUID | null;
  onClose: () => void;
}) {
  const timeline = useTimeline(projectId);
  const characters = useCharacters(projectId);
  const plotlines = usePlotlines(projectId);
  const create = useCreateTimelineEvent();
  const update = useUpdateTimelineEvent();
  const remove = useDeleteTimelineEvent();
  const pushUndo = useUndoStore((state) => state.push);

  const existing =
    eventId === null
      ? null
      : ((timeline.data?.lanes ?? [])
          .flatMap((lane) => lane.items)
          .find(
            (item): item is TimelineEventItem => item.kind === "event" && item.id === eventId,
          ) ?? null);

  const [title, setTitle] = useState(existing?.title ?? "");
  const [lane, setLane] = useState<TimelineLaneKind>(existing?.lane ?? "world");
  const [characterId, setCharacterId] = useState<string>(existing?.characterId ?? "");
  const [plotlineId, setPlotlineId] = useState<string>(existing?.plotlineId ?? "");
  const [storyTime, setStoryTime] = useState(
    existing ? formatStoryTimeInput(calendar, existing.storyTime) : "",
  );
  const [storyTimeEnd, setStoryTimeEnd] = useState(
    existing?.storyTimeEnd ? formatStoryTimeInput(calendar, existing.storyTimeEnd) : "",
  );
  const [label, setLabel] = useState(existing?.storyTimeLabel ?? "");
  const [color, setColor] = useState<string | null>(existing?.color ?? null);
  const [description, setDescription] = useState(existing?.description ?? "");
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const busy = create.isPending || update.isPending || remove.isPending;

  const onSave = () => {
    const start = parseStoryTimeInput(calendar, storyTime);
    if (start === null) {
      setError(messages.timeline.parseError);
      return;
    }
    const end =
      storyTimeEnd.trim().length === 0 ? null : parseStoryTimeInput(calendar, storyTimeEnd);
    if (storyTimeEnd.trim().length > 0 && end === null) {
      setError(messages.timeline.parseError);
      return;
    }
    setError(null);
    if (existing === null) {
      create.mutate(
        {
          projectId,
          title: title.trim(),
          lane,
          storyTime: start,
          storyTimeEnd: end,
          storyTimeLabel: label.trim(),
          characterId: lane === "character" ? (characterId as UUID) : null,
          plotlineId: lane === "plot" ? (plotlineId as UUID) : null,
          color,
          description,
        },
        { onSuccess: () => onClose() },
      );
      return;
    }
    update.mutate(
      {
        projectId,
        eventId: existing.id,
        patch: {
          title: title.trim(),
          storyTime: start,
          storyTimeEnd: end,
          storyTimeLabel: label.trim(),
          color,
          description,
        },
      },
      { onSuccess: () => onClose() },
    );
  };

  const onDelete = () => {
    if (existing === null) return;
    const captured = {
      projectId,
      title: existing.title,
      lane: existing.lane,
      storyTime: existing.storyTime,
      storyTimeEnd: existing.storyTimeEnd,
      storyTimeLabel: existing.storyTimeLabel,
      characterId: existing.characterId,
      plotlineId: existing.plotlineId,
      color: existing.color,
      description: existing.description,
    };
    remove.mutate(
      { projectId, eventId: existing.id },
      {
        onSuccess: () => {
          // Undo is a real command, not a state flip: recreate the row with the captured fields.
          pushUndo(messages.timeline.deleted, async () => {
            await create.mutateAsync(captured);
          });
          onClose();
        },
      },
    );
  };

  return (
    <>
      <button
        type="button"
        className="sl-sheet-backdrop"
        aria-label={messages.timeline.close}
        onClick={onClose}
      />
      <section
        className="sl-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={existing === null ? messages.timeline.addEvent : messages.timeline.editEvent}
        data-testid="sl-event-sheet"
      >
        <header className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold tracking-tight">
            {existing === null ? messages.timeline.addEvent : messages.timeline.editEvent}
          </h2>
          <button
            type="button"
            className="sl-btn"
            aria-label={messages.timeline.close}
            onClick={onClose}
          >
            ✕
          </button>
        </header>

        <div className="flex flex-col gap-3">
          <div className="sl-field">
            <label className="sl-label" htmlFor="event-title">
              {messages.timeline.eventTitle}
            </label>
            <input
              id="event-title"
              className="sl-input"
              value={title}
              placeholder={messages.timeline.eventTitlePlaceholder}
              data-testid="sl-event-title"
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>

          {existing === null ? (
            <>
              <div className="sl-field">
                <label className="sl-label" htmlFor="event-lane">
                  {messages.timeline.lane}
                </label>
                <select
                  id="event-lane"
                  className="sl-select"
                  value={lane}
                  data-testid="sl-event-lane"
                  onChange={(event) => setLane(event.target.value as TimelineLaneKind)}
                >
                  <option value="world">{messages.timeline.world}</option>
                  <option value="character">{messages.timeline.character}</option>
                  <option value="plot">{messages.timeline.plotline}</option>
                </select>
              </div>

              {lane === "character" ? (
                <div className="sl-field">
                  <label className="sl-label" htmlFor="event-character">
                    {messages.timeline.character}
                  </label>
                  <select
                    id="event-character"
                    className="sl-select"
                    value={characterId}
                    data-testid="sl-event-character"
                    onChange={(event) => setCharacterId(event.target.value)}
                  >
                    <option value="">—</option>
                    {(characters.data ?? []).map((character) => (
                      <option key={character.id} value={character.id}>
                        {character.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              {lane === "plot" ? (
                <div className="sl-field">
                  <label className="sl-label" htmlFor="event-plotline">
                    {messages.timeline.plotline}
                  </label>
                  <select
                    id="event-plotline"
                    className="sl-select"
                    value={plotlineId}
                    data-testid="sl-event-plotline"
                    onChange={(event) => setPlotlineId(event.target.value)}
                  >
                    <option value="">—</option>
                    {(plotlines.data ?? []).map((plotline) => (
                      <option key={plotline.id} value={plotline.id}>
                        {plotline.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
            </>
          ) : null}

          <div className="sl-field">
            <label className="sl-label" htmlFor="event-time">
              {messages.timeline.storyTime}
            </label>
            <input
              id="event-time"
              className="sl-input"
              value={storyTime}
              placeholder={messages.timeline.storyTimePlaceholder}
              data-testid="sl-event-time"
              onChange={(event) => setStoryTime(event.target.value)}
            />
            <p className="text-xs text-muted">{messages.timeline.storyTimeHint}</p>
          </div>

          <div className="sl-field">
            <label className="sl-label" htmlFor="event-end">
              {messages.timeline.duration}
            </label>
            <input
              id="event-end"
              className="sl-input"
              value={storyTimeEnd}
              placeholder={messages.timeline.durationHint}
              data-testid="sl-event-end"
              onChange={(event) => setStoryTimeEnd(event.target.value)}
            />
          </div>

          <div className="sl-field">
            <label className="sl-label" htmlFor="event-label">
              {messages.timeline.label}
            </label>
            <input
              id="event-label"
              className="sl-input"
              value={label}
              placeholder={messages.timeline.labelPlaceholder}
              data-testid="sl-event-label"
              onChange={(event) => setLabel(event.target.value)}
            />
          </div>

          <fieldset className="sl-fieldset">
            <legend className="sl-label">{messages.timeline.color}</legend>
            <div className="sl-swatches">
              {TAG_COLORS.map((swatch) => (
                <button
                  key={swatch}
                  type="button"
                  className="sl-swatch"
                  style={{ background: swatch }}
                  aria-pressed={color === swatch}
                  aria-label={`${messages.timeline.color} ${swatch}`}
                  data-testid="sl-event-color"
                  onClick={() => setColor(color === swatch ? null : swatch)}
                />
              ))}
            </div>
          </fieldset>

          <div className="sl-field">
            <label className="sl-label" htmlFor="event-notes">
              {messages.timeline.description}
            </label>
            <textarea
              id="event-notes"
              className="sl-textarea"
              rows={3}
              value={description}
              data-testid="sl-event-notes"
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
        </div>

        {error ? <p className="sl-error">{error}</p> : null}

        <div className="flex items-center gap-2">
          <button
            type="button"
            className="sl-btn sl-btn-primary"
            data-testid="sl-event-save"
            disabled={busy || title.trim().length === 0 || storyTime.trim().length === 0}
            onClick={onSave}
          >
            {messages.timeline.save}
          </button>
          {existing !== null ? (
            <button
              type="button"
              className="sl-btn sl-danger"
              data-testid="sl-event-delete"
              disabled={busy}
              onClick={() => {
                if (!confirmDelete) {
                  setConfirmDelete(true);
                  return;
                }
                onDelete();
              }}
            >
              {confirmDelete ? `${messages.timeline.delete}?` : messages.timeline.delete}
            </button>
          ) : null}
        </div>
      </section>
    </>
  );
}
