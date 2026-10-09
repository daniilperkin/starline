import { formatBalance, gridCellKey, messages, type UUID } from "@starline/core";
import { useEffect, useRef, useState } from "react";

import {
  useCreatePlotline,
  usePlotlineBalance,
  usePlotlineGrid,
  useSetScenePlotline,
} from "./data";

const MIN_ZOOM = 0.6;
const MAX_ZOOM = 2;
const BASE_CELL = 34;

function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

/**
 * Plotline grid (spec §4.3.3): rows are plotlines, columns are the scenes in book order, a
 * filled dot marks an attachment and the beat is editable from the cell's panel. The header
 * line under each plotline is the balance statistic, with the spec's >25 % gap warning.
 *
 * Zoom is a CSS variable on the scroller (cells resize, nothing re-mounts) driven by the
 * buttons or a two-finger pinch — the pinch listener is native and non-passive, because React
 * registers touch handlers passively and cannot stop the page from scrolling under a pinch.
 */
export function PlotlineGrid({ projectId }: { projectId: UUID }) {
  const grid = usePlotlineGrid(projectId);
  const balance = usePlotlineBalance(projectId);
  const setPlotline = useSetScenePlotline();
  const createPlotline = useCreatePlotline();

  const [zoom, setZoom] = useState(1);
  const [selected, setSelected] = useState<{ plotlineId: UUID; sceneId: UUID } | null>(null);
  const [beat, setBeat] = useState("");
  const [newName, setNewName] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pinch = useRef<{ distance: number; zoom: number } | null>(null);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const distanceOf = (touches: TouchList): number => {
      const first = touches[0];
      const second = touches[1];
      if (!first || !second) return 0;
      return Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
    };
    const onStart = (event: TouchEvent) => {
      if (event.touches.length === 2) {
        pinch.current = { distance: distanceOf(event.touches), zoom };
      }
    };
    const onMove = (event: TouchEvent) => {
      if (event.touches.length !== 2 || !pinch.current) return;
      const distance = distanceOf(event.touches);
      if (pinch.current.distance <= 0) return;
      event.preventDefault();
      setZoom(clampZoom((pinch.current.zoom * distance) / pinch.current.distance));
    };
    const onEnd = () => {
      pinch.current = null;
    };
    node.addEventListener("touchstart", onStart, { passive: true });
    node.addEventListener("touchmove", onMove, { passive: false });
    node.addEventListener("touchend", onEnd, { passive: true });
    return () => {
      node.removeEventListener("touchstart", onStart);
      node.removeEventListener("touchmove", onMove);
      node.removeEventListener("touchend", onEnd);
    };
  }, [zoom]);

  const scenes = grid.data?.scenes ?? [];
  const plotlines = grid.data?.plotlines ?? [];
  const cells = grid.data?.cells ?? {};
  const balanceById = new Map((balance.data ?? []).map((row) => [row.plotlineId, row]));

  const commitNewPlotline = () => {
    const name = newName.trim();
    if (name.length === 0) return;
    createPlotline.mutate({ projectId, name }, { onSuccess: () => setNewName("") });
  };

  const error = setPlotline.error ?? createPlotline.error;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">{messages.grid.hint}</p>

      <div className="flex items-center gap-2">
        <input
          className="sl-input min-w-0 flex-1"
          value={newName}
          placeholder={messages.grid.plotlineName}
          aria-label={messages.grid.plotlineName}
          data-testid="sl-grid-new-plotline"
          onChange={(event) => setNewName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") commitNewPlotline();
          }}
        />
        <button
          type="button"
          className="sl-btn"
          data-testid="sl-grid-add-plotline"
          disabled={newName.trim().length === 0 || createPlotline.isPending}
          onClick={commitNewPlotline}
        >
          {messages.grid.addPlotline}
        </button>
      </div>

      <div className="sl-grid-toolbar">
        <button
          type="button"
          className="sl-btn-small"
          aria-label={messages.grid.zoomOut}
          data-testid="sl-grid-zoom-out"
          onClick={() => setZoom((current) => clampZoom(current - 0.2))}
        >
          −
        </button>
        <button
          type="button"
          className="sl-btn-small"
          aria-label={`${messages.grid.zoomReset} — ${Math.round(zoom * 100)}%`}
          data-testid="sl-grid-zoom-reset"
          onClick={() => setZoom(1)}
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          type="button"
          className="sl-btn-small"
          aria-label={messages.grid.zoomIn}
          data-testid="sl-grid-zoom-in"
          onClick={() => setZoom((current) => clampZoom(current + 0.2))}
        >
          ＋
        </button>
        <span className="text-xs text-muted" data-testid="sl-grid-total">
          {messages.grid.total.replace("{count}", String(scenes.length))}
        </span>
      </div>

      {plotlines.length === 0 ? (
        <p className="text-sm text-muted">{messages.grid.empty}</p>
      ) : (
        <div className="sl-grid-scroll" ref={scrollRef} data-testid="sl-grid">
          <div
            className="sl-grid-inner"
            style={{ ["--sl-grid-cell" as string]: `${Math.round(BASE_CELL * zoom)}px` }}
          >
            <div className="sl-grid-row sl-grid-headrow">
              <div className="sl-grid-rowhead sl-grid-corner">{messages.grid.heading}</div>
              {scenes.map((scene) => (
                <div
                  key={scene.id}
                  className="sl-grid-colhead"
                  title={`${scene.chapterTitle ? `${scene.chapterTitle} · ` : ""}${scene.title}`}
                >
                  <span className="sl-grid-colnum">{scene.index + 1}</span>
                </div>
              ))}
            </div>

            {plotlines.map((plotline) => {
              const stats = balanceById.get(plotline.id);
              return (
                <div key={plotline.id} className="sl-grid-row" data-testid="sl-grid-row">
                  <div className="sl-grid-rowhead">
                    <span
                      className="sl-dot"
                      style={{ background: plotline.color }}
                      aria-hidden="true"
                    />
                    <span className="sl-grid-name" title={plotline.name}>
                      {plotline.name}
                    </span>
                    <span
                      className="sl-grid-balance"
                      data-warn={stats?.warn === true ? "true" : "false"}
                      data-testid="sl-grid-balance"
                      title={stats?.warn === true ? messages.grid.warnGap : undefined}
                    >
                      {stats ? formatBalance(stats) : ""}
                    </span>
                  </div>
                  {scenes.map((scene) => {
                    const cell = cells[gridCellKey(plotline.id, scene.id)];
                    const attached = cell !== undefined;
                    return (
                      <button
                        key={scene.id}
                        type="button"
                        className="sl-grid-cell"
                        data-attached={attached ? "true" : "false"}
                        data-testid="sl-grid-cell"
                        aria-label={
                          attached
                            ? messages.grid.detach
                                .replace("{plotline}", plotline.name)
                                .replace("{scene}", String(scene.index + 1))
                            : messages.grid.attach
                                .replace("{plotline}", plotline.name)
                                .replace("{scene}", String(scene.index + 1))
                        }
                        onClick={() => {
                          if (!attached) {
                            setPlotline.mutate({
                              projectId,
                              sceneId: scene.id,
                              plotlineId: plotline.id,
                              attached: true,
                            });
                            setSelected(null);
                            return;
                          }
                          setSelected({ plotlineId: plotline.id, sceneId: scene.id });
                          setBeat(cell?.beat ?? "");
                        }}
                      >
                        {attached ? (
                          <span
                            className="sl-grid-dot"
                            style={{ background: plotline.color }}
                            aria-hidden="true"
                          />
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {selected ? (
        <div className="sl-card sl-grid-beat" data-testid="sl-grid-beat">
          <label className="sl-label" htmlFor="grid-beat">
            {messages.grid.beat}
          </label>
          <input
            id="grid-beat"
            className="sl-input"
            value={beat}
            placeholder={messages.grid.beatPlaceholder}
            data-testid="sl-grid-beat-input"
            onChange={(event) => setBeat(event.target.value)}
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="sl-btn sl-btn-primary"
              data-testid="sl-grid-beat-save"
              onClick={() => {
                setPlotline.mutate(
                  {
                    projectId,
                    sceneId: selected.sceneId,
                    plotlineId: selected.plotlineId,
                    attached: true,
                    beat,
                  },
                  { onSuccess: () => setSelected(null) },
                );
              }}
            >
              {messages.relationships.save}
            </button>
            <button
              type="button"
              className="sl-btn sl-danger"
              data-testid="sl-grid-detach"
              onClick={() => {
                setPlotline.mutate(
                  {
                    projectId,
                    sceneId: selected.sceneId,
                    plotlineId: selected.plotlineId,
                    attached: false,
                  },
                  { onSuccess: () => setSelected(null) },
                );
              }}
            >
              {messages.grid.detachAction}
            </button>
          </div>
        </div>
      ) : null}

      {error ? <p className="sl-error">{error.message}</p> : null}
    </div>
  );
}
