import { format, messages, readProjectExport, type UUID } from "@starline/core";
import { useRef, useState } from "react";
import { useActiveProject } from "./active-project";
import { buildExportFile, type ExportFormat, type ExportOptions } from "./export/build";
import type { ExportWorkerMessage } from "./export/export.worker";
import { type SaveResult, saveExportFile } from "./export/files";
import {
  CHARACTER_FIELDS,
  type ColumnMapping,
  type DryRun,
  dryRunCsv,
  type ImportTarget,
  importCsv,
  importManuscript,
  SCENE_FIELDS,
  type SplitOptions,
  type SplitResult,
  splitManuscript,
  suggestMapping,
} from "./export/importers";
import { useScenesRefresh } from "./export/useRefresh";
import { formatNumber } from "./locale";
import { useSessionStore } from "./session";

type Mode = "export" | "import-csv" | "import-manuscript";

const FORMAT_LABEL: Record<ExportFormat, keyof typeof messages.export.presets> = {
  json: "json",
  "markdown-folder": "markdownFolder",
  "docx-manuscript": "docxManuscript",
  "docx-planning": "docxPlanning",
  html: "html",
  "markdown-manuscript": "markdown",
  text: "text",
  csv: "csv",
};

const FORMAT_ORDER: ExportFormat[] = [
  "json",
  "markdown-folder",
  "docx-manuscript",
  "docx-planning",
  "html",
  "markdown-manuscript",
  "text",
  "csv",
];

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/**
 * Export & import (spec §4.5.1/§4.5.2, slice 12). The build runs in a worker so a 300-scene DOCX
 * never freezes the editor; the importers write through the ordinary commands, so everything they
 * create is undoable like any other edit.
 */
export function ExportScreen() {
  const session = useSessionStore((state) => state.session);
  const refreshScenes = useScenesRefresh();
  const workerRef = useRef<Worker | null>(null);

  const [mode, setMode] = useState<Mode>("export");
  const [preset, setPreset] = useState<ExportFormat>("json");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [includeSynopsis, setIncludeSynopsis] = useState(false);
  const [includeBody, setIncludeBody] = useState(true);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ result: SaveResult; name: string; bytes: number } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  // CSV import state.
  const [csvText, setCsvText] = useState("");
  const [csvTarget, setCsvTarget] = useState<ImportTarget>("character");
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [dryRun, setDryRun] = useState<DryRun | null>(null);
  const [csvDone, setCsvDone] = useState<string | null>(null);

  // Manuscript split state.
  const [manuscriptText, setManuscriptText] = useState("");
  const [splitOptions, setSplitOptions] = useState<SplitOptions>({
    headingLevel: 1,
    sceneBreak: "asterisks",
  });
  const [split, setSplit] = useState<SplitResult | null>(null);
  const [splitDone, setSplitDone] = useState<string | null>(null);

  const { project } = useActiveProject();
  const projectId = project?.id ?? null;

  if (!session) return null;

  const options: ExportOptions = {
    includeSynopsis,
    includeBody,
    statuses:
      statusFilter === "all"
        ? []
        : statusFilter === "done"
          ? ["done"]
          : ["drafted", "revising", "done"],
  };

  const onExport = async () => {
    setError(null);
    setSaved(null);
    setBusy(true);
    setStage(messages.export.stageReading);
    try {
      // Attachments ride only the folder format (decision 21): the zip is lossless, the JSON
      // document stays content-only so it can never point at a row it does not carry.
      const data = await readProjectExport(session.driver, projectId as UUID, {
        includeAttachments: preset === "markdown-folder",
      });
      const title = String(data.project.title ?? messages.export.untitled);
      const worker = new Worker(new URL("./export/export.worker.ts", import.meta.url), {
        type: "module",
      });
      workerRef.current = worker;
      const result = await new Promise<{ name: string; mime: string; bytes: ArrayBuffer }>(
        (resolve, reject) => {
          worker.onmessage = (event: MessageEvent<ExportWorkerMessage>) => {
            const message = event.data;
            if ("stage" in message) {
              setStage(
                message.stage === "packing"
                  ? messages.export.stagePacking
                  : messages.export.stageBuilding,
              );
              return;
            }
            if ("error" in message) {
              reject(new Error(message.error));
              return;
            }
            resolve(message.done);
          };
          worker.onerror = (event) => reject(new Error(event.message));
          worker.postMessage({
            id: 1,
            request: { format: preset, options, data, exportedAt: Date.now(), title },
          });
        },
      );
      worker.terminate();
      workerRef.current = null;
      setStage(messages.export.stageSaving);
      const bytes = new Uint8Array(result.bytes);
      const saveResult = await saveExportFile(result.name, result.mime, bytes);
      setSaved({ result: saveResult, name: result.name, bytes: bytes.byteLength });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
      setStage(null);
    }
  };

  const onCancel = () => {
    workerRef.current?.terminate();
    workerRef.current = null;
    setBusy(false);
    setStage(null);
    setError(messages.export.cancelled);
  };

  const onCheckCsv = () => {
    setCsvDone(null);
    const target = csvTarget;
    const firstLine = csvText.split("\n")[0] ?? "";
    const header = firstLine.split(/[;,\t]/).map((part) => part.trim());
    const suggested = mapping ?? suggestMapping(header, target);
    setMapping(suggested);
    try {
      setDryRun(dryRunCsv(csvText, target, suggested));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const onImportCsv = async () => {
    if (projectId === null || mapping === null) return;
    setBusy(true);
    setError(null);
    try {
      const result = await importCsv(session, projectId as UUID, csvText, csvTarget, mapping);
      setCsvDone(
        format(messages.export.csvDone, {
          created: result.created,
          updated: result.updated,
          skipped: result.skipped,
        }),
      );
      refreshScenes();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const onPreviewSplit = () => {
    setSplitDone(null);
    setSplit(splitManuscript(manuscriptText, splitOptions));
    setError(null);
  };

  const onImportManuscript = async () => {
    if (projectId === null || split === null) return;
    setBusy(true);
    setError(null);
    try {
      const result = await importManuscript(session, projectId as UUID, split);
      setSplitDone(
        format(messages.export.splitDone, { chapters: result.chapters, scenes: result.scenes }),
      );
      refreshScenes();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const fields = csvTarget === "character" ? CHARACTER_FIELDS : SCENE_FIELDS;
  const header = dryRun?.header ?? [];

  return (
    <div className="flex flex-1 flex-col gap-4">
      <header className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold tracking-tight">{messages.export.heading}</h1>
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            className={mode === "export" ? "sl-btn-small sl-btn-active" : "sl-btn-small"}
            data-testid="sl-mode-export"
            onClick={() => setMode("export")}
          >
            {messages.export.tabExport}
          </button>
          <button
            type="button"
            className={mode === "import-csv" ? "sl-btn-small sl-btn-active" : "sl-btn-small"}
            data-testid="sl-mode-csv"
            onClick={() => setMode("import-csv")}
          >
            {messages.export.tabCsv}
          </button>
          <button
            type="button"
            className={mode === "import-manuscript" ? "sl-btn-small sl-btn-active" : "sl-btn-small"}
            data-testid="sl-mode-manuscript"
            onClick={() => setMode("import-manuscript")}
          >
            {messages.export.tabManuscript}
          </button>
        </div>
      </header>

      {error ? (
        <p className="sl-error" data-testid="sl-export-error">
          {error}
        </p>
      ) : null}

      {mode === "export" ? (
        <section className="sl-card flex flex-col gap-3" data-testid="sl-export-panel">
          <div className="flex flex-wrap gap-2" data-testid="sl-export-presets">
            {FORMAT_ORDER.map((value) => (
              <button
                key={value}
                type="button"
                className={preset === value ? "sl-btn-small sl-btn-active" : "sl-btn-small"}
                data-testid={`sl-preset-${value}`}
                onClick={() => setPreset(value)}
              >
                {
                  messages.export.presets[
                    FORMAT_LABEL[value] as keyof typeof messages.export.presets
                  ]
                }
              </button>
            ))}
          </div>

          <div className="sl-field">
            <label className="sl-label" htmlFor="sl-export-status">
              {messages.export.scope}
            </label>
            <select
              id="sl-export-status"
              className="sl-select"
              data-testid="sl-export-status"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              <option value="all">{messages.export.scopeAll}</option>
              <option value="drafted">{messages.export.scopeDrafted}</option>
              <option value="done">{messages.export.scopeDone}</option>
            </select>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              data-testid="sl-export-synopsis"
              checked={includeSynopsis}
              onChange={(event) => setIncludeSynopsis(event.target.checked)}
            />
            {messages.export.includeSynopsis}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              data-testid="sl-export-body"
              checked={includeBody}
              onChange={(event) => setIncludeBody(event.target.checked)}
            />
            {messages.export.includeBody}
          </label>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="sl-btn sl-btn-primary"
              data-testid="sl-export-run"
              disabled={busy || projectId === null}
              onClick={() => void onExport()}
            >
              {busy ? (stage ?? messages.export.working) : messages.export.run}
            </button>
            {busy ? (
              <button
                type="button"
                className="sl-btn"
                data-testid="sl-export-cancel"
                onClick={onCancel}
              >
                {messages.export.cancel}
              </button>
            ) : null}
          </div>

          {saved !== null ? (
            <p className="sl-notice" data-testid="sl-export-result" role="status">
              {format(messages.export.saved, {
                name: saved.name,
                size: formatBytes(saved.bytes),
                where:
                  saved.result.target === "download"
                    ? messages.export.whereDownload
                    : saved.result.target === "picked"
                      ? messages.export.wherePicked
                      : messages.export.whereDocuments,
              })}
            </p>
          ) : null}
        </section>
      ) : null}

      {mode === "import-csv" ? (
        <section className="sl-card flex flex-col gap-3" data-testid="sl-csv-panel">
          <div className="sl-field">
            <label className="sl-label" htmlFor="sl-csv-target">
              {messages.export.csvTarget}
            </label>
            <select
              id="sl-csv-target"
              className="sl-select"
              data-testid="sl-csv-target"
              value={csvTarget}
              onChange={(event) => {
                setCsvTarget(event.target.value as ImportTarget);
                setMapping(null);
                setDryRun(null);
              }}
            >
              <option value="character">{messages.export.csvCharacters}</option>
              <option value="scene">{messages.export.csvScenes}</option>
            </select>
          </div>

          <textarea
            className="sl-textarea"
            rows={6}
            aria-label={messages.export.csvPaste}
            data-testid="sl-csv-text"
            placeholder={messages.export.csvPlaceholder}
            value={csvText}
            onChange={(event) => {
              setCsvText(event.target.value);
              setMapping(null);
              setDryRun(null);
            }}
          />

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="sl-btn"
              data-testid="sl-csv-check"
              disabled={csvText.trim().length === 0 || busy}
              onClick={onCheckCsv}
            >
              {messages.export.csvCheck}
            </button>
            <button
              type="button"
              className="sl-btn sl-btn-primary"
              data-testid="sl-csv-import"
              disabled={dryRun === null || mapping === null || busy || dryRun.toCreate === 0}
              onClick={() => void onImportCsv()}
            >
              {messages.export.csvImport}
            </button>
          </div>

          {dryRun !== null ? (
            <>
              <p className="text-sm font-medium" data-testid="sl-csv-summary">
                {format(messages.export.csvSummary, {
                  create: dryRun.toCreate,
                  skip: dryRun.skipped,
                })}
              </p>
              <div className="sl-diff-table" data-testid="sl-csv-mapping">
                {fields.map((field) => (
                  <div key={field} className="flex items-center justify-between gap-2 text-xs">
                    <label className="text-muted" htmlFor={`sl-map-${field}`}>
                      {field}
                    </label>
                    <select
                      id={`sl-map-${field}`}
                      className="sl-select sl-select-small"
                      data-testid={`sl-map-${field}`}
                      value={mapping?.[field] ?? ""}
                      onChange={(event) => {
                        const next = { ...(mapping ?? {}), [field]: event.target.value };
                        setMapping(next);
                        setDryRun(dryRunCsv(csvText, csvTarget, next));
                      }}
                    >
                      <option value="">—</option>
                      {header.map((column) => (
                        <option key={column} value={column}>
                          {column}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              <ul className="text-xs text-muted" data-testid="sl-csv-rows">
                {dryRun.rows.slice(0, 5).map((row) => (
                  <li key={`${row.action}-${row.label}`}>
                    {row.action === "create" ? "＋" : "−"} {row.label}
                    {row.reason.length > 0 ? ` (${row.reason})` : ""}
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          {csvDone !== null ? (
            <p className="sl-notice" data-testid="sl-csv-done" role="status">
              {csvDone}
            </p>
          ) : null}
        </section>
      ) : null}

      {mode === "import-manuscript" ? (
        <section className="sl-card flex flex-col gap-3" data-testid="sl-manuscript-panel">
          <textarea
            className="sl-textarea"
            rows={8}
            aria-label={messages.export.manuscriptPaste}
            data-testid="sl-manuscript-text"
            placeholder={messages.export.manuscriptPlaceholder}
            value={manuscriptText}
            onChange={(event) => {
              setManuscriptText(event.target.value);
              setSplit(null);
            }}
          />

          <div className="flex flex-wrap gap-3">
            <div className="sl-field">
              <label className="sl-label" htmlFor="sl-split-heading">
                {messages.export.splitHeading}
              </label>
              <select
                id="sl-split-heading"
                className="sl-select"
                data-testid="sl-split-heading"
                value={String(splitOptions.headingLevel)}
                onChange={(event) => {
                  setSplitOptions((current) => ({
                    ...current,
                    headingLevel: Number(event.target.value) as 1 | 2 | 3,
                  }));
                  setSplit(null);
                }}
              >
                <option value="1">#</option>
                <option value="2">##</option>
                <option value="3">###</option>
              </select>
            </div>
            <div className="sl-field">
              <label className="sl-label" htmlFor="sl-split-break">
                {messages.export.splitBreak}
              </label>
              <select
                id="sl-split-break"
                className="sl-select"
                data-testid="sl-split-break"
                value={splitOptions.sceneBreak}
                onChange={(event) => {
                  setSplitOptions((current) => ({
                    ...current,
                    sceneBreak: event.target.value as SplitOptions["sceneBreak"],
                  }));
                  setSplit(null);
                }}
              >
                <option value="asterisks">***</option>
                <option value="hash">#</option>
                <option value="blank">{messages.export.splitBreakBlank}</option>
              </select>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="sl-btn"
              data-testid="sl-split-preview"
              disabled={manuscriptText.trim().length === 0 || busy}
              onClick={onPreviewSplit}
            >
              {messages.export.splitPreview}
            </button>
            <button
              type="button"
              className="sl-btn sl-btn-primary"
              data-testid="sl-split-import"
              disabled={split === null || split.sceneCount === 0 || busy}
              onClick={() => void onImportManuscript()}
            >
              {messages.export.splitImport}
            </button>
          </div>

          {split !== null ? (
            <p className="text-sm font-medium" data-testid="sl-split-summary">
              {format(messages.export.splitSummary, {
                chapters: split.chapters.length,
                scenes: split.sceneCount,
                words: formatNumber(split.wordCount),
              })}
            </p>
          ) : null}
          {splitDone !== null ? (
            <p className="sl-notice" data-testid="sl-split-done" role="status">
              {splitDone}
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

/** Re-exported for the E2E hook: the same builder the worker runs. */
export { buildExportFile };
