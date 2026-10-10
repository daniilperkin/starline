import { format, messages, type UUID } from "@starline/core";
import { useEffect } from "react";
import { useSceneTree } from "../data";

/**
 * The writing-mode scene switcher (PLAN slice 13): the whole book in reading order — parts,
 * chapters, the unassigned pool last — so a writer can jump without leaving the keyboard. Rows
 * carry the live word count, and the current scene is marked rather than repeated.
 */
export function SceneSwitcher({
  projectId,
  currentSceneId,
  onPick,
  onClose,
}: {
  projectId: UUID;
  currentSceneId: UUID;
  onPick: (sceneId: UUID) => void;
  onClose: () => void;
}) {
  const tree = useSceneTree(projectId);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const parts = tree.data?.parts ?? [];
  const chapters = tree.data?.chapters ?? [];
  const scenes = tree.data?.scenes ?? [];

  // Chapter order is the book order; a scene outside any chapter belongs to the pool at the end.
  const rows: Array<{
    key: string;
    heading: string | null;
    sceneId: UUID;
    label: string;
    words: number;
  }> = [];
  const partName = (partId: UUID | null): string =>
    partId === null ? "" : (parts.find((part) => part.id === partId)?.title ?? "");
  for (const chapter of chapters) {
    const chapterScenes = scenes.filter((scene) => scene.chapterId === chapter.id);
    if (chapterScenes.length === 0) continue;
    rows.push({
      key: `chapter-${chapter.id}`,
      heading: [partName(chapter.partId), chapter.title].filter(Boolean).join(" · "),
      sceneId: chapterScenes[0]?.id as UUID,
      label: "",
      words: 0,
    });
    for (const scene of chapterScenes) {
      rows.push({
        key: scene.id,
        heading: null,
        sceneId: scene.id,
        label:
          scene.title.trim() ||
          scene.synopsis.text.split("\n")[0]?.trim() ||
          messages.write.untitled,
        words: scene.bodyWordCount,
      });
    }
  }
  const pooled = scenes.filter(
    (scene) =>
      scene.chapterId === null || !chapters.some((chapter) => chapter.id === scene.chapterId),
  );
  if (pooled.length > 0) {
    rows.push({
      key: "pool",
      heading: messages.scenes.unassigned,
      sceneId: pooled[0]?.id as UUID,
      label: "",
      words: 0,
    });
    for (const scene of pooled) {
      rows.push({
        key: scene.id,
        heading: null,
        sceneId: scene.id,
        label:
          scene.title.trim() ||
          scene.synopsis.text.split("\n")[0]?.trim() ||
          messages.write.untitled,
        words: scene.bodyWordCount,
      });
    }
  }

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
        aria-label={messages.write.scenesHeading}
      >
        <header className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold tracking-tight">{messages.write.scenesHeading}</h2>
          <button
            type="button"
            className="sl-btn"
            aria-label={messages.common.close}
            onClick={onClose}
          >
            ✕
          </button>
        </header>
        {tree.data === undefined ? (
          <p className="text-sm text-muted">{messages.common.loading}</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted">{messages.write.noScenes}</p>
        ) : (
          <ul className="sl-write-switcher" data-testid="sl-switcher">
            {rows.map((row) =>
              row.heading !== null ? (
                <li key={row.key} className="sl-write-switcher-heading">
                  {row.heading}
                </li>
              ) : (
                <li key={row.key}>
                  <button
                    type="button"
                    data-scene-id={row.sceneId}
                    className={
                      row.sceneId === currentSceneId
                        ? "sl-write-switcher-row sl-write-switcher-current"
                        : "sl-write-switcher-row"
                    }
                    aria-current={row.sceneId === currentSceneId ? "true" : undefined}
                    onClick={() => onPick(row.sceneId)}
                  >
                    <span className="truncate">{row.label}</span>
                    <span className="sl-write-switcher-words">
                      {format(messages.scenes.words, {
                        words: String(row.words),
                      })}
                    </span>
                  </button>
                </li>
              ),
            )}
          </ul>
        )}
      </section>
    </>
  );
}
