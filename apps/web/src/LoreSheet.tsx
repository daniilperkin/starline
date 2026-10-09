import {
  type CustomFieldDef,
  categoryPath,
  entryPath,
  LORE_ALIASES_MAX,
  LORE_KIND_GLYPHS,
  LORE_KINDS,
  LORE_NAME_MAX,
  LORE_SUMMARY_MAX,
  type LoreCategory,
  type LoreEntrySummary,
  type LoreKind,
  messages,
  type RichText,
  type UUID,
} from "@starline/core";
import { useEffect, useMemo, useState } from "react";
import {
  useDeleteLoreEntry,
  useFieldValues,
  useLoreEntry,
  useLoreFieldDefs,
  useMentionables,
  useMoveLoreEntry,
  useRestoreEntity,
  useSetFieldValue,
  useUpdateLoreEntry,
} from "./data";
import { RichTextEditor } from "./RichTextEditor";
import { useUndoStore } from "./undo";
import { useAutosave } from "./useAutosave";

type Patch = {
  name: string;
  aliases: string;
  summary: string;
  body: RichText | null;
  kind: LoreKind;
  customKindLabel: string;
};

/**
 * The lore entry sheet (PLAN slice 6): identity (name, kind, category, inside), the summary
 * card line, aliases for `@`-matching, the rich-text body with mentions, and the custom
 * fields the kind template seeds. Text-ish fields commit on blur; every other control writes
 * immediately — one command per user action, same as the scene sheet.
 */
export function LoreSheet({
  projectId,
  entryId,
  categories,
  entries,
  onClose,
}: {
  projectId: UUID;
  entryId: UUID;
  categories: LoreCategory[];
  entries: LoreEntrySummary[];
  onClose: () => void;
}) {
  const detail = useLoreEntry(projectId, entryId);
  const mentionables = useMentionables(projectId);
  const update = useUpdateLoreEntry();
  const move = useMoveLoreEntry();
  const remove = useDeleteLoreEntry();
  const restore = useRestoreEntity();
  const pushUndo = useUndoStore((state) => state.push);

  const [patch, setPatch] = useState<Patch | null>(null);
  const [fieldDrafts, setFieldDrafts] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const loaded = detail.data;
  useEffect(() => {
    if (!loaded || patch !== null) return;
    setPatch({
      name: loaded.name,
      aliases: loaded.aliases.join(", "),
      summary: loaded.summary,
      body: loaded.body.json === null ? null : loaded.body,
      kind: loaded.kind,
      customKindLabel: loaded.customKindLabel,
    });
  }, [loaded, patch]);

  useAutosave(patch, async (value) => {
    if (value === null) return true;
    return update
      .mutateAsync({
        projectId,
        entryId,
        patch: {
          name: value.name.trim().slice(0, LORE_NAME_MAX),
          aliases: value.aliases
            .split(",")
            .map((alias) => alias.trim())
            .filter((alias) => alias.length > 0)
            .slice(0, LORE_ALIASES_MAX),
          summary: value.summary.slice(0, LORE_SUMMARY_MAX),
          ...(value.body === null ? {} : { body: value.body }),
        },
      })
      .then(() => true)
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause));
        return false;
      });
  });

  const kindDefs = useLoreFieldDefs(projectId, patch?.kind ?? loaded?.kind ?? null);
  const values = useFieldValues(entryId);
  const setField = useSetFieldValue();

  const fieldValueOf = (defId: UUID): unknown => values.data?.get(defId) ?? null;

  const commitField = async (def: CustomFieldDef, value: unknown) => {
    await setField
      .mutateAsync({ defId: def.id, ownerType: "lore", ownerId: entryId, value })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
  };

  const categoryTrail = useMemo(
    () => categoryPath(categories, loaded?.categoryId ?? null),
    [categories, loaded?.categoryId],
  );
  const entryTrail = useMemo(
    () => entryPath(entries, loaded?.parentEntryId ?? null),
    [entries, loaded?.parentEntryId],
  );

  /** Parent candidates: same category, without self or anything below self (cycle guard). */
  const parentCandidates = useMemo(() => {
    if (!loaded) return [];
    const descendants = new Set<string>();
    const walk = (id: UUID) => {
      for (const entry of entries) {
        if (entry.parentEntryId === id && !descendants.has(entry.id)) {
          descendants.add(entry.id);
          walk(entry.id);
        }
      }
    };
    walk(loaded.id);
    return entries.filter(
      (entry) =>
        entry.id !== loaded.id &&
        !descendants.has(entry.id) &&
        entry.categoryId === loaded.categoryId,
    );
  }, [entries, loaded]);

  const onDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    await remove
      .mutateAsync({ projectId, entryId })
      .then(() => {
        pushUndo(messages.undo.entryDeleted, async () => {
          await restore
            .mutateAsync({ projectId, entityType: "lore_entry", entityId: entryId })
            .catch(() => undefined);
        });
        onClose();
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
  };

  if (!loaded || patch === null) {
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
          aria-label={messages.world.heading}
        >
          <p className="text-sm text-muted">{messages.common.loading}</p>
        </section>
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        className="sl-sheet-backdrop"
        aria-label={messages.common.close}
        onClick={onClose}
      />
      <section className="sl-sheet" role="dialog" aria-modal="true" aria-label={loaded.name}>
        <div className="flex items-start justify-between gap-2">
          <p className="sl-breadcrumb text-xs text-muted">
            {messages.world.breadcrumbRoot}
            {categoryTrail.map((node) => (
              <span key={node.id}> / {node.name}</span>
            ))}
            {entryTrail.map((entry) => (
              <span key={entry.id}> / {entry.name}</span>
            ))}
          </p>
          <button type="button" className="sl-btn" onClick={onClose}>
            {messages.common.close}
          </button>
        </div>

        <div className="flex items-center gap-2">
          <span className="sl-lore-glyph" aria-hidden="true">
            {LORE_KIND_GLYPHS[patch.kind]}
          </span>
          <input
            className="sl-input flex-1"
            aria-label={messages.world.name}
            maxLength={LORE_NAME_MAX}
            value={patch.name}
            onChange={(event) =>
              setPatch((current) => current && { ...current, name: event.target.value })
            }
          />
          <button
            type="button"
            className="sl-btn"
            aria-pressed={loaded.pinned}
            aria-label={loaded.pinned ? messages.world.unpin : messages.world.pin}
            onClick={() =>
              void update
                .mutateAsync({ projectId, entryId, patch: { pinned: !loaded.pinned } })
                .catch(() => undefined)
            }
          >
            <span aria-hidden="true">{loaded.pinned ? "✦" : "✧"}</span>
          </button>
        </div>

        {error !== null ? (
          <p className="sl-error" role="alert">
            {error}
          </p>
        ) : null}

        <label className="sl-label" htmlFor="lore-kind">
          {messages.world.kind}
        </label>
        <select
          id="lore-kind"
          className="sl-select"
          value={patch.kind}
          onChange={(event) => {
            const kind = event.target.value as LoreKind;
            setPatch((current) => current && { ...current, kind });
            void update.mutateAsync({ projectId, entryId, patch: { kind } }).catch(() => undefined);
          }}
        >
          {LORE_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {messages.kinds[kind]}
            </option>
          ))}
        </select>

        {patch.kind === "custom" ? (
          <>
            <label className="sl-label" htmlFor="lore-kind-label">
              {messages.world.customKind}
            </label>
            <input
              id="lore-kind-label"
              className="sl-input"
              value={patch.customKindLabel}
              onChange={(event) =>
                setPatch(
                  (current) => current && { ...current, customKindLabel: event.target.value },
                )
              }
            />
          </>
        ) : null}

        <label className="sl-label" htmlFor="lore-category">
          {messages.world.category}
        </label>
        <select
          id="lore-category"
          className="sl-select"
          value={loaded.categoryId ?? ""}
          onChange={(event) => {
            const categoryId = event.target.value === "" ? null : (event.target.value as UUID);
            void move
              .mutateAsync({
                projectId,
                entryId,
                categoryId,
                parentEntryId: null,
                orderKey: `a${Date.now().toString(36)}`,
              })
              .catch((cause: unknown) =>
                setError(cause instanceof Error ? cause.message : String(cause)),
              );
          }}
        >
          <option value="">{messages.world.none}</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {categoryPath(categories, category.id)
                .map((node) => node.name)
                .join(" / ")}
            </option>
          ))}
        </select>

        <label className="sl-label" htmlFor="lore-parent">
          {messages.world.parentEntry}
        </label>
        <select
          id="lore-parent"
          className="sl-select"
          value={loaded.parentEntryId ?? ""}
          onChange={(event) => {
            const parentEntryId = event.target.value === "" ? null : (event.target.value as UUID);
            void move
              .mutateAsync({
                projectId,
                entryId,
                categoryId: loaded.categoryId,
                parentEntryId,
                orderKey: `a${Date.now().toString(36)}`,
              })
              .catch((cause: unknown) =>
                setError(cause instanceof Error ? cause.message : String(cause)),
              );
          }}
        >
          <option value="">{messages.world.none}</option>
          {parentCandidates.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </select>

        <label className="sl-label" htmlFor="lore-aliases">
          {messages.world.aliases}
        </label>
        <input
          id="lore-aliases"
          className="sl-input"
          aria-describedby="lore-aliases-hint"
          value={patch.aliases}
          onChange={(event) =>
            setPatch((current) => current && { ...current, aliases: event.target.value })
          }
        />
        <p id="lore-aliases-hint" className="text-xs text-muted">
          {messages.world.aliasesHint}
        </p>

        <label className="sl-label" htmlFor="lore-summary">
          {messages.world.summary}
        </label>
        <textarea
          id="lore-summary"
          className="sl-textarea"
          maxLength={LORE_SUMMARY_MAX}
          value={patch.summary}
          onChange={(event) =>
            setPatch((current) => current && { ...current, summary: event.target.value })
          }
        />
        <p className="text-xs text-muted">
          {messages.world.summaryHint.replace("{max}", String(LORE_SUMMARY_MAX))}
        </p>

        <span className="sl-label">{messages.world.body}</span>
        <RichTextEditor
          key={entryId}
          initial={patch.body ?? { json: null, text: "", wordCount: 0 }}
          ariaLabel={messages.world.body}
          mentionables={mentionables.data ?? []}
          onChange={(body) => setPatch((current) => current && { ...current, body })}
        />

        {(kindDefs.data ?? []).length > 0 ? (
          <fieldset className="sl-fieldset">
            <legend className="sl-label">{messages.world.details}</legend>
            <div className="flex flex-col gap-3">
              {(kindDefs.data ?? []).map((def) => (
                <FieldControl
                  key={def.id}
                  def={def}
                  value={fieldValueOf(def.id)}
                  draft={fieldDrafts[def.id] ?? null}
                  mentionables={mentionables.data ?? []}
                  onDraft={(text) => setFieldDrafts({ ...fieldDrafts, [def.id]: text })}
                  onCommit={(value) => void commitField(def, value)}
                />
              ))}
            </div>
          </fieldset>
        ) : null}

        <div className="flex items-center justify-between gap-2">
          <button type="button" className="sl-btn" onClick={() => void onDelete()}>
            {confirmDelete ? messages.world.deleteConfirm : messages.world.deleteEntry}
          </button>
          <span className="text-xs text-muted">{messages.common.saved}</span>
        </div>
      </section>
    </>
  );
}

/** One template field, rendered by type. Text-likes commit on blur; the rest on change. */
function FieldControl({
  def,
  value,
  draft,
  mentionables,
  onDraft,
  onCommit,
}: {
  def: CustomFieldDef;
  value: unknown;
  draft: string | null;
  mentionables: { id: UUID; label: string; type: string }[];
  onDraft: (text: string) => void;
  onCommit: (value: unknown) => void;
}) {
  const id = `field-${def.id}`;
  const text = draft ?? (value === null ? "" : String(value));

  if (def.type === "boolean") {
    return (
      <label className="flex items-center gap-2 text-sm" htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          checked={value === true}
          onChange={(event) => onCommit(event.target.checked)}
        />
        {def.label}
      </label>
    );
  }

  if (def.type === "select" || def.type === "multiselect") {
    const options = def.options ?? [];
    if (def.type === "multiselect") {
      const selected = new Set(Array.isArray(value) ? value.map(String) : []);
      return (
        <fieldset className="flex flex-col gap-1">
          <legend className="sl-label">{def.label}</legend>
          {options.map((option) => (
            <label key={option} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={selected.has(option)}
                onChange={(event) => {
                  const next = new Set(selected);
                  if (event.target.checked) next.add(option);
                  else next.delete(option);
                  onCommit([...next]);
                }}
              />
              {option}
            </label>
          ))}
        </fieldset>
      );
    }
    return (
      <>
        <label className="sl-label" htmlFor={id}>
          {def.label}
        </label>
        <select
          id={id}
          className="sl-select"
          value={value === null ? "" : String(value)}
          onChange={(event) => onCommit(event.target.value === "" ? null : event.target.value)}
        >
          <option value="">{messages.fields.empty}</option>
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </>
    );
  }

  if (def.type === "entity_ref") {
    return (
      <>
        <label className="sl-label" htmlFor={id}>
          {def.label}
        </label>
        <select
          id={id}
          className="sl-select"
          value={value === null ? "" : String(value)}
          onChange={(event) => onCommit(event.target.value === "" ? null : event.target.value)}
        >
          <option value="">{messages.fields.empty}</option>
          {mentionables.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </>
    );
  }

  const inputType =
    def.type === "number"
      ? "number"
      : def.type === "date"
        ? "date"
        : def.type === "color"
          ? "color"
          : "text";

  return (
    <>
      <label className="sl-label" htmlFor={id}>
        {def.label}
      </label>
      {def.type === "longtext" ? (
        <textarea
          id={id}
          className="sl-textarea"
          value={text}
          onChange={(event) => onDraft(event.target.value)}
          onBlur={() => onCommit(text)}
        />
      ) : (
        <input
          id={id}
          className="sl-input"
          type={inputType}
          value={text}
          onChange={(event) => onDraft(event.target.value)}
          onBlur={() => onCommit(text)}
        />
      )}
    </>
  );
}
