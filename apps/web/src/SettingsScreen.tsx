import {
  type CustomFieldTarget,
  type CustomFieldType,
  FIELD_TARGETS,
  FIELD_TYPES,
  LORE_KINDS,
  messages,
  TAG_COLORS,
  type UUID,
} from "@starline/core";
import { useState } from "react";

import {
  useCreateFieldDef,
  useCreateTag,
  useDeleteFieldDef,
  useDeleteTag,
  useFieldDefsAdmin,
  useMergeTags,
  useMoveFieldDef,
  useProjects,
  useRenameTag,
  useSetTagColor,
  useTags,
} from "./data";
import { UndoToast } from "./UndoToast";

type Section = "tags" | "fields";

/**
 * Settings (spec §4.6) — slice 9 ships its first two sections: the tag manager and the custom
 * field definitions. Both are project-wide lists, so they live here rather than inside a
 * screen that happens to show one entity.
 */
export function SettingsScreen() {
  const [section, setSection] = useState<Section>("tags");
  const projects = useProjects();
  const project = projects.data?.[0] ?? null;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center gap-2">
        <h1 className="text-xl font-semibold tracking-tight">{messages.settings.heading}</h1>
        <fieldset className="sl-segmented sl-fieldset ml-auto">
          <legend className="sr-only">{messages.settings.heading}</legend>
          {(["tags", "fields"] as const).map((option) => (
            <button
              key={option}
              type="button"
              className="sl-segment"
              aria-pressed={section === option}
              data-testid={`sl-settings-${option}`}
              onClick={() => setSection(option)}
            >
              {option === "tags" ? messages.settings.tags : messages.settings.fields}
            </button>
          ))}
        </fieldset>
      </header>

      {project === null ? (
        <p className="text-sm text-muted">{messages.settings.noProject}</p>
      ) : section === "tags" ? (
        <TagsPanel projectId={project.id} />
      ) : (
        <FieldsPanel projectId={project.id} />
      )}
      <UndoToast />
    </div>
  );
}

// ── Tags ────────────────────────────────────────────────────────────────────────────────────

function TagsPanel({ projectId }: { projectId: UUID }) {
  const tags = useTags(projectId);
  const create = useCreateTag();
  const rename = useRenameTag();
  const recolour = useSetTagColor();
  const remove = useDeleteTag();
  const merge = useMergeTags();

  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<UUID | null>(null);
  const [editName, setEditName] = useState("");
  const [mergeSource, setMergeSource] = useState<UUID | null>(null);
  const [mergeTarget, setMergeTarget] = useState<UUID | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<UUID | null>(null);

  const list = tags.data ?? [];
  const error = create.error ?? rename.error ?? merge.error ?? remove.error;

  const commitCreate = () => {
    const name = draft.trim();
    if (name.length === 0) return;
    create.mutate({ projectId, name }, { onSuccess: () => setDraft("") });
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">{messages.tags.hint}</p>

      <div className="flex items-center gap-2">
        <input
          className="sl-input min-w-0 flex-1"
          value={draft}
          placeholder={messages.tags.namePlaceholder}
          aria-label={messages.tags.namePlaceholder}
          data-testid="sl-tag-name-input"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") commitCreate();
          }}
        />
        <button
          type="button"
          className="sl-btn sl-btn-primary"
          data-testid="sl-tag-create"
          disabled={draft.trim().length === 0 || create.isPending}
          onClick={commitCreate}
        >
          {messages.tags.create}
        </button>
      </div>
      {error ? <p className="sl-error">{error.message}</p> : null}

      {list.length === 0 ? (
        <div className="sl-card">
          <p className="text-sm font-medium">{messages.tags.none}</p>
          <p className="text-xs text-muted">{messages.tags.noneHint}</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="sl-tag-list">
          {list.map((tag) => (
            <li key={tag.id} className="sl-card sl-tag-row" data-testid="sl-tag-row">
              <div className="flex items-center gap-2">
                <span className="sl-dot" style={{ background: tag.color }} aria-hidden="true" />
                {editing === tag.id ? (
                  <input
                    className="sl-input min-w-0 flex-1"
                    value={editName}
                    aria-label={messages.tags.rename}
                    data-testid="sl-tag-rename-input"
                    onChange={(event) => setEditName(event.target.value)}
                    onBlur={() => {
                      const name = editName.trim();
                      if (name.length > 0 && name !== tag.name) {
                        rename.mutate({ projectId, tagId: tag.id, name });
                      }
                      setEditing(null);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") event.currentTarget.blur();
                      if (event.key === "Escape") setEditing(null);
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="sl-tag-name min-w-0 flex-1 truncate text-left"
                    title={messages.tags.renameHint}
                    data-testid="sl-tag-name"
                    onClick={() => {
                      setEditing(tag.id);
                      setEditName(tag.name);
                    }}
                  >
                    {tag.name}
                  </button>
                )}
                <span className="text-xs text-muted" data-testid="sl-tag-count">
                  {tag.count === 1
                    ? messages.tags.countOne
                    : messages.tags.count.replace("{count}", String(tag.count))}
                </span>
              </div>

              <fieldset className="sl-swatches sl-fieldset">
                <legend className="sr-only">{messages.tags.color}</legend>
                {TAG_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className="sl-swatch"
                    aria-pressed={tag.color === color}
                    aria-label={`${messages.tags.color} ${color}`}
                    data-testid="sl-tag-color"
                    style={{ background: color }}
                    onClick={() => recolour.mutate({ projectId, tagId: tag.id, color })}
                  />
                ))}
              </fieldset>

              <div className="flex items-center gap-2">
                {mergeSource === tag.id ? (
                  <>
                    <label className="sl-label" htmlFor={`merge-target-${tag.id}`}>
                      {messages.tags.mergeInto}
                    </label>
                    <select
                      id={`merge-target-${tag.id}`}
                      className="sl-select min-w-0 flex-1"
                      value={mergeTarget ?? ""}
                      data-testid="sl-tag-merge-target"
                      onChange={(event) => setMergeTarget(event.target.value as UUID)}
                    >
                      <option value="">—</option>
                      {list
                        .filter((other) => other.id !== tag.id)
                        .map((other) => (
                          <option key={other.id} value={other.id}>
                            {other.name}
                          </option>
                        ))}
                    </select>
                    <button
                      type="button"
                      className="sl-btn-small"
                      data-testid="sl-tag-merge-confirm"
                      disabled={mergeTarget === null}
                      onClick={() => {
                        if (mergeTarget === null) return;
                        merge.mutate(
                          { projectId, sourceTagId: tag.id, targetTagId: mergeTarget },
                          {
                            onSuccess: () => {
                              setMergeSource(null);
                              setMergeTarget(null);
                            },
                          },
                        );
                      }}
                    >
                      {messages.tags.merge}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="sl-btn-small"
                    data-testid="sl-tag-merge"
                    disabled={list.length < 2}
                    onClick={() => {
                      setMergeSource(tag.id);
                      setMergeTarget(null);
                    }}
                  >
                    {messages.tags.merge}
                  </button>
                )}
                <button
                  type="button"
                  className="sl-btn-small sl-danger ml-auto"
                  data-testid="sl-tag-delete"
                  onClick={() => {
                    if (confirmDelete !== tag.id && tag.count > 0) {
                      setConfirmDelete(tag.id);
                      return;
                    }
                    remove.mutate({ projectId, tagId: tag.id });
                    setConfirmDelete(null);
                  }}
                >
                  {confirmDelete === tag.id
                    ? `${messages.tags.delete}?`
                    : tag.count > 0
                      ? messages.tags.inUse.replace("{count}", String(tag.count))
                      : messages.tags.delete}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Custom fields ───────────────────────────────────────────────────────────────────────────

function FieldsPanel({ projectId }: { projectId: UUID }) {
  const defs = useFieldDefsAdmin(projectId);
  const create = useCreateFieldDef();
  const move = useMoveFieldDef();
  const remove = useDeleteFieldDef();

  const [target, setTarget] = useState<CustomFieldTarget>("scene");
  const [label, setLabel] = useState("");
  const [type, setType] = useState<CustomFieldType>("text");
  const [section, setSection] = useState("");
  const [options, setOptions] = useState("");
  const [loreKind, setLoreKind] = useState("");
  const [required, setRequired] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<UUID | null>(null);

  const needsOptions = type === "select" || type === "multiselect";
  const list = defs.data ?? [];
  const error = create.error ?? move.error ?? remove.error;

  const commit = () => {
    const name = label.trim();
    if (name.length === 0) return;
    create.mutate(
      {
        projectId,
        target,
        label: name,
        type,
        section: section.trim(),
        options: needsOptions
          ? options
              .split(",")
              .map((entry) => entry.trim())
              .filter((entry) => entry.length > 0)
          : null,
        loreKind: target === "lore" && loreKind.length > 0 ? loreKind : null,
        required,
      },
      {
        onSuccess: () => {
          setLabel("");
          setOptions("");
        },
      },
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">{messages.fieldDefs.hint}</p>

      <div className="sl-card flex flex-col gap-2">
        <div className="sl-field">
          <label className="sl-label" htmlFor="field-target">
            {messages.fieldDefs.target}
          </label>
          <select
            id="field-target"
            className="sl-select"
            value={target}
            data-testid="sl-field-target"
            onChange={(event) => setTarget(event.target.value as CustomFieldTarget)}
          >
            {FIELD_TARGETS.map((option) => (
              <option key={option} value={option}>
                {messages.fieldDefs.targets[option]}
              </option>
            ))}
          </select>
        </div>

        <div className="sl-field">
          <label className="sl-label" htmlFor="field-label">
            {messages.fieldDefs.label}
          </label>
          <input
            id="field-label"
            className="sl-input"
            value={label}
            placeholder={messages.fieldDefs.labelPlaceholder}
            data-testid="sl-field-label"
            onChange={(event) => setLabel(event.target.value)}
          />
        </div>

        <div className="sl-field">
          <label className="sl-label" htmlFor="field-type">
            {messages.fieldDefs.type}
          </label>
          <select
            id="field-type"
            className="sl-select"
            value={type}
            data-testid="sl-field-type"
            onChange={(event) => setType(event.target.value as CustomFieldType)}
          >
            {FIELD_TYPES.map((option) => (
              <option key={option} value={option}>
                {messages.fieldDefs.types[option]}
              </option>
            ))}
          </select>
        </div>

        {needsOptions ? (
          <div className="sl-field">
            <label className="sl-label" htmlFor="field-options">
              {messages.fieldDefs.options}
            </label>
            <input
              id="field-options"
              className="sl-input"
              value={options}
              placeholder={messages.fieldDefs.optionsHint}
              data-testid="sl-field-options"
              onChange={(event) => setOptions(event.target.value)}
            />
          </div>
        ) : null}

        {target === "lore" ? (
          <div className="sl-field">
            <label className="sl-label" htmlFor="field-lore-kind">
              {messages.fieldDefs.loreKind}
            </label>
            <select
              id="field-lore-kind"
              className="sl-select"
              value={loreKind}
              data-testid="sl-field-lore-kind"
              onChange={(event) => setLoreKind(event.target.value)}
            >
              <option value="">{messages.fieldDefs.allKinds}</option>
              {LORE_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {messages.kinds[kind]}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <div className="sl-field">
          <label className="sl-label" htmlFor="field-section">
            {messages.fieldDefs.section}
          </label>
          <input
            id="field-section"
            className="sl-input"
            value={section}
            placeholder={messages.fieldDefs.sectionPlaceholder}
            data-testid="sl-field-section"
            onChange={(event) => setSection(event.target.value)}
          />
        </div>

        <label className="sl-check">
          <input
            type="checkbox"
            checked={required}
            data-testid="sl-field-required"
            onChange={(event) => setRequired(event.target.checked)}
          />
          {messages.fieldDefs.required}
        </label>

        <button
          type="button"
          className="sl-btn sl-btn-primary"
          data-testid="sl-field-add"
          disabled={label.trim().length === 0 || create.isPending}
          onClick={commit}
        >
          {messages.fieldDefs.add}
        </button>
        {error ? <p className="sl-error">{error.message}</p> : null}
      </div>

      {list.length === 0 ? (
        <p className="text-sm text-muted">{messages.fieldDefs.none}</p>
      ) : (
        FIELD_TARGETS.map((targetName) => {
          const group = list.filter((def) => def.target === targetName);
          if (group.length === 0) return null;
          return (
            <section key={targetName} className="flex flex-col gap-2">
              <h2 className="text-sm font-medium">{messages.fieldDefs.targets[targetName]}</h2>
              <ul className="flex flex-col gap-2" data-testid="sl-field-list">
                {group.map((def, index) => (
                  <li key={def.id} className="sl-card sl-tag-row" data-testid="sl-field-row">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">
                        {def.label}
                      </span>
                      <span className="text-xs text-muted">
                        {messages.fieldDefs.types[def.type]}
                        {def.section.length > 0 ? ` · ${def.section}` : ""}
                        {def.loreKind !== null ? ` · ${messages.kinds[def.loreKind as never]}` : ""}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted" data-testid="sl-field-usage">
                        {def.usage === 0
                          ? messages.fieldDefs.usageNone
                          : messages.fieldDefs.usage.replace("{count}", String(def.usage))}
                      </span>
                      <button
                        type="button"
                        className="sl-btn-small ml-auto"
                        aria-label={messages.fieldDefs.moveUp}
                        data-testid="sl-field-up"
                        disabled={index === 0}
                        onClick={() => move.mutate({ projectId, defId: def.id, direction: "up" })}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="sl-btn-small"
                        aria-label={messages.fieldDefs.moveDown}
                        data-testid="sl-field-down"
                        disabled={index === group.length - 1}
                        onClick={() => move.mutate({ projectId, defId: def.id, direction: "down" })}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        className="sl-btn-small sl-danger"
                        data-testid="sl-field-delete"
                        onClick={() => {
                          if (confirmDelete !== def.id && def.usage > 0) {
                            setConfirmDelete(def.id);
                            return;
                          }
                          remove.mutate({ projectId, defId: def.id });
                          setConfirmDelete(null);
                        }}
                      >
                        {confirmDelete === def.id
                          ? `${messages.fieldDefs.delete}?`
                          : messages.fieldDefs.delete}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}
    </div>
  );
}
