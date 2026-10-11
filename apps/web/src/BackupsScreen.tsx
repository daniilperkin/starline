import {
  format,
  messages,
  plural,
  type RestorableKind,
  SNAPSHOT_COUNT_KEYS,
  type SnapshotCountKey,
  type SnapshotDiff,
} from "@starline/core";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { formatDateTime, formatNumber } from "./locale";
import { useSessionStore } from "./session";
import {
  chooseMirrorFolder,
  clearMirrorFolder,
  listSnapshotsWithRecords,
  type MirrorState,
  mirrorAll,
  mirrorState,
  previewSnapshot,
  reconcileSnapshotIndex,
  restoreEntityFromFile,
  restoreSnapshot,
  type SnapshotEntry,
  type SnapshotPreview,
  takeSnapshot,
} from "./snapshots";

type Row = SnapshotEntry & { wordCount: number; sceneCount: number };

const KIND_LABEL: Record<RestorableKind, "entityCharacter" | "entityScene" | "entityLore"> = {
  character: "entityCharacter",
  scene: "entityScene",
  lore_entry: "entityLore",
};

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function relative(timestamp: number): string {
  const seconds = Math.round((Date.now() - timestamp) / 1000);
  if (seconds < 90) return messages.time.justNow;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return plural(messages.time.minutesAgo, minutes);
  const hours = Math.round(minutes / 60);
  if (hours < 36) return plural(messages.time.hoursAgo, hours);
  return formatDateTime(timestamp);
}

/** One delta in the preview: "+3 scenes", "−1 character", "2,140 words changed". */
function deltaText(diff: SnapshotDiff): string[] {
  const parts: string[] = [];
  for (const key of SNAPSHOT_COUNT_KEYS) {
    const value = diff.delta[key as SnapshotCountKey];
    if (key === "words") continue;
    if (value === 0) continue;
    const noun = plural(messages.backups.what[key], Math.abs(value));
    parts.push(
      value > 0
        ? format(messages.backups.deltaAdded, { n: value, what: noun })
        : format(messages.backups.deltaRemoved, { n: Math.abs(value), what: noun }),
    );
  }
  if (diff.delta.words !== 0) {
    parts.push(
      plural(messages.backups.deltaWords, Math.abs(diff.delta.words), {
        n: formatNumber(Math.abs(diff.delta.words)),
      }),
    );
  }
  return parts;
}

/**
 * Backups screen (spec §4.5.3, slice 11): every snapshot of this library with its reason, time
 * and counts; a read-only preview that says what changed since; a full restore that snapshots
 * the current state first; and "restore one item", which copies a single character, scene or
 * lore entry back out of an older snapshot. The mirror folder is configured here too.
 */
export function BackupsScreen() {
  const session = useSessionStore((state) => state.session);
  const setSession = useSessionStore((state) => state.setSession);
  const navigate = useNavigate();

  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<SnapshotPreview | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [entityPick, setEntityPick] = useState<string>("");
  const [mirror, setMirror] = useState<MirrorState>(() => mirrorState());

  const refresh = useCallback(async () => {
    if (!session) return;
    try {
      // The files are authoritative; align the index before reading it (spec §3.9).
      await reconcileSnapshotIndex(session).catch(() => undefined);
      setRows(await listSnapshotsWithRecords(session));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [session]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!session) return null;

  const onSnapshotNow = async () => {
    setBusy("snapshot");
    setError(null);
    try {
      await takeSnapshot(session, "manual");
      setNotice(messages.backups.noticeSnapshotted);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const onPreview = async (row: Row) => {
    setBusy(`preview:${row.name}`);
    setError(null);
    setEntityPick("");
    try {
      setPreview(await previewSnapshot(session, row));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const onRestore = async (row: Row) => {
    setBusy(`restore:${row.name}`);
    setError(null);
    try {
      const { opened } = await restoreSnapshot(session, row);
      // The restore ended with a brand-new session (new worker over the replaced file): adopt
      // it, then send the writer back to the plan they were looking at.
      setSession(opened);
      setPreview(null);
      setConfirm(null);
      setNotice(messages.backups.restoreDone);
      await navigate({ to: "/plan" });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const onRestoreEntity = async (row: Row) => {
    if (entityPick.length === 0) return;
    const [kind, id] = entityPick.split(":") as [RestorableKind, string];
    setBusy(`entity:${row.name}`);
    setError(null);
    try {
      const result = await restoreEntityFromFile(session, row, kind, id);
      setNotice(
        plural(messages.backups.restoreEntityDone, result.restored) +
          (result.skipped > 0
            ? ` ${plural(messages.backups.restoreEntitySkipped, result.skipped)}`
            : ""),
      );
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const onChooseMirror = async () => {
    setBusy("mirror");
    try {
      const state = await chooseMirrorFolder();
      setMirror(state);
      if (state.folder.length > 0) {
        const copied = await mirrorAll(session.name);
        setNotice(format(messages.backups.mirrorDone, { n: copied }));
      }
    } finally {
      setBusy(null);
    }
  };

  const onStopMirror = async () => {
    await clearMirrorFolder();
    setMirror(mirrorState());
  };

  const previewRow = preview === null ? null : rows?.find((row) => row.name === preview.entry.name);

  return (
    <div className="flex flex-1 flex-col gap-4">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold tracking-tight">{messages.backups.heading}</h1>
        <span className="sl-chip">{rows?.length ?? 0}</span>
        <button
          type="button"
          className="sl-btn-small ml-auto"
          data-testid="sl-backup-now"
          disabled={busy !== null}
          onClick={() => void onSnapshotNow()}
        >
          {busy === "snapshot" ? messages.backups.taking : messages.backups.now}
        </button>
      </header>
      <p className="text-sm text-muted">{messages.backups.subtitle}</p>

      {notice ? (
        <p className="sl-notice" role="status" data-testid="sl-backup-notice">
          {notice}
        </p>
      ) : null}
      {error ? <p className="sl-error">{error}</p> : null}

      <div className="sl-card" data-testid="sl-backup-list">
        {rows === null ? null : rows.length === 0 ? (
          <>
            <p className="text-sm font-medium">{messages.backups.empty}</p>
            <p className="text-xs text-muted">{messages.backups.emptyHint}</p>
          </>
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((row) => (
              <li key={row.name} className="sl-backup-row" data-testid="sl-backup-row">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    <span className="sl-chip sl-chip-reason">
                      {messages.backups.reasons[row.reason] ?? row.reason}
                    </span>
                    <span className="truncate">{relative(row.createdAt)}</span>
                  </p>
                  <p className="text-xs text-muted">
                    {format(messages.backups.counts, {
                      scenes: row.sceneCount,
                      words: formatNumber(row.wordCount),
                    })}{" "}
                    · {formatBytes(row.byteSize)}
                    {row.label.length > 0 ? ` · ${row.label}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    className="sl-btn-small"
                    data-testid="sl-backup-preview"
                    disabled={busy !== null}
                    onClick={() => void onPreview(row)}
                  >
                    {busy === `preview:${row.name}` ? "…" : messages.backups.preview}
                  </button>
                  <button
                    type="button"
                    className="sl-btn-small sl-danger"
                    data-testid="sl-backup-restore"
                    disabled={busy !== null}
                    onClick={() => setConfirm(row.name)}
                  >
                    {messages.backups.restore}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="sl-card">
        <p className="text-sm font-medium">{messages.backups.mirrorHeading}</p>
        <p className="text-xs text-muted" data-testid="sl-mirror-state">
          {mirror.folder.length > 0
            ? format(messages.backups.mirrorOn, { folder: mirror.folder })
            : mirror.kind === "unavailable"
              ? messages.backups.mirrorUnavailable
              : messages.backups.mirrorOff}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            className="sl-btn-small"
            data-testid="sl-mirror-choose"
            disabled={busy !== null}
            onClick={() => void onChooseMirror()}
          >
            {messages.backups.mirrorChoose}
          </button>
          {mirror.folder.length > 0 ? (
            <button type="button" className="sl-btn-small" onClick={() => void onStopMirror()}>
              {messages.backups.mirrorStop}
            </button>
          ) : null}
        </div>
      </div>

      {preview && previewRow ? (
        <>
          <button
            type="button"
            className="sl-sheet-backdrop"
            aria-label={messages.backups.close}
            onClick={() => setPreview(null)}
          />
          <section
            className="sl-sheet"
            role="dialog"
            aria-modal="true"
            aria-label={messages.backups.previewTitle}
            data-testid="sl-backup-preview-sheet"
          >
            <header className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold tracking-tight">
                {messages.backups.previewTitle}
              </h2>
              <button
                type="button"
                className="sl-btn"
                aria-label={messages.backups.close}
                onClick={() => setPreview(null)}
              >
                ✕
              </button>
            </header>

            <p className="text-xs text-muted">
              {messages.backups.reasons[previewRow.reason] ?? previewRow.reason} ·{" "}
              {relative(previewRow.createdAt)}
            </p>

            {preview.diff.identical ? (
              <p className="text-sm" data-testid="sl-diff-summary">
                {messages.backups.noChanges}
              </p>
            ) : (
              <p className="text-sm font-medium" data-testid="sl-diff-summary">
                {deltaText(preview.diff).join(" · ")}
              </p>
            )}

            <dl className="sl-diff-table" data-testid="sl-diff-table">
              {SNAPSHOT_COUNT_KEYS.map((key) => (
                <div key={key} className="flex items-center justify-between gap-3 text-xs">
                  <dt className="text-muted">
                    {plural(messages.backups.what[key], preview.diff.snapshot[key])}
                  </dt>
                  <dd>
                    {formatNumber(preview.diff.snapshot[key])}
                    <span className="text-muted"> → {formatNumber(preview.diff.current[key])}</span>
                  </dd>
                </div>
              ))}
            </dl>

            <div className="sl-field">
              <label className="sl-label" htmlFor="sl-entity-pick">
                {messages.backups.restoreEntity}
              </label>
              <select
                id="sl-entity-pick"
                className="sl-select"
                data-testid="sl-entity-pick"
                value={entityPick}
                onChange={(event) => setEntityPick(event.target.value)}
              >
                <option value="">—</option>
                {preview.entities.map((entity) => (
                  <option key={`${entity.kind}:${entity.id}`} value={`${entity.kind}:${entity.id}`}>
                    {messages.backups[KIND_LABEL[entity.kind]]}: {entity.name}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted">{messages.backups.restoreEntityHint}</p>
            </div>
            <button
              type="button"
              className="sl-btn sl-btn-primary"
              data-testid="sl-entity-restore"
              disabled={entityPick.length === 0 || busy !== null}
              onClick={() => void onRestoreEntity(previewRow)}
            >
              {messages.backups.restoreEntityDo}
            </button>
          </section>
        </>
      ) : null}

      {confirm !== null ? (
        <>
          <button
            type="button"
            className="sl-sheet-backdrop"
            aria-label={messages.backups.close}
            onClick={() => setConfirm(null)}
          />
          <section
            className="sl-sheet"
            role="dialog"
            aria-modal="true"
            aria-label={messages.backups.restoreConfirm}
            data-testid="sl-restore-confirm"
          >
            <h2 className="text-lg font-semibold tracking-tight">
              {messages.backups.restoreConfirm}
            </h2>
            <p className="text-xs text-muted">{messages.backups.guard}</p>
            <div className="flex gap-2">
              <button
                type="button"
                className="sl-btn sl-btn-primary"
                data-testid="sl-restore-confirm-yes"
                disabled={busy !== null}
                onClick={() => {
                  const row = rows?.find((entry) => entry.name === confirm);
                  if (row) void onRestore(row);
                }}
              >
                {busy?.startsWith("restore:")
                  ? messages.backups.restoring
                  : messages.backups.restore}
              </button>
              <button type="button" className="sl-btn" onClick={() => setConfirm(null)}>
                {messages.backups.close}
              </button>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
