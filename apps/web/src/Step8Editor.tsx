import {
  blockingIssues,
  format,
  messages,
  orderScenesBookWise,
  plural,
  richTextFromPlain,
  type SceneContextInfo,
  type SceneSummary,
  type SnowflakeStepRow,
  type Step8Content,
  StepBlockedError,
  TEMPLATE_CONTENT,
  TEMPLATE_IDS,
  type TemplateId,
  templateSceneText,
  type UUID,
  type ValidationIssue,
  validateStep8,
} from "@starline/core";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useActiveProject } from "./active-project";
import {
  useCharacters,
  useCompleteStep,
  useCreateScene,
  useCreateScenesFromList,
  useDeleteScene,
  useSaveStep,
  useSceneTree,
  useUpdateScene,
} from "./data";
import { IssueList } from "./IssueList";
import { formatNumber, useLocaleStore } from "./locale";
import { PromptsSheet } from "./PromptsSheet";
import { useAutosave } from "./useAutosave";

/**
 * Step 8 — the scene list (spec §4.1 point 7): rows of #, POV, one-line, estimated words;
 * inline edits write the `scene` rows directly; paste-from-clipboard creates the list in
 * bulk with a created/updated/skipped report; a running estimate sits against the project's
 * target length.
 */
export function Step8Editor({ projectId, row }: { projectId: UUID; row: SnowflakeStepRow }) {
  const navigate = useNavigate();
  const { project } = useActiveProject();
  const tree = useSceneTree(projectId);
  const characters = useCharacters(projectId);
  const saveStep = useSaveStep();
  const completeStep = useCompleteStep();
  const createScene = useCreateScene();
  const createFromList = useCreateScenesFromList();
  const updateScene = useUpdateScene();
  const deleteScene = useDeleteScene();

  const [content, setContent] = useState<Step8Content>(row.content as Step8Content);
  const [ignored, setIgnored] = useState<ReadonlySet<string>>(() => new Set(row.overrides));
  const [blocked, setBlocked] = useState<readonly ValidationIssue[]>([]);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [report, setReport] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [promptsOpen, setPromptsOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [templateId, setTemplateId] = useState<TemplateId | null>(null);
  const locale = useLocaleStore((state) => state.locale);

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
      await saveStep.mutateAsync({ projectId, step: 8, content: value });
      return true;
    } catch {
      return false;
    }
  });

  const issues = useMemo(
    () => validateStep8(content, { scenes: sceneContext }),
    [content, sceneContext],
  );
  const errors = blockingIssues(issues);
  const estimate = scenes.reduce((sum, scene) => sum + (scene.targetWordCount ?? 0), 0);
  const target = project?.targetWordCount ?? null;

  const toggleIgnore = (code: string) => {
    setIgnored((previous) => {
      const next = new Set(previous);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const onImport = async () => {
    setImporting(true);
    try {
      const result = await createFromList.mutateAsync({ projectId, text: pasteText });
      const parts = [
        format(messages.step8.reportCreated, { created: result.created, skipped: result.skipped }),
      ];
      if (result.updated > 0) parts.push(`${result.updated} updated`);
      setReport(parts.join(" · "));
      // Keep the local bookkeeping in step with what the command wrote, so the next
      // autosave cannot clobber `lastImportedAt` (it drives the stale badge vs step 6).
      setContent((previous) => {
        const ids = new Set<UUID>([...previous.generatedSceneIds, ...result.sceneIds]);
        return { generatedSceneIds: [...ids], lastImportedAt: Date.now() };
      });
    } finally {
      setImporting(false);
    }
  };

  /**
   * Apply a structure template: its beats become scenes through the same command the paste flow
   * uses, with `withTitles` on so each beat's name becomes the scene's title. They arrive
   * unassigned — sorting them into chapters is the writer's next move, not the template's.
   */
  const onApplyTemplate = async (id: TemplateId) => {
    setImporting(true);
    try {
      const result = await createFromList.mutateAsync({
        projectId,
        text: templateSceneText(id, locale),
        withTitles: true,
      });
      const parts = [
        format(messages.step8.reportCreated, { created: result.created, skipped: result.skipped }),
      ];
      if (result.updated > 0) parts.push(`${result.updated} updated`);
      setReport(parts.join(" · "));
      setContent((previous) => {
        const ids = new Set<UUID>([...previous.generatedSceneIds, ...result.sceneIds]);
        return { generatedSceneIds: [...ids], lastImportedAt: Date.now() };
      });
      // Deliberately stay open: the report lands in this sheet the same way it lands in the
      // paste sheet, so the writer sees "9 created" instead of a sheet that vanished.
    } finally {
      setImporting(false);
    }
  };

  // Escape closes the template sheet, matching the other sheets (and the a11y harness, which
  // asserts Escape closes a sheet).
  useEffect(() => {
    if (!templateOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setTemplateOpen(false);
        setTemplateId(null);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [templateOpen]);

  const onAddRow = async () => {
    await createScene.mutateAsync({ projectId, chapterId: null });
    setContent((previous) => ({ ...previous, lastImportedAt: Date.now() }));
  };

  const onComplete = async () => {
    setCompleting(true);
    setBlocked([]);
    try {
      await flush();
      await completeStep.mutateAsync({ projectId, step: 8, overrides: [...ignored] });
      await navigate({ to: "/plan" });
    } catch (cause) {
      if (cause instanceof StepBlockedError) setBlocked([...cause.issues]);
    } finally {
      setCompleting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <section className="sl-card p-5">
        <p className="text-sm text-muted">{messages.step8.lead}</p>
        <p className="mt-2 text-sm font-medium">
          {target !== null
            ? format(messages.step8.estimated, {
                est: formatNumber(estimate),
                target: formatNumber(target),
              })
            : plural(messages.step8.estimatedNoTarget, estimate, { est: formatNumber(estimate) })}
        </p>
      </section>

      {scenes.length === 0 ? (
        <p className="text-sm text-muted">{messages.step8.emptyList}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {scenes.map((scene, index) => (
            <li key={scene.id}>
              <SceneListRow
                scene={scene}
                index={index}
                characters={characters.data ?? []}
                chapterTitle={
                  chapters.find((chapter) => chapter.id === scene.chapterId)?.title ?? null
                }
                onPatch={(patch) => updateScene.mutate({ projectId, sceneId: scene.id, patch })}
                onDelete={() => deleteScene.mutate({ projectId, sceneId: scene.id })}
              />
            </li>
          ))}
        </ul>
      )}

      <IssueList
        issues={blocked.length > 0 ? blocked : issues}
        ignored={ignored}
        onToggleIgnore={toggleIgnore}
      />

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="sl-btn" onClick={() => setPasteOpen(true)}>
          ⇥ {messages.step8.pasteButton}
        </button>
        <button
          type="button"
          className="sl-btn"
          disabled={createScene.isPending}
          onClick={() => void onAddRow()}
        >
          + {messages.step8.addRow}
        </button>
        <button type="button" className="sl-btn" onClick={() => setPromptsOpen(true)}>
          ✦ {messages.prompts.heading}
        </button>
        <button
          type="button"
          className="sl-btn"
          data-testid="sl-templates-open"
          onClick={() => {
            setTemplateId(null);
            setReport(null);
            setTemplateOpen(true);
          }}
        >
          ▦ {messages.templates.heading}
        </button>
      </div>

      <button
        type="button"
        className="sl-btn sl-btn-primary w-full"
        disabled={completing || errors.length > 0 || row.status === "complete"}
        onClick={() => void onComplete()}
      >
        {row.status === "complete" ? messages.plan.status.complete : messages.plan.markComplete}
      </button>

      {pasteOpen ? (
        <>
          <button
            type="button"
            className="sl-sheet-backdrop"
            aria-label={messages.common.close}
            onClick={() => setPasteOpen(false)}
          />
          <section
            className="sl-sheet"
            role="dialog"
            aria-modal="true"
            aria-label={messages.step8.pasteHeading}
          >
            <header className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold tracking-tight">
                {messages.step8.pasteHeading}
              </h2>
              <button
                type="button"
                className="sl-btn"
                aria-label={messages.common.close}
                onClick={() => setPasteOpen(false)}
              >
                ✕
              </button>
            </header>
            <p className="mt-1 text-xs text-muted">{messages.step8.pasteHint}</p>
            <textarea
              className="sl-textarea mt-3"
              rows={8}
              value={pasteText}
              placeholder={messages.step8.pastePlaceholder}
              aria-label={messages.step8.pasteHeading}
              onChange={(event) => setPasteText(event.target.value)}
            />
            {report !== null ? <p className="mt-2 text-sm text-accent">{report}</p> : null}
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                className="sl-btn sl-btn-primary flex-1"
                disabled={importing || pasteText.trim().length === 0}
                onClick={() => void onImport()}
              >
                {messages.step8.createButton}
              </button>
            </div>
          </section>
        </>
      ) : null}

      <PromptsSheet open={promptsOpen} step={8} onClose={() => setPromptsOpen(false)} />

      {templateOpen ? (
        <>
          <button
            type="button"
            className="sl-sheet-backdrop"
            aria-label={messages.common.close}
            onClick={() => {
              setTemplateOpen(false);
              setTemplateId(null);
            }}
          />
          <section
            className="sl-sheet"
            role="dialog"
            aria-modal="true"
            aria-label={messages.templates.heading}
            data-testid="sl-template-sheet"
          >
            <header className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold tracking-tight">
                {templateId === null ? messages.templates.heading : messages.templates.previewTitle}
              </h2>
              <button
                type="button"
                className="sl-btn"
                aria-label={messages.common.close}
                onClick={() => {
                  setTemplateOpen(false);
                  setTemplateId(null);
                }}
              >
                ✕
              </button>
            </header>

            {templateId === null ? (
              <>
                <p className="mt-1 text-xs text-muted">{messages.templates.hint}</p>
                <ul className="mt-3 flex flex-col gap-2">
                  {TEMPLATE_IDS.map((id) => (
                    <li key={id}>
                      <button
                        type="button"
                        className="sl-card w-full p-3 text-left"
                        data-testid={`sl-template-${id}`}
                        onClick={() => setTemplateId(id)}
                      >
                        <span className="block text-sm font-medium">
                          {TEMPLATE_CONTENT[id][locale].name}
                        </span>
                        <span className="block text-xs text-muted">
                          {TEMPLATE_CONTENT[id][locale].summary}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <>
                <p className="mt-1 text-xs text-muted">
                  {TEMPLATE_CONTENT[templateId][locale].summary}
                </p>
                <ul className="mt-3 flex flex-col gap-2">
                  {TEMPLATE_CONTENT[templateId][locale].beats.map((beat) => (
                    <li key={beat.title} className="text-xs">
                      <span className="block text-sm font-medium">{beat.title}</span>
                      <span className="block text-muted">{beat.synopsis}</span>
                    </li>
                  ))}
                </ul>
                {report ? (
                  <p
                    className="sl-notice mt-3 text-xs"
                    role="status"
                    data-testid="sl-template-report"
                  >
                    {report}
                  </p>
                ) : null}
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="sl-btn sl-btn-primary"
                    data-testid="sl-template-apply"
                    disabled={importing}
                    onClick={() => void onApplyTemplate(templateId)}
                  >
                    {plural(
                      messages.templates.apply,
                      TEMPLATE_CONTENT[templateId][locale].beats.length,
                    )}
                  </button>
                  <button type="button" className="sl-btn" onClick={() => setTemplateId(null)}>
                    {messages.common.close}
                  </button>
                </div>
              </>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}

function SceneListRow({
  scene,
  index,
  characters,
  chapterTitle,
  onPatch,
  onDelete,
}: {
  scene: SceneSummary;
  index: number;
  characters: ReadonlyArray<{ id: UUID; name: string }>;
  chapterTitle: string | null;
  onPatch: (patch: {
    synopsis?: ReturnType<typeof richTextFromPlain>;
    povCharacterId?: UUID | null;
    targetWordCount?: number | null;
  }) => void;
  onDelete: () => void;
}) {
  const [confirming, setConfirming] = useState(false);

  const requestDelete = () => {
    if (confirming) {
      onDelete();
      return;
    }
    setConfirming(true);
    window.setTimeout(() => setConfirming(false), 2500);
  };

  return (
    <div className="sl-card sl-scene-row flex flex-col gap-2 p-3">
      <div className="flex items-center gap-2">
        <span className="w-6 shrink-0 text-right text-xs text-muted tabular-nums">{index + 1}</span>
        <select
          className="sl-select min-w-0 flex-1"
          value={scene.povCharacterId ?? ""}
          aria-label={format(messages.step8.povLabel, { n: index + 1 })}
          onChange={(event) =>
            onPatch({
              povCharacterId: event.target.value === "" ? null : (event.target.value as UUID),
            })
          }
        >
          <option value="">{messages.scenes.noPov}</option>
          {characters.map((character) => (
            <option key={character.id} value={character.id}>
              {character.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="sl-btn sl-btn-small"
          aria-label={format(messages.step8.removeLabel, { n: index + 1 })}
          onClick={requestDelete}
        >
          {confirming ? "✓" : "✕"}
        </button>
      </div>
      <input
        className="sl-input"
        defaultValue={scene.synopsis.text}
        placeholder={messages.step8.rowPlaceholder}
        aria-label={format(messages.step8.lineLabel, { n: index + 1 })}
        onBlur={(event) => {
          const value = event.target.value.trim();
          if (value !== scene.synopsis.text) onPatch({ synopsis: richTextFromPlain(value) });
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") (event.target as HTMLInputElement).blur();
        }}
      />
      <div className="flex items-center gap-2">
        <input
          className="sl-input w-28"
          type="number"
          min={0}
          inputMode="numeric"
          defaultValue={scene.targetWordCount ?? ""}
          placeholder={messages.step8.estPlaceholder}
          aria-label={format(messages.step8.estLabel, { n: index + 1 })}
          onBlur={(event) => {
            const raw = event.target.value.trim();
            const value = raw === "" ? null : Number.parseInt(raw, 10);
            if (value !== scene.targetWordCount) {
              onPatch({ targetWordCount: value !== null && Number.isFinite(value) ? value : null });
            }
          }}
        />
        {chapterTitle !== null ? <span className="sl-chip">{chapterTitle}</span> : null}
      </div>
    </div>
  );
}
