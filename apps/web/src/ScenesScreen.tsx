import {
  type ChapterSummary,
  format,
  messages,
  orderScenesBookWise,
  SCENE_STATUS_COLORS,
  type SceneSummary,
  type UUID,
} from "@starline/core";
import { useMemo, useState } from "react";
import {
  useCreateChapter,
  useCreateScene,
  useDeleteChapter,
  useDeleteScene,
  useMoveChapter,
  useMoveScene,
  useProjects,
  useSceneTree,
  useUpdateChapter,
} from "./data";
import { SceneSheet } from "./SceneSheet";

const numberFormat = new Intl.NumberFormat();

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
  const projects = useProjects();
  const project = projects.data?.[0] ?? null;
  const projectId = project?.id ?? null;
  const tree = useSceneTree(projectId);
  const createScene = useCreateScene();
  const createChapter = useCreateChapter();
  const updateChapter = useUpdateChapter();
  const moveChapter = useMoveChapter();
  const deleteChapter = useDeleteChapter();
  const moveScene = useMoveScene();
  const deleteScene = useDeleteScene();

  const [sheetSceneId, setSheetSceneId] = useState<UUID | null>(null);
  const [sceneMenuFor, setSceneMenuFor] = useState<UUID | null>(null);
  const [moveMenuFor, setMoveMenuFor] = useState<UUID | null>(null);
  const [chapterMenuFor, setChapterMenuFor] = useState<UUID | null>(null);
  const [chapterDeleteConfirm, setChapterDeleteConfirm] = useState<UUID | null>(null);
  const [sceneDeleteConfirm, setSceneDeleteConfirm] = useState<UUID | null>(null);
  const [renamingChapter, setRenamingChapter] = useState<UUID | null>(null);
  const [renameText, setRenameText] = useState("");
  const [newChapterTitle, setNewChapterTitle] = useState("");

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

  const moveSceneBy = (scene: SceneSummary, group: SceneGroup, direction: -1 | 1) => {
    const index = group.scenes.findIndex((candidate) => candidate.id === scene.id);
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= group.scenes.length) return;
    if (direction === -1) {
      const before = group.scenes[targetIndex];
      moveScene.mutate({
        projectId,
        sceneId: scene.id,
        chapterId: scene.chapterId,
        beforeSceneId: before?.id ?? null,
      });
    } else {
      const before = group.scenes[targetIndex + 1]?.id ?? null;
      moveScene.mutate({
        projectId,
        sceneId: scene.id,
        chapterId: scene.chapterId,
        beforeSceneId: before,
      });
    }
    closeMenus();
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
          <p className="text-sm text-muted">
            {format(messages.scenes.sceneCount, { n: scenes.length })} ·{" "}
            {format(messages.scenes.wordsEst, { words: numberFormat.format(estimate) })}
          </p>
        </div>
      </header>

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

      {groups.map((group) => {
        const chapter = group.chapter;
        const groupWords = group.scenes.reduce(
          (sum, scene) =>
            sum + (scene.bodyWordCount > 0 ? scene.bodyWordCount : (scene.targetWordCount ?? 0)),
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
                      updateChapter.mutate({ projectId, chapterId: chapter.id, patch: { title } });
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
                {format(messages.scenes.sceneCount, { n: group.scenes.length })} ·{" "}
                {format(messages.scenes.wordsEst, { words: numberFormat.format(groupWords) })}
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
                    deleteChapter.mutate({ projectId, chapterId: chapter.id });
                    closeMenus();
                  }}
                >
                  {chapterDeleteConfirm === chapter.id
                    ? format(messages.scenes.chapterDeleteConfirm, { n: group.scenes.length })
                    : `✕ ${messages.scenes.delete}`}
                </button>
              </div>
            ) : null}

            <ul className="flex flex-col gap-1.5">
              {group.scenes.map((scene) => (
                <li key={scene.id} className="flex flex-col">
                  <div className="sl-scene-line">
                    <button
                      type="button"
                      className="sl-scene-line-main"
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
                          ? numberFormat.format(scene.bodyWordCount)
                          : scene.targetWordCount !== null
                            ? `≈${numberFormat.format(scene.targetWordCount)}`
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
                        onClick={() => moveSceneBy(scene, group, -1)}
                      >
                        ↑ {messages.scenes.moveUp}
                      </button>
                      <button
                        type="button"
                        className="sl-btn sl-btn-small"
                        onClick={() => moveSceneBy(scene, group, 1)}
                      >
                        ↓ {messages.scenes.moveDown}
                      </button>
                      <button
                        type="button"
                        className="sl-btn sl-btn-small"
                        onClick={() => setMoveMenuFor(moveMenuFor === scene.id ? null : scene.id)}
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
                          deleteScene.mutate({ projectId, sceneId: scene.id });
                          closeMenus();
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
                            onClick={() => {
                              moveScene.mutate({
                                projectId,
                                sceneId: scene.id,
                                chapterId: candidate.id,
                                beforeSceneId: null,
                              });
                              closeMenus();
                            }}
                          >
                            {candidate.title}
                          </button>
                        ))}
                      {scene.chapterId !== null ? (
                        <button
                          type="button"
                          className="sl-btn sl-btn-small"
                          onClick={() => {
                            moveScene.mutate({
                              projectId,
                              sceneId: scene.id,
                              chapterId: null,
                              beforeSceneId: null,
                            });
                            closeMenus();
                          }}
                        >
                          {messages.scenes.moveToUnassigned}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        );
      })}

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
