import {
  formatStoryTimeFull,
  messages,
  parseStoryTimeInput,
  plural,
  positionFraction,
  TIMELINE_ZOOMS,
  type TimelineCalendar,
  type TimelineItem,
  type TimelineLane,
  timelineTicks,
  timelineWindow,
  type UUID,
  zoomById,
} from "@starline/core";
import { useMemo, useRef, useState } from "react";

import { useMoveTimelineItem, useTimeline, useTimelineCoverage } from "../data";
import { EventSheet } from "./EventSheet";

/** Width of the scrollable canvas; blocks are positioned as a fraction of it. */
const CANVAS_PX = 1800;
const MIN_BLOCK_PX = 46;

interface DragState {
  item: TimelineItem;
  laneId: string;
  startX: number;
  deltaX: number;
}

/**
 * Timeline v1 (spec §4.4.1): horizontal swimlanes — World, one per character with items, one
 * per plotline — with scenes placed by `storyTime` and timeline events beside them. Zoom runs
 * from hours to millennia off the project's own calendar, dragging a block rewrites its story
 * time in one row, and the tray at the bottom places scenes that have no time yet.
 */
export function TimelineView({ projectId }: { projectId: UUID }) {
  const timeline = useTimeline(projectId);
  const coverage = useTimelineCoverage(projectId);
  const moveItem = useMoveTimelineItem();

  const [zoomId, setZoomId] = useState("years");
  const [drag, setDrag] = useState<DragState | null>(null);
  const [sheetEventId, setSheetEventId] = useState<UUID | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [trayDraft, setTrayDraft] = useState<Record<string, string>>({});
  const [trayError, setTrayError] = useState<string | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);

  const zoom = zoomById(zoomId);
  const data = timeline.data;
  const calendar = data?.calendar ?? null;
  const window = useMemo(() => timelineWindow(data?.range ?? null, zoom), [data?.range, zoom]);
  const ticks = useMemo(
    () => (calendar ? timelineTicks(calendar, window.start, window.end, zoom, 6) : []),
    [calendar, window, zoom],
  );

  const pxPerSecond = CANVAS_PX / Math.max(1, window.end - window.start);
  const lanes = data?.lanes ?? [];

  const beginDrag = (laneId: string, item: TimelineItem, clientX: number) => {
    setDrag({ item, laneId, startX: clientX, deltaX: 0 });
  };

  const commitDrag = () => {
    if (!drag) return;
    const secondsDelta = Math.round(drag.deltaX / pxPerSecond);
    if (Math.abs(secondsDelta) >= 60) {
      moveItem.mutate({
        projectId,
        kind: drag.item.kind,
        id: drag.item.id,
        storyTime: drag.item.storyTime + secondsDelta,
      });
    }
    setDrag(null);
  };

  const placeScene = (sceneId: UUID) => {
    const text = trayDraft[sceneId] ?? "";
    if (!calendar) return;
    const seconds = parseStoryTimeInput(calendar, text);
    if (seconds === null) {
      setTrayError(messages.timeline.parseError);
      return;
    }
    setTrayError(null);
    moveItem.mutate(
      { projectId, kind: "scene", id: sceneId, storyTime: seconds },
      { onSuccess: () => setTrayDraft((current) => ({ ...current, [sceneId]: "" })) },
    );
  };

  const zoomIndex = TIMELINE_ZOOMS.findIndex((entry) => entry.id === zoomId);
  const stepZoom = (delta: number) => {
    const next =
      TIMELINE_ZOOMS[Math.min(TIMELINE_ZOOMS.length - 1, Math.max(0, zoomIndex + delta))];
    if (next) setZoomId(next.id);
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">{messages.timeline.hint}</p>

      <div className="sl-timeline-toolbar">
        <button
          type="button"
          className="sl-btn-small"
          aria-label={`${messages.timeline.zoom} −`}
          data-testid="sl-timeline-zoom-out"
          disabled={zoomIndex <= 0}
          onClick={() => stepZoom(-1)}
        >
          −
        </button>
        <select
          className="sl-select"
          aria-label={messages.timeline.zoom}
          data-testid="sl-timeline-zoom"
          value={zoomId}
          onChange={(event) => setZoomId(event.target.value)}
        >
          {TIMELINE_ZOOMS.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {messages.timeline.zooms[entry.id as keyof typeof messages.timeline.zooms]}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="sl-btn-small"
          aria-label={`${messages.timeline.zoom} +`}
          data-testid="sl-timeline-zoom-in"
          disabled={zoomIndex >= TIMELINE_ZOOMS.length - 1}
          onClick={() => stepZoom(1)}
        >
          ＋
        </button>
        <span className="text-xs text-muted" data-testid="sl-timeline-coverage">
          {plural(
            messages.timeline.coverage,
            (coverage.data?.placed ?? 0) + (coverage.data?.unplaced ?? 0),
            { placed: coverage.data?.placed ?? 0 },
          )}
        </span>
        <button
          type="button"
          className="sl-btn-small ml-auto"
          data-testid="sl-timeline-add-event"
          onClick={() => {
            setSheetEventId(null);
            setSheetOpen(true);
          }}
        >
          {messages.timeline.addEvent}
        </button>
      </div>

      {(data?.conflicts ?? []).length > 0 ? (
        <div className="sl-timeline-conflicts" data-testid="sl-timeline-conflicts" role="status">
          <p className="text-sm font-medium">{messages.timeline.conflicts}</p>
          <ul className="flex flex-col gap-1">
            {(data?.conflicts ?? []).map((conflict) => (
              <li key={`${conflict.sceneAId}:${conflict.sceneBId}`} className="text-xs">
                ⚠{" "}
                {messages.timeline.conflict
                  .replace("{name}", conflict.characterName)
                  .replace("{a}", conflict.sceneATitle)
                  .replace("{locationA}", conflict.sceneALocation)
                  .replace("{b}", conflict.sceneBTitle)
                  .replace("{locationB}", conflict.sceneBLocation)}
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted">{messages.timeline.conflictHint}</p>
        </div>
      ) : null}

      {lanes.every((lane) => lane.items.length === 0) ? (
        <div className="sl-card">
          <p className="text-sm font-medium">{messages.timeline.none}</p>
          <p className="text-xs text-muted">{messages.timeline.noneHint}</p>
        </div>
      ) : (
        <div className="sl-timeline-scroll" data-testid="sl-timeline">
          <div className="sl-timeline-canvas" style={{ width: `${CANVAS_PX}px` }}>
            <div className="sl-timeline-axis" data-testid="sl-timeline-axis">
              {ticks.map((tick) => (
                <span
                  key={tick.seconds}
                  className="sl-timeline-tick"
                  style={{ left: `${positionFraction(tick.seconds, window) * 100}%` }}
                >
                  {tick.label}
                </span>
              ))}
            </div>
            {lanes.map((lane) => (
              <TimelineLaneRow
                key={lane.id}
                lane={lane}
                window={window}
                calendar={calendar}
                drag={drag}
                onDragStart={beginDrag}
                onDragMove={(clientX) =>
                  setDrag((current) =>
                    current ? { ...current, deltaX: clientX - current.startX } : current,
                  )
                }
                onDragEnd={commitDrag}
                onOpen={(item) => {
                  if (item.kind !== "event") return;
                  setSheetEventId(item.id);
                  setSheetOpen(true);
                }}
                onTrackRef={(node) => {
                  trackRef.current = node;
                }}
              />
            ))}
          </div>
        </div>
      )}

      <div className="sl-card" data-testid="sl-timeline-tray">
        <p className="text-sm font-medium">{messages.timeline.noTime}</p>
        {(data?.noTime ?? []).length === 0 ? (
          <p className="text-xs text-muted">{messages.timeline.noTimeEmpty}</p>
        ) : (
          <>
            <p className="text-xs text-muted">{messages.timeline.noTimeHint}</p>
            <ul className="flex flex-col gap-2">
              {(data?.noTime ?? []).map((scene) => (
                <li key={scene.id} className="flex items-center gap-2" data-testid="sl-tray-row">
                  <span className="min-w-0 flex-1 truncate text-sm">{scene.title}</span>
                  <input
                    className="sl-input w-32"
                    value={trayDraft[scene.id] ?? ""}
                    placeholder={messages.timeline.storyTimePlaceholder}
                    aria-label={`${messages.timeline.storyTime} — ${scene.title}`}
                    data-testid="sl-tray-input"
                    onChange={(event) =>
                      setTrayDraft((current) => ({ ...current, [scene.id]: event.target.value }))
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter") placeScene(scene.id);
                    }}
                  />
                  <button
                    type="button"
                    className="sl-btn-small"
                    data-testid="sl-tray-place"
                    onClick={() => placeScene(scene.id)}
                  >
                    {messages.timeline.place}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        {trayError ? <p className="sl-error">{trayError}</p> : null}
        {moveItem.error ? <p className="sl-error">{moveItem.error.message}</p> : null}
      </div>

      {sheetOpen && calendar ? (
        <EventSheet
          projectId={projectId}
          calendar={calendar}
          eventId={sheetEventId}
          onClose={() => setSheetOpen(false)}
        />
      ) : null}
    </div>
  );
}

function TimelineLaneRow({
  lane,
  window,
  calendar,
  drag,
  onDragStart,
  onDragMove,
  onDragEnd,
  onOpen,
  onTrackRef,
}: {
  lane: TimelineLane;
  window: { start: number; end: number };
  calendar: TimelineCalendar | null;
  drag: DragState | null;
  onDragStart: (laneId: string, item: TimelineItem, clientX: number) => void;
  onDragMove: (clientX: number) => void;
  onDragEnd: () => void;
  onOpen: (item: TimelineItem) => void;
  onTrackRef: (node: HTMLDivElement | null) => void;
}) {
  return (
    <div className="sl-timeline-lane" data-testid="sl-timeline-lane">
      <span className="sl-timeline-lane-label" title={lane.label}>
        {lane.color ? (
          <span className="sl-dot" style={{ background: lane.color }} aria-hidden="true" />
        ) : null}
        {lane.label}
      </span>
      <div className="sl-timeline-track" ref={onTrackRef}>
        {lane.items.map((item) => {
          const dragging = drag?.item.id === item.id && drag.laneId === lane.id;
          const offset = dragging ? drag.deltaX : 0;
          const left = positionFraction(item.storyTime, window) * 100;
          const span =
            item.storyTimeEnd === null
              ? 0
              : (item.storyTimeEnd - item.storyTime) * (100 / (window.end - window.start));
          const label = item.title.trim().length > 0 ? item.title : messages.timeline.sceneBadge;
          const formatted = calendar ? formatStoryTimeFull(calendar, item.storyTime) : "";
          return (
            <button
              key={`${item.kind}:${item.id}`}
              type="button"
              className="sl-timeline-block"
              data-kind={item.kind}
              data-testid="sl-timeline-block"
              data-dragging={dragging ? "true" : "false"}
              style={{
                left: `calc(${left}% + ${offset}px)`,
                minWidth: `${MIN_BLOCK_PX}px`,
                width: span > 0 ? `max(${MIN_BLOCK_PX}px, ${span}%)` : undefined,
                borderColor: item.kind === "event" ? (item.color ?? undefined) : undefined,
              }}
              title={`${label} — ${formatted}`}
              aria-label={`${label}, ${formatted}`}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                onDragStart(lane.id, item, event.clientX);
              }}
              onPointerMove={(event) => {
                if (drag?.item.id !== item.id) return;
                onDragMove(event.clientX);
              }}
              onPointerUp={() => onDragEnd()}
              onPointerCancel={() => onDragEnd()}
              onClick={() => onOpen(item)}
            >
              <span className="sl-timeline-block-label">{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
