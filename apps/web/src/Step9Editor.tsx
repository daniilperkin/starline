import {
  blockingIssues,
  format,
  messages,
  orderScenesBookWise,
  type RichText,
  type SceneContextInfo,
  type SnowflakeStepRow,
  type Step9Content,
  StepBlockedError,
  type UUID,
  type ValidationIssue,
  validateStep9,
} from "@starline/core";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useActiveProject } from "./active-project";
import {
  useCompleteStep,
  useCopyLineToSynopsis,
  useSaveStep,
  useSceneTree,
  useUpdateScene,
} from "./data";
import { IssueList } from "./IssueList";
import { PromptsSheet } from "./PromptsSheet";
import { RichTextEditor } from "./RichTextEditor";
import { useAutosave } from "./useAutosave";

/**
 * Step 9 — scene narratives (spec §4.1 point 8): an accordion over the scene list; each scene
 * expands into its synopsis editor with the "Copy to scene synopsis" trigger (spec §3.4.3).
 * Completion is tracked by `expandedSceneIds`; the step is optional by design (S9_* are info
 * only), so nothing here ever blocks a writer who skips it.
 */
export function Step9Editor({ projectId, row }: { projectId: UUID; row: SnowflakeStepRow }) {
  const navigate = useNavigate();
  const { project } = useActiveProject();
  const tree = useSceneTree(projectId);
  const saveStep = useSaveStep();
  const completeStep = useCompleteStep();
  const updateScene = useUpdateScene();
  const copyLine = useCopyLineToSynopsis();

  const [content, setContent] = useState<Step9Content>(row.content as Step9Content);
  const [ignored, setIgnored] = useState<ReadonlySet<string>>(() => new Set(row.overrides));
  const [blocked, setBlocked] = useState<readonly ValidationIssue[]>([]);
  const [completing, setCompleting] = useState(false);
  const [promptsOpen, setPromptsOpen] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<{ sceneId: UUID; text: string } | null>(null);
  // Remount counter per scene: bumping it re-seeds an editor after the copy trigger rewrote
  // the synopsis (the editor is uncontrolled by design).
  const [revisions, setRevisions] = useState<Record<string, number>>({});

  const chapters = useMemo(() => tree.data?.chapters ?? [], [tree.data]);
  const scenes = useMemo(
    () => orderScenesBookWise(chapters, tree.data?.scenes ?? []),
    [tree.data, chapters],
  );

  const sceneContext: SceneContextInfo[] = useMemo(
    () =>
      scenes.map((scene) => ({
        id: scene.id,
        povCharacterId: scene.povCharacterId,
        chapterId: scene.chapterId,
        synopsisWords: scene.synopsis.wordCount,
      })),
    [scenes],
  );

  const flush = useAutosave(content, async (value) => {
    try {
      await saveStep.mutateAsync({ projectId, step: 9, content: value });
      return true;
    } catch {
      return false;
    }
  });

  // Synopsis edits coalesce per scene and flush 600 ms after typing stops; the map keeps a
  // failed write dirty so the next flush retries it.
  const pendingSynopses = useRef(new Map<UUID, RichText>());
  const synopsisTimer = useRef<number | null>(null);
  const flushSynopses = async () => {
    if (synopsisTimer.current !== null) {
      window.clearTimeout(synopsisTimer.current);
      synopsisTimer.current = null;
    }
    const entries = [...pendingSynopses.current.entries()];
    pendingSynopses.current.clear();
    for (const [sceneId, value] of entries) {
      try {
        await updateScene.mutateAsync({ projectId, sceneId, patch: { synopsis: value } });
      } catch {
        pendingSynopses.current.set(sceneId, value);
      }
    }
  };
  const scheduleSynopsisSave = (sceneId: UUID, value: RichText) => {
    pendingSynopses.current.set(sceneId, value);
    if (synopsisTimer.current !== null) window.clearTimeout(synopsisTimer.current);
    synopsisTimer.current = window.setTimeout(() => {
      synopsisTimer.current = null;
      void flushSynopses();
    }, 600);
  };
  const flushSynopsesRef = useRef(flushSynopses);
  flushSynopsesRef.current = flushSynopses;
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") void flushSynopsesRef.current();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      void flushSynopsesRef.current();
    };
  }, []);

  const expanded = useMemo(() => new Set(content.expandedSceneIds), [content.expandedSceneIds]);
  const issues = validateStep9(content, { scenes: sceneContext });
  const errors = blockingIssues(issues);
  const warnings = issues.filter(
    (issue) => issue.severity === "warning" && !ignored.has(issue.code),
  );

  const toggleExpanded = (sceneId: UUID) => {
    setContent((previous) => {
      const next = new Set(previous.expandedSceneIds);
      if (next.has(sceneId)) next.delete(sceneId);
      else next.add(sceneId);
      return { ...previous, expandedSceneIds: [...next] };
    });
  };

  const toggleIgnore = (code: string) => {
    setIgnored((previous) => {
      const next = new Set(previous);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const onCopyLine = async (sceneId: UUID) => {
    try {
      const result = await copyLine.mutateAsync({ projectId, sceneId });
      setCopyFeedback({
        sceneId,
        text: result.copied ? messages.step9.copied : messages.step9.alreadyThere,
      });
      if (result.copied) {
        setRevisions((previous) => ({ ...previous, [sceneId]: (previous[sceneId] ?? 0) + 1 }));
      }
    } catch {
      setCopyFeedback({ sceneId, text: messages.step9.alreadyThere });
    }
  };

  const onComplete = async () => {
    setCompleting(true);
    try {
      await flush();
      await flushSynopses();
      await completeStep.mutateAsync({ projectId, step: 9, overrides: [...ignored] });
      void navigate({ to: "/plan" });
    } catch (cause) {
      if (cause instanceof StepBlockedError) setBlocked(cause.issues);
    } finally {
      setCompleting(false);
    }
  };

  if (project === null) return <p className="text-sm text-muted">{messages.common.loading}</p>;

  return (
    <div className="flex flex-1 flex-col gap-4">
      <p className="text-sm text-muted">{messages.step9.lead}</p>

      <section className="sl-card flex items-center justify-between gap-3 p-4">
        <p className="text-sm">
          {format(messages.step9.progress, {
            done: content.expandedSceneIds.length,
            total: scenes.length,
          })}
        </p>
        <button
          type="button"
          className="sl-btn-small"
          aria-pressed={content.skipped}
          onClick={() => setContent((previous) => ({ ...previous, skipped: !previous.skipped }))}
        >
          {messages.step9.skipToggle}
        </button>
      </section>

      {scenes.length === 0 ? (
        <p className="text-sm text-muted">{messages.step9.empty}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {scenes.map((scene, index) => {
            const isOpen = expanded.has(scene.id);
            const thin = scene.synopsis.wordCount < 40;
            const chapterTitle = chapters.find((chapter) => chapter.id === scene.chapterId)?.title;
            const line =
              scene.title.trim() ||
              scene.synopsis.text.split("\n")[0]?.trim() ||
              messages.dashboard.sceneFallback;
            return (
              <li key={scene.id} className="sl-card p-3">
                <button
                  type="button"
                  className="sl-scene-line-main"
                  aria-expanded={isOpen}
                  onClick={() => toggleExpanded(scene.id)}
                >
                  <span className="w-6 shrink-0 text-right text-xs text-muted tabular-nums">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1 text-left">
                    <span className="block truncate text-sm font-medium">{line}</span>
                    <span className="mt-0.5 block text-xs text-muted">
                      {scene.povName ?? messages.scenes.noPov} ·{" "}
                      {chapterTitle ?? messages.scenes.unassigned}
                      {thin ? ` · ${messages.step9.thin}` : ""}
                    </span>
                  </span>
                  <span aria-hidden="true" className="text-muted">
                    {isOpen ? "▾" : "▸"}
                  </span>
                </button>
                {isOpen ? (
                  <div className="mt-3 flex flex-col gap-2">
                    <RichTextEditor
                      key={`${scene.id}:${revisions[scene.id] ?? 0}`}
                      initial={scene.synopsis}
                      ariaLabel={format(messages.step9.synopsisLabel, { n: index + 1 })}
                      onChange={(value) => scheduleSynopsisSave(scene.id, value)}
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        className="sl-btn-small"
                        disabled={copyLine.isPending}
                        onClick={() => void onCopyLine(scene.id)}
                      >
                        ⇥ {messages.step9.copyLine}
                      </button>
                      {copyFeedback?.sceneId === scene.id ? (
                        <span className="text-xs text-muted">{copyFeedback.text}</span>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <IssueList
        issues={blocked.length > 0 ? blocked : warnings}
        ignored={ignored}
        onToggleIgnore={toggleIgnore}
      />

      <button type="button" className="sl-btn" onClick={() => setPromptsOpen(true)}>
        ✦ {messages.prompts.heading}
      </button>

      <button
        type="button"
        className="sl-btn sl-btn-primary w-full"
        disabled={completing || errors.length > 0 || row.status === "complete"}
        onClick={() => void onComplete()}
      >
        {row.status === "complete" ? messages.plan.status.complete : messages.plan.markComplete}
      </button>

      <PromptsSheet open={promptsOpen} step={9} onClose={() => setPromptsOpen(false)} />
    </div>
  );
}
