import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  rectSortingStrategy,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  type ChapterSummary,
  messages,
  orderScenesBookWise,
  plural,
  SCENE_STATUS_COLORS,
  type SceneSummary,
  type UUID,
} from "@starline/core";
import { useNavigate } from "@tanstack/react-router";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useActiveProject } from "./active-project";
import {
  useCreateChapter,
  useCreateScene,
  useDeleteChapter,
  useDeleteScene,
  useMoveChapter,
  useMoveScene,
  useRestoreEntity,
  useSceneTree,
  useSetScenePlacement,
  useUpdateChapter,
} from "./data";
import { formatNumber } from "./locale";
import { useNavigationStore } from "./navigation";
import { PlotlineGrid } from "./PlotlineGrid";
import { SceneSheet } from "./SceneSheet";
import { useUndoStore } from "./undo";

interface SceneGroup {
  chapter: ChapterSummary | null;
  scenes: SceneSummary[];
}

/**
 * The Scenes tab (spec §4.3.2 list view, phone default): chapters → scene rows with inline
 * status/POV, the Unassigned pool pinned at the end, and a row menu that reorders and
 * reassigns chapters (the non-drag alternative required by the a11y rules).
 */
export function ScenesScreen() {
  const { project } = useActiveProject();
  const projectId = project?.id ?? null;
  const tree = useSceneTree(projectId);
  const navigate = useNavigate();
  const createScene = useCreateScene();
  const createChapter = useCreateChapter();
  const updateChapter = useUpdateChapter();
  const moveChapter = useMoveChapter();
  const deleteChapter = useDeleteChapter();
  const moveScene = useMoveScene();
  const deleteScene = useDeleteScene();
  const restore = useRestoreEntity();
  const setPlacement = useSetScenePlacement();
  const pushUndo = useUndoStore((state) => state.push);

  const [mode, setMode] = useState<"list" | "board" | "grid">("list");
  const [sheetSceneId, setSheetSceneId] = useState<UUID | null>(null);
  const [activeSceneId, setActiveSceneId] = useState<UUID | null>(null);
  const [sceneMenuFor, setSceneMenuFor] = useState<UUID | null>(null);
  const [moveMenuFor, setMoveMenuFor] = useState<UUID | null>(null);
  const [chapterMenuFor, setChapterMenuFor] = useState<UUID | null>(null);
  const [chapterDeleteConfirm, setChapterDeleteConfirm] = useState<UUID | null>(null);
  const [sceneDeleteConfirm, setSceneDeleteConfirm] = useState<UUID | null>(null);
  const [renamingChapter, setRenamingChapter] = useState<UUID | null>(null);
  const [renameText, setRenameText] = useState("");
  const [newChapterTitle, setNewChapterTitle] = useState("");

  // A search hit, backlink row or check item can ask for one specific scene (slice 7).
  const pendingTarget = useNavigationStore((state) => state.target);
  const clearTarget = useNavigationStore((state) => state.clear);
  useEffect(() => {
    if (pendingTarget?.kind !== "scene") return;
    setSheetSceneId(pendingTarget.id);
    clearTarget();
  }, [pendingTarget, clearTarget]);

  // Long-press (220 ms) drag on touch; a 6 px distance threshold for mouse so clicks pass
  // through. Keyboard users keep the row-menu move/reassign path — drag is never the only way
  // (spec §4.3.2 a11y rule).
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 10 } }),
  );

  const chapters = useMemo(() => tree.data?.chapters ?? [], [tree.data]);
  const scenes = useMemo(
    () => orderScenesBookWise(chapters, tree.data?.scenes ?? []),
    [tree.data, chapters],
  );
  const bookIndex = useMemo(() => {
    const map = new Map<UUID, number>();
    scenes.forEach((scene, index) => {
      map.set(scene.id, index + 1);
    });
    return map;
  }, [scenes]);
  const groups: SceneGroup[] = useMemo(() => {
    const known = new Set(chapters.map((chapter) => chapter.id));
    return [
      ...chapters.map((chapter) => ({
        chapter,
        scenes: scenes.filter((scene) => scene.chapterId === chapter.id),
      })),
      {
        chapter: null,
        scenes: scenes.filter((scene) => scene.chapterId === null || !known.has(scene.chapterId)),
      },
    ];
  }, [chapters, scenes]);

  const estimate = scenes.reduce((sum, scene) => sum + (scene.targetWordCount ?? 0), 0);

  if (projectId === null) {
    return <p className="text-sm text-muted">{messages.common.loading}</p>;
  }

  const closeMenus = () => {
    setSceneMenuFor(null);
    setMoveMenuFor(null);
    setChapterMenuFor(null);
    setChapterDeleteConfirm(null);
    setSceneDeleteConfirm(null);
  };

  const moveSceneBy = async (scene: SceneSummary, group: SceneGroup, direction: -1 | 1) => {
    const index = group.scenes.findIndex((candidate) => candidate.id === scene.id);
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= group.scenes.length) return;
    const beforeSceneId =
      direction === -1
        ? (group.scenes[targetIndex]?.id ?? null)
        : (group.scenes[targetIndex + 1]?.id ?? null);
    const previous = { chapterId: scene.chapterId, orderKey: scene.orderKey };
    closeMenus();
    try {
      await moveScene.mutateAsync({
        projectId,
        sceneId: scene.id,
        chapterId: scene.chapterId,
        beforeSceneId,
      });
      pushUndo(messages.undo.sceneMoved, async () => {
        await setPlacement.mutateAsync({ projectId, sceneId: scene.id, ...previous });
      });
    } catch {
      // The query cache refresh surfaces the failure; nothing to undo.
    }
  };

  /** Chapter reassignment from the row menu — same undo shape as a reorder. */
  const reassignScene = async (scene: SceneSummary, chapterId: UUID | null) => {
    const previous = { chapterId: scene.chapterId, orderKey: scene.orderKey };
    closeMenus();
    try {
      await moveScene.mutateAsync({ projectId, sceneId: scene.id, chapterId, beforeSceneId: null });
      pushUndo(messages.undo.sceneMoved, async () => {
        await setPlacement.mutateAsync({ projectId, sceneId: scene.id, ...previous });
      });
    } catch {
      // The query cache refresh surfaces the failure; nothing to undo.
    }
  };

  // Long-press (220 ms) drag on touch; a 6 px distance threshold for mouse so clicks pass
  // through. Keyboard users keep the row-menu move/reassign path — drag is never the only way
  // (spec §4.3.2 a11y rule).
  const activeScene = scenes.find((scene) => scene.id === activeSceneId) ?? null;

  /** Reorder within the same group; the target index decides the `beforeSceneId` insertion. */
  const onDragEnd = (event: DragEndEvent) => {
    setActiveSceneId(null);
    const { active, over } = event;
    if (over === null || active.id === over.id) return;
    const group = groups.find((candidate) =>
      candidate.scenes.some((scene) => scene.id === active.id),
    );
    if (!group) return;
    const activeIndex = group.scenes.findIndex((scene) => scene.id === active.id);
    const overIndex = group.scenes.findIndex((scene) => scene.id === over.id);
    if (activeIndex === -1 || overIndex === -1) return;
    const scene = group.scenes[activeIndex];
    if (scene === undefined) return;
    const beforeSceneId =
      overIndex > activeIndex
        ? (group.scenes[overIndex + 1]?.id ?? null)
        : (group.scenes[overIndex]?.id ?? null);
    const previous = { chapterId: scene.chapterId, orderKey: scene.orderKey };
    void moveScene
      .mutateAsync({ projectId, sceneId: scene.id, chapterId: scene.chapterId, beforeSceneId })
      .then(() => {
        pushUndo(messages.undo.sceneMoved, async () => {
          await setPlacement.mutateAsync({ projectId, sceneId: scene.id, ...previous });
        });
      })
      .catch(() => undefined);
  };

  const moveChapterBy = (chapter: ChapterSummary, direction: -1 | 1) => {
    const index = chapters.findIndex((candidate) => candidate.id === chapter.id);
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= chapters.length) return;
    if (direction === -1) {
      moveChapter.mutate({
        projectId,
        chapterId: chapter.id,
        beforeChapterId: chapters[targetIndex]?.id ?? null,
      });
    } else {
      moveChapter.mutate({
        projectId,
        chapterId: chapter.id,
        beforeChapterId: chapters[targetIndex + 1]?.id ?? null,
      });
    }
    closeMenus();
  };

  return (
    <div className="flex flex-1 flex-col gap-4">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{messages.scenes.heading}</h1>
          <p className="text-sm text-muted" data-testid="sl-scenes-count">
            {plural(messages.scenes.sceneCount, scenes.length)} ·{" "}
            {plural(messages.scenes.wordsEst, estimate, { words: formatNumber(estimate) })}
          </p>
        </div>
        <fieldset className="sl-segmented sl-fieldset">
          <legend className="sr-only">{messages.grid.heading}</legend>
          {(["list", "board", "grid"] as const).map((option) => (
            <button
              key={option}
              type="button"
              className="sl-segment"
              aria-pressed={mode === option}
              data-testid={`sl-scenes-${option}`}
              onClick={() => setMode(option)}
            >
              {option === "list"
                ? messages.grid.list
                : option === "board"
                  ? messages.grid.board
                  : messages.grid.grid}
            </button>
          ))}
        </fieldset>
      </header>

      {mode === "grid" ? (
        <PlotlineGrid projectId={projectId} />
      ) : mode === "board" ? (
        <SceneBoard
          groups={groups}
          bookIndex={bookIndex}
          onOpen={(sceneId) => setSheetSceneId(sceneId)}
          sensors={sensors}
          onActivate={setActiveSceneId}
          onDragEnd={onDragEnd}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="sl-btn"
              disabled={createScene.isPending}
              onClick={() => createScene.mutate({ projectId, chapterId: null })}
            >
              + {messages.scenes.newScene}
            </button>
            <div className="flex flex-1 items-center gap-2">
              <input
                className="sl-input min-w-0 flex-1"
                value={newChapterTitle}
                placeholder={messages.scenes.newChapter}
                aria-label={messages.scenes.newChapter}
                onChange={(event) => setNewChapterTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && newChapterTitle.trim().length > 0) {
                    createChapter.mutate({ projectId, title: newChapterTitle.trim() });
                    setNewChapterTitle("");
                  }
                }}
              />
              <button
                type="button"
                className="sl-btn"
                disabled={newChapterTitle.trim().length === 0 || createChapter.isPending}
                onClick={() => {
                  createChapter.mutate({ projectId, title: newChapterTitle.trim() });
                  setNewChapterTitle("");
                }}
              >
                {messages.scenes.addChapter}
              </button>
            </div>
          </div>

          {scenes.length === 0 && chapters.length === 0 ? (
            <p className="text-sm text-muted">{messages.scenes.empty}</p>
          ) : null}

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={(event) => setActiveSceneId(event.active.id as UUID)}
            onDragEnd={onDragEnd}
          >
            {groups.map((group) => {
              const chapter = group.chapter;
              const groupWords = group.scenes.reduce(
                (sum, scene) =>
                  sum +
                  (scene.bodyWordCount > 0 ? scene.bodyWordCount : (scene.targetWordCount ?? 0)),
                0,
              );
              return (
                <section key={chapter?.id ?? "unassigned"} className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    {chapter !== null && renamingChapter === chapter.id ? (
                      <input
                        className="sl-input min-w-0 flex-1"
                        value={renameText}
                        aria-label={messages.scenes.chapterRenamed}
                        onChange={(event) => setRenameText(event.target.value)}
                        onBlur={() => {
                          const title = renameText.trim();
                          if (title.length > 0 && title !== chapter.title) {
                            updateChapter.mutate({
                              projectId,
                              chapterId: chapter.id,
                              patch: { title },
                            });
                          }
                          setRenamingChapter(null);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") (event.target as HTMLInputElement).blur();
                          if (event.key === "Escape") setRenamingChapter(null);
                        }}
                      />
                    ) : (
                      <h2 className="min-w-0 flex-1 truncate text-sm font-semibold tracking-wide uppercase">
                        {chapter !== null ? chapter.title : messages.scenes.unassigned}
                      </h2>
                    )}
                    <span className="shrink-0 text-xs text-muted">
                      {plural(messages.scenes.sceneCount, group.scenes.length)} ·{" "}
                      {plural(messages.scenes.wordsEst, groupWords, {
                        words: formatNumber(groupWords),
                      })}
                    </span>
                    {chapter !== null ? (
                      <button
                        type="button"
                        className="sl-btn sl-btn-small"
                        aria-label={`${chapter.title} ⋯`}
                        onClick={() => {
                          setChapterMenuFor(chapterMenuFor === chapter.id ? null : chapter.id);
                          setSceneMenuFor(null);
                          setMoveMenuFor(null);
                          setChapterDeleteConfirm(null);
                        }}
                      >
                        ⋯
                      </button>
                    ) : null}
                  </div>

                  {chapter !== null && chapterMenuFor === chapter.id ? (
                    <div className="sl-row-menu">
                      <button
                        type="button"
                        className="sl-btn sl-btn-small"
                        onClick={() => moveChapterBy(chapter, -1)}
                      >
                        ↑ {messages.scenes.moveUp}
                      </button>
                      <button
                        type="button"
                        className="sl-btn sl-btn-small"
                        onClick={() => moveChapterBy(chapter, 1)}
                      >
                        ↓ {messages.scenes.moveDown}
                      </button>
                      <button
                        type="button"
                        className="sl-btn sl-btn-small"
                        onClick={() => {
                          setRenamingChapter(chapter.id);
                          setRenameText(chapter.title);
                          closeMenus();
                        }}
                      >
                        ✎ {messages.scenes.rename}
                      </button>
                      <button
                        type="button"
                        className="sl-btn sl-btn-small"
                        data-danger={chapterDeleteConfirm === chapter.id}
                        onClick={() => {
                          if (chapterDeleteConfirm !== chapter.id) {
                            setChapterDeleteConfirm(chapter.id);
                            window.setTimeout(() => setChapterDeleteConfirm(null), 2500);
                            return;
                          }
                          // Capture the chapter's scenes + their keys first: deleteChapter moves
                          // them to Unassigned, so a real undo restores the chapter and puts every
                          // scene back where it was (spec §2.3.3 undo).
                          const placement = group.scenes.map((scene) => ({
                            sceneId: scene.id,
                            orderKey: scene.orderKey,
                          }));
                          closeMenus();
                          void deleteChapter
                            .mutateAsync({ projectId, chapterId: chapter.id })
                            .then(() => {
                              pushUndo(messages.undo.chapterDeleted, async () => {
                                await restore.mutateAsync({
                                  projectId,
                                  entityType: "chapter",
                                  entityId: chapter.id,
                                });
                                for (const item of placement) {
                                  await setPlacement.mutateAsync({
                                    projectId,
                                    sceneId: item.sceneId,
                                    chapterId: chapter.id,
                                    orderKey: item.orderKey,
                                  });
                                }
                              });
                            })
                            .catch(() => undefined);
                        }}
                      >
                        {chapterDeleteConfirm === chapter.id
                          ? plural(messages.scenes.chapterDeleteConfirm, group.scenes.length)
                          : `✕ ${messages.scenes.delete}`}
                      </button>
                    </div>
                  ) : null}

                  <SortableContext
                    items={group.scenes.map((candidate) => candidate.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <ul className="flex flex-col gap-1.5">
                      {group.scenes.map((scene) => (
                        <SortableSceneRow key={scene.id} id={scene.id}>
                          {({ listeners, isDragging }) => (
                            <>
                              <div className="sl-scene-line" data-dragging={isDragging}>
                                <button
                                  type="button"
                                  className="sl-scene-line-main"
                                  {...listeners}
                                  onClick={() => setSheetSceneId(scene.id)}
                                >
                                  <span className="w-6 shrink-0 text-right text-xs text-muted tabular-nums">
                                    {bookIndex.get(scene.id) ?? ""}
                                  </span>
                                  <span className="min-w-0 flex-1 truncate text-sm">
                                    {scene.title.length > 0
                                      ? scene.title
                                      : scene.synopsis.text.length > 0
                                        ? scene.synopsis.text
                                        : messages.sceneSheet.titlePlaceholder}
                                  </span>
                                  <span className="shrink-0 text-xs text-muted">
                                    {scene.povName ?? messages.scenes.noPov}
                                  </span>
                                  <span
                                    className="sl-chip shrink-0"
                                    style={{ color: SCENE_STATUS_COLORS[scene.status] }}
                                  >
                                    {messages.scenes.status[scene.status]}
                                  </span>
                                  <span className="w-16 shrink-0 text-right text-xs text-muted tabular-nums">
                                    {scene.bodyWordCount > 0
                                      ? formatNumber(scene.bodyWordCount)
                                      : scene.targetWordCount !== null
                                        ? `≈${formatNumber(scene.targetWordCount)}`
                                        : ""}
                                  </span>
                                </button>
                                <button
                                  type="button"
                                  className="sl-btn sl-btn-small"
                                  aria-label={`⋯ ${scene.title || scene.synopsis.text}`}
                                  onClick={() => {
                                    setSceneMenuFor(sceneMenuFor === scene.id ? null : scene.id);
                                    setMoveMenuFor(null);
                                    setSceneDeleteConfirm(null);
                                    setChapterMenuFor(null);
                                  }}
                                >
                                  ⋯
                                </button>
                              </div>

                              {sceneMenuFor === scene.id ? (
                                <div className="sl-row-menu">
                                  <button
                                    type="button"
                                    className="sl-btn sl-btn-small"
                                    data-testid={`sl-scene-write-${scene.id}`}
                                    onClick={() => {
                                      closeMenus();
                                      void navigate({
                                        to: "/write/$sceneId",
                                        params: { sceneId: scene.id },
                                      });
                                    }}
                                  >
                                    ✍ {messages.write.action}
                                  </button>
                                  <button
                                    type="button"
                                    className="sl-btn sl-btn-small"
                                    onClick={() => void moveSceneBy(scene, group, -1)}
                                  >
                                    ↑ {messages.scenes.moveUp}
                                  </button>
                                  <button
                                    type="button"
                                    className="sl-btn sl-btn-small"
                                    onClick={() => void moveSceneBy(scene, group, 1)}
                                  >
                                    ↓ {messages.scenes.moveDown}
                                  </button>
                                  <button
                                    type="button"
                                    className="sl-btn sl-btn-small"
                                    onClick={() =>
                                      setMoveMenuFor(moveMenuFor === scene.id ? null : scene.id)
                                    }
                                  >
                                    ⇥ {messages.scenes.moveToChapter}
                                  </button>
                                  <button
                                    type="button"
                                    className="sl-btn sl-btn-small"
                                    data-danger={sceneDeleteConfirm === scene.id}
                                    onClick={() => {
                                      if (sceneDeleteConfirm !== scene.id) {
                                        setSceneDeleteConfirm(scene.id);
                                        window.setTimeout(() => setSceneDeleteConfirm(null), 2500);
                                        return;
                                      }
                                      closeMenus();
                                      void deleteScene
                                        .mutateAsync({ projectId, sceneId: scene.id })
                                        .then(() => {
                                          pushUndo(messages.undo.sceneDeleted, async () => {
                                            await restore.mutateAsync({
                                              projectId,
                                              entityType: "scene",
                                              entityId: scene.id,
                                            });
                                          });
                                        })
                                        .catch(() => undefined);
                                    }}
                                  >
                                    {sceneDeleteConfirm === scene.id
                                      ? messages.scenes.deleteConfirm
                                      : `✕ ${messages.scenes.delete}`}
                                  </button>
                                </div>
                              ) : null}

                              {moveMenuFor === scene.id ? (
                                <div className="sl-row-menu">
                                  {chapters
                                    .filter((candidate) => candidate.id !== scene.chapterId)
                                    .map((candidate) => (
                                      <button
                                        key={candidate.id}
                                        type="button"
                                        className="sl-btn sl-btn-small"
                                        onClick={() => void reassignScene(scene, candidate.id)}
                                      >
                                        {candidate.title}
                                      </button>
                                    ))}
                                  {scene.chapterId !== null ? (
                                    <button
                                      type="button"
                                      className="sl-btn sl-btn-small"
                                      onClick={() => void reassignScene(scene, null)}
                                    >
                                      {messages.scenes.moveToUnassigned}
                                    </button>
                                  ) : null}
                                </div>
                              ) : null}
                            </>
                          )}
                        </SortableSceneRow>
                      ))}
                    </ul>
                  </SortableContext>
                </section>
              );
            })}
            <DragOverlay dropAnimation={null}>
              {activeScene !== null ? (
                <div className="sl-card p-3 text-sm shadow-lg">
                  {activeScene.title.length > 0
                    ? activeScene.title
                    : activeScene.synopsis.text.length > 0
                      ? activeScene.synopsis.text
                      : messages.sceneSheet.titlePlaceholder}
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        </>
      )}

      {sheetSceneId !== null ? (
        <SceneSheet
          projectId={projectId}
          sceneId={sheetSceneId}
          onClose={() => setSheetSceneId(null)}
        />
      ) : null}
    </div>
  );
}

/**
 * One draggable scene row. The drag listeners ride the row's main button: long-press on touch
 * (TouchSensor delay), 6 px drag on mouse — a quick tap still opens the scene sheet. Keyboard
 * users keep the row-menu move/reassign path, so drag is never the only route (spec §4.3.2).
 */
function SortableSceneRow({
  id,
  children,
}: {
  id: UUID;
  children: (props: {
    listeners: Record<string, unknown> | undefined;
    isDragging: boolean;
  }) => ReactNode;
}) {
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <li
      ref={setNodeRef}
      className="flex flex-col"
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : undefined,
      }}
    >
      {children({
        listeners: listeners as Record<string, unknown> | undefined,
        isDragging,
      })}
    </li>
  );
}

/**
 * The corkboard (slice 21): the outline as cards, one per scene, grouped by chapter. Same data,
 * same drag machinery and same sheet as the list — the difference is what a writer can see at a
 * glance: a title, what the scene is about, and how far along it is. Drag order is the list's
 * order; the cards are the browsing view, and management (rename, delete, move) stays in the list
 * so there is exactly one place where a scene can be destroyed.
 */
function SceneBoard({
  groups,
  bookIndex,
  onOpen,
  sensors,
  onActivate,
  onDragEnd,
}: {
  groups: SceneGroup[];
  bookIndex: ReadonlyMap<UUID, number>;
  onOpen: (sceneId: UUID) => void;
  sensors: ReturnType<typeof useSensors>;
  onActivate: (sceneId: UUID) => void;
  onDragEnd: (event: DragEndEvent) => void;
}) {
  if (groups.every((group) => group.scenes.length === 0)) {
    return <p className="text-sm text-muted">{messages.scenes.empty}</p>;
  }
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={(event) => onActivate(event.active.id as UUID)}
      onDragEnd={onDragEnd}
    >
      {groups
        .filter((group) => group.scenes.length > 0)
        .map((group) => (
          <section key={group.chapter?.id ?? "unassigned"} className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <h2 className="min-w-0 flex-1 truncate text-sm font-semibold tracking-wide uppercase">
                {group.chapter !== null ? group.chapter.title : messages.scenes.unassigned}
              </h2>
              <span className="shrink-0 text-xs text-muted">
                {plural(messages.scenes.sceneCount, group.scenes.length)}
              </span>
            </div>
            <SortableContext
              items={group.scenes.map((candidate) => candidate.id)}
              strategy={rectSortingStrategy}
            >
              <ul className="sl-board" data-testid="sl-board-group">
                {group.scenes.map((scene) => (
                  <SortableSceneRow key={scene.id} id={scene.id}>
                    {({ listeners, isDragging }) => (
                      <div className="sl-scene-card flex-1" data-dragging={isDragging}>
                        <button
                          type="button"
                          className="sl-scene-card-main"
                          data-testid="sl-scene-card"
                          {...listeners}
                          onClick={() => onOpen(scene.id)}
                        >
                          <span className="sl-scene-card-head">
                            <span className="text-xs text-muted tabular-nums">
                              {bookIndex.get(scene.id) ?? ""}
                            </span>
                            <span
                              className="sl-chip shrink-0"
                              style={{ color: SCENE_STATUS_COLORS[scene.status] }}
                            >
                              {messages.scenes.status[scene.status]}
                            </span>
                          </span>
                          <span className="sl-scene-card-title">
                            {scene.title.length > 0
                              ? scene.title
                              : scene.synopsis.text.length > 0
                                ? scene.synopsis.text
                                : messages.sceneSheet.titlePlaceholder}
                          </span>
                          {scene.title.length > 0 && scene.synopsis.text.length > 0 ? (
                            <span className="sl-scene-card-excerpt">{scene.synopsis.text}</span>
                          ) : null}
                          <span className="sl-scene-card-meta">
                            <span>{scene.povName ?? messages.scenes.noPov}</span>
                            <span className="tabular-nums">
                              {scene.bodyWordCount > 0
                                ? formatNumber(scene.bodyWordCount)
                                : scene.targetWordCount !== null
                                  ? `≈${formatNumber(scene.targetWordCount)}`
                                  : ""}
                            </span>
                          </span>
                        </button>
                      </div>
                    )}
                  </SortableSceneRow>
                ))}
              </ul>
            </SortableContext>
          </section>
        ))}
    </DndContext>
  );
}
