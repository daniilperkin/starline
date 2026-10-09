import { type CustomFieldDef, type CustomFieldTarget, messages, type UUID } from "@starline/core";
import { useState } from "react";

import { useFieldDefsFor, useFieldValuesFor, useMentionables, useSetFieldValue } from "./data";

/**
 * The custom-field controls (spec §4.4). Extracted from the lore sheet in slice 9 so scenes,
 * lore entries and (next) characters render the same inputs: text-ish fields commit on blur,
 * everything else the moment it changes, and every write goes through one command.
 */
export function FieldControl({
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

/**
 * Every field definition for one target on one owner — the block that makes a new definition
 * show up on every existing entity the moment it is created (the slice's exit criterion).
 */
export function CustomFieldsSection({
  projectId,
  ownerType,
  target,
  ownerId,
  loreKind = null,
  legend,
}: {
  projectId: UUID;
  ownerType: string;
  target: CustomFieldTarget;
  ownerId: UUID;
  loreKind?: string | null;
  legend: string;
}) {
  const defs = useFieldDefsFor(projectId, target, loreKind);
  const values = useFieldValuesFor(ownerType, ownerId);
  const mentionables = useMentionables(projectId);
  const setField = useSetFieldValue();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const list = defs.data ?? [];
  if (list.length === 0) return null;

  const commit = (def: CustomFieldDef, value: unknown) => {
    void setField
      .mutateAsync({ defId: def.id, ownerType, ownerId, value })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
  };

  return (
    <fieldset className="sl-fieldset">
      <legend className="sl-label">{legend}</legend>
      <div className="flex flex-col gap-3" data-testid="sl-custom-fields">
        {list.map((def) => (
          <FieldControl
            key={def.id}
            def={def}
            value={values.data?.get(def.id) ?? null}
            draft={drafts[def.id] ?? null}
            mentionables={mentionables.data ?? []}
            onDraft={(text) => setDrafts((current) => ({ ...current, [def.id]: text }))}
            onCommit={(value) => commit(def, value)}
          />
        ))}
      </div>
      {error ? <p className="sl-error">{error}</p> : null}
    </fieldset>
  );
}
