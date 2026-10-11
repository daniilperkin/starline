import {
  format,
  messages,
  orderScenesBookWise,
  plural,
  type RichText,
  SCENE_STATUS_COLORS,
  type UUID,
} from "@starline/core";
import { useNavigate, useParams } from "@tanstack/react-router";
import type { Editor } from "@tiptap/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  queryClient,
  useMentionables,
  useProjects,
  useSceneBody,
  useSceneDetail,
  useSceneTree,
  useSetEditorLastScene,
  useSetSceneBody,
  useUpdateScene,
} from "./data";
import { formatClock, formatNumber } from "./locale";
import { RichTextEditor } from "./RichTextEditor";
import { SceneSheet } from "./SceneSheet";
import { useAutosave } from "./useAutosave";
import { readCaret, TYPOGRAPHY_SIZES, useTypography, writeCaret } from "./write/prefs";
import { SceneSwitcher } from "./write/SceneSwitcher";

interface Draft {
  title: string;
  body: RichText;
}

/**
 * Writing mode (PLAN slice 13): the first-class editor the spec's §4.3.4 scene sheet left to
 * "Write". One scene at a time, full screen, chrome that gets out of the way — focus mode hides
 * everything but the prose and the word count. Autosave debounces 400 ms and flushes on hide,
 * blur, unmount and the native background event, so a scene survives the phone being killed.
 *
 * Device state (type size, serif, caret) lives in localStorage; the resume pointer lives in the
 * library file (editor state), so it follows the .starline to another phone.
 */
export function WriteScreen() {
  const { sceneId: sceneIdParam } = useParams({ from: "/write/$sceneId" });
  const sceneId = sceneIdParam as UUID;
  const navigate = useNavigate();
  const projects = useProjects();
  const projectId = projects.data?.[0]?.id ?? null;
  const detail = useSceneDetail(projectId, sceneId);
  const bodyQuery = useSceneBody(projectId, sceneId);
  const tree = useSceneTree(projectId);
  const mentionables = useMentionables(projectId);
  const setBody = useSetSceneBody();
  const updateScene = useUpdateScene();
  const { mutate: rememberScene } = useSetEditorLastScene();

  const [typography, setTypography] = useTypography();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [focus, setFocus] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [typeOpen, setTypeOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const composingRef = useRef(false);
  const caretRestored = useRef(false);

  // A new scene = a fresh draft, a fresh caret, and the editor remounts on the new id.
  const lastScene = useRef<string | null>(null);
  useEffect(() => {
    if (lastScene.current === sceneId) return;
    lastScene.current = sceneId;
    setDraft(null);
    caretRestored.current = false;
    setSavedAt(null);
  }, [sceneId]);

  // Seed the uncontrolled editor exactly once per scene, from the body read and the title.
  useEffect(() => {
    if (draft !== null) return;
    if (detail.data === undefined || detail.data === null) return;
    if (bodyQuery.data === undefined || bodyQuery.data === null) return;
    setDraft({ title: detail.data.title, body: bodyQuery.data.body });
  }, [draft, detail.data, bodyQuery.data]);

  // "Continue writing" follows the writer: one meta write per scene open, undoable like the rest.
  useEffect(() => {
    if (projectId === null) return;
    rememberScene({ projectId, sceneId });
  }, [projectId, sceneId, rememberScene]);

  const flush = useAutosave(
    draft,
    async (value) => {
      if (projectId === null || value === null) return false;
      // IME hardening round 2: never persist a half-composed syllable. The autosave retry timer
      // picks the text up as soon as the composition commits.
      if (composingRef.current) return false;
      setSaving(true);
      try {
        await setBody.mutateAsync({ projectId, sceneId, body: value.body });
        if (
          detail.data !== undefined &&
          detail.data !== null &&
          value.title !== detail.data.title
        ) {
          await updateScene.mutateAsync({ projectId, sceneId, patch: { title: value.title } });
        }
        setSaving(false);
        setSavedAt(formatClock(new Date()));
        // Coming back to this scene later must seed the SAVED text, not the copy this screen
        // loaded when it opened — the body query cache is the only other holder of it.
        void queryClient.invalidateQueries({ queryKey: ["sceneBody"] });
        return true;
      } catch {
        setSaving(false);
        return false; // stays dirty; the autosave retries on its own timer
      }
    },
    400,
  );

  const ordered = useMemo(
    () => orderScenesBookWise(tree.data?.chapters ?? [], tree.data?.scenes ?? []),
    [tree.data],
  );
  const index = ordered.findIndex((scene) => scene.id === sceneId);
  const previous = index > 0 ? ordered[index - 1] : null;
  const next = index >= 0 && index < ordered.length - 1 ? ordered[index + 1] : null;

  const go = useCallback(
    async (target: UUID) => {
      await flush();
      void navigate({ to: "/write/$sceneId", params: { sceneId: target } });
    },
    [flush, navigate],
  );

  const onEditor = useCallback(
    (editor: Editor | null) => {
      editorRef.current = editor;
      if (editor === null) return;
      if (!caretRestored.current) {
        caretRestored.current = true;
        const saved = readCaret(sceneId);
        if (saved !== null) {
          try {
            // Clamp: the stored position may be past the end if the scene shrank elsewhere.
            const size = editor.state.doc.content.size;
            editor.commands.setTextSelection({
              from: Math.min(saved.from, size),
              to: Math.min(saved.to, size),
            });
          } catch {
            // A stale caret is not worth a failure path — start at the top instead.
          }
        }
      }
      const saveCaret = () => {
        const { from, to } = editor.state.selection;
        writeCaret(sceneId, { from, to });
      };
      editor.on("selectionUpdate", saveCaret);
      editor.on("blur", saveCaret);
    },
    [sceneId],
  );

  // Focus mode: Escape brings the chrome back (keyboard users are never trapped).
  useEffect(() => {
    if (!focus) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFocus(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [focus]);

  if (detail.data === null) {
    return (
      <main className="sl-write" data-testid="sl-write">
        <p className="text-sm text-muted">{messages.write.noScene}</p>
        <button type="button" className="sl-btn" onClick={() => void navigate({ to: "/scenes" })}>
          {messages.write.back}
        </button>
      </main>
    );
  }

  const words = draft?.body.wordCount ?? 0;
  const target = detail.data?.targetWordCount ?? null;
  const status = detail.data?.status ?? null;
  const chapterTitle =
    detail.data?.chapterId != null
      ? (tree.data?.chapters.find((chapter) => chapter.id === detail.data?.chapterId)?.title ?? "")
      : "";

  return (
    <main
      className={focus ? "sl-write sl-write-focus" : "sl-write"}
      data-testid="sl-write"
      data-focus={focus ? "1" : "0"}
      onCompositionStart={() => {
        composingRef.current = true;
      }}
      onCompositionEnd={() => {
        composingRef.current = false;
      }}
    >
      {focus ? null : (
        <header className="sl-write-bar">
          <button
            type="button"
            className="sl-btn-small"
            data-testid="sl-write-back"
            aria-label={messages.write.back}
            onClick={() => {
              void flush().then(() => navigate({ to: "/scenes" }));
            }}
          >
            ←
          </button>
          <div className="sl-write-context">
            <span className="sl-write-crumb">
              {chapterTitle || messages.write.heading}
              {index >= 0 ? ` · ${index + 1}/${ordered.length}` : ""}
            </span>
            {status !== null ? (
              <span
                className="sl-write-status"
                style={{ background: SCENE_STATUS_COLORS[status] }}
                data-testid="sl-write-status"
              >
                {messages.scenes.status[status]}
              </span>
            ) : null}
          </div>
          <button
            type="button"
            className="sl-btn-small"
            data-testid="sl-write-prev"
            aria-label={messages.write.previous}
            disabled={previous === null}
            onClick={() => {
              if (previous) void go(previous.id);
            }}
          >
            ‹
          </button>
          <button
            type="button"
            className="sl-btn-small"
            data-testid="sl-write-next"
            aria-label={messages.write.next}
            disabled={next === null}
            onClick={() => {
              if (next) void go(next.id);
            }}
          >
            ›
          </button>
        </header>
      )}

      <input
        className="sl-write-title"
        data-testid="sl-write-title"
        aria-label={messages.write.untitled}
        placeholder={messages.write.untitled}
        value={draft?.title ?? ""}
        onChange={(event) => {
          const title = event.target.value;
          setDraft((current) => (current === null ? current : { ...current, title }));
        }}
      />

      <div
        className={typography.serif ? "sl-write-page sl-write-serif" : "sl-write-page"}
        style={{ fontSize: `${typography.size}px` }}
      >
        {draft === null ? (
          <p className="text-sm text-muted">{messages.common.loading}</p>
        ) : (
          <RichTextEditor
            key={sceneId}
            plain
            initial={draft.body}
            ariaLabel={messages.write.bodyLabel}
            mentionables={mentionables.data ?? []}
            onEditor={onEditor}
            onChange={(value) => {
              setDraft((current) => (current === null ? current : { ...current, body: value }));
            }}
          />
        )}
      </div>

      {focus ? (
        <>
          <button
            type="button"
            className="sl-btn-small sl-write-focus-exit"
            data-testid="sl-write-focus"
            aria-label={messages.write.focusExit}
            onClick={() => setFocus(false)}
          >
            ✕
          </button>
          <p className="sl-write-float" data-testid="sl-write-words">
            {plural(messages.write.wordsLive, words, { words: formatNumber(words) })}
          </p>
        </>
      ) : (
        <footer className="sl-write-foot">
          <span className="sl-write-words" data-testid="sl-write-words">
            {target !== null
              ? format(messages.write.wordsOf, {
                  words: formatNumber(words),
                  target: formatNumber(target),
                })
              : plural(messages.write.wordsLive, words, { words: formatNumber(words) })}
          </span>
          <span className="sl-write-saved" data-testid="sl-write-saved">
            {saving
              ? messages.write.saving
              : savedAt !== null
                ? format(messages.write.saved, { time: savedAt })
                : ""}
          </span>
          <div className="sl-write-actions">
            <button
              type="button"
              className="sl-btn-small"
              data-testid="sl-write-switch"
              onClick={() => setSwitcherOpen(true)}
            >
              {messages.write.switchScenes}
            </button>
            <button
              type="button"
              className="sl-btn-small"
              data-testid="sl-write-type"
              aria-label={messages.write.typography}
              onClick={() => setTypeOpen((open) => !open)}
            >
              Aa
            </button>
            <button
              type="button"
              className="sl-btn-small"
              data-testid="sl-write-focus"
              aria-label={messages.write.focus}
              onClick={() => setFocus(true)}
            >
              ⤢
            </button>
            <button
              type="button"
              className="sl-btn-small"
              data-testid="sl-write-details"
              onClick={() => setDetailsOpen(true)}
            >
              {messages.write.details}
            </button>
          </div>
        </footer>
      )}

      {typeOpen && !focus ? (
        <div className="sl-write-type-sheet" data-testid="sl-write-type-sheet">
          <label className="sl-write-type-row">
            <input
              type="checkbox"
              checked={typography.serif}
              onChange={(event) => setTypography({ serif: event.target.checked })}
            />
            {messages.write.serif}
          </label>
          <div className="sl-write-type-row">
            <span>{messages.write.size}</span>
            <button
              type="button"
              className="sl-btn-small"
              aria-label={messages.write.smaller}
              onClick={() => {
                const i = TYPOGRAPHY_SIZES.indexOf(typography.size as never);
                setTypography({ size: TYPOGRAPHY_SIZES[Math.max(0, i - 1)] });
              }}
            >
              A−
            </button>
            <span data-testid="sl-write-size">{typography.size}</span>
            <button
              type="button"
              className="sl-btn-small"
              aria-label={messages.write.larger}
              onClick={() => {
                const i = TYPOGRAPHY_SIZES.indexOf(typography.size as never);
                setTypography({
                  size: TYPOGRAPHY_SIZES[Math.min(TYPOGRAPHY_SIZES.length - 1, i + 1)],
                });
              }}
            >
              A+
            </button>
          </div>
        </div>
      ) : null}

      {switcherOpen ? (
        <SceneSwitcher
          projectId={projectId as UUID}
          currentSceneId={sceneId}
          onPick={(id) => {
            setSwitcherOpen(false);
            void go(id);
          }}
          onClose={() => setSwitcherOpen(false)}
        />
      ) : null}

      {detailsOpen && projectId !== null ? (
        <SceneSheet projectId={projectId} sceneId={sceneId} onClose={() => setDetailsOpen(false)} />
      ) : null}
    </main>
  );
}
