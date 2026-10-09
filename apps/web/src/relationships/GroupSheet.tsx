import {
  messages,
  RELATIONSHIP_GROUP_SWATCHES,
  type RelationshipEdge,
  type RelationshipGroupSummary,
  type UUID,
} from "@starline/core";
import { useState } from "react";

import {
  useCreateRelationshipGroup,
  useDeleteRelationshipGroup,
  useUpdateRelationshipGroup,
} from "../data";

/**
 * Relationship groups (spec §4.2.3 — "House Stark", "The Crew"): the labels the graph draws as
 * hulls and the matrix orders its axes by. Deleting a group never deletes an edge; it detaches
 * its members (the command reports how many).
 */
export interface GroupSheetProps {
  projectId: UUID;
  groups: RelationshipGroupSummary[];
  edges: RelationshipEdge[];
  onClose: () => void;
}

export function GroupSheet({ projectId, groups, edges, onClose }: GroupSheetProps) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(RELATIONSHIP_GROUP_SWATCHES[0] ?? "#f6c760");
  const [busy, setBusy] = useState(false);
  const create = useCreateRelationshipGroup();
  const update = useUpdateRelationshipGroup();
  const remove = useDeleteRelationshipGroup();

  const memberCount = (groupId: UUID) => edges.filter((edge) => edge.groupId === groupId).length;

  const onAdd = async () => {
    const trimmed = name.trim();
    if (trimmed.length === 0 || busy) return;
    setBusy(true);
    try {
      await create.mutateAsync({ projectId, name: trimmed, color });
      setName("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className="sl-sheet-backdrop"
        aria-label={messages.relationships.close}
        onClick={onClose}
      />
      <section
        className="sl-sheet sl-group-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={messages.relationships.group}
        data-testid="sl-group-sheet"
      >
        <header className="flex items-center gap-2">
          <h2 className="text-base font-semibold">{messages.relationships.group}</h2>
          <button type="button" className="sl-btn-small ml-auto" onClick={onClose}>
            {messages.relationships.close}
          </button>
        </header>

        {groups.length === 0 ? (
          <p className="text-xs text-muted">{messages.relationships.noneHint}</p>
        ) : (
          <ul className="sl-group-list">
            {groups.map((group) => (
              <li key={group.id} className="sl-group-row">
                <span className="sl-dot" style={{ background: group.color }} aria-hidden="true" />
                <input
                  className="sl-input sl-group-name"
                  defaultValue={group.name}
                  aria-label={messages.relationships.group}
                  onBlur={(event) => {
                    const next = event.target.value.trim();
                    if (next.length > 0 && next !== group.name) {
                      void update.mutateAsync({
                        projectId,
                        groupId: group.id,
                        patch: { name: next },
                      });
                    }
                  }}
                />
                <span className="sl-chip">{memberCount(group.id)}</span>
                <button
                  type="button"
                  className="sl-btn-small sl-danger"
                  onClick={() => void remove.mutateAsync({ projectId, groupId: group.id })}
                  data-testid="sl-group-delete"
                >
                  {messages.relationships.delete}
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="sl-group-add">
          <input
            className="sl-input flex-1"
            placeholder={messages.relationships.group}
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-label={messages.relationships.group}
          />
          <fieldset className="sl-swatches sl-fieldset">
            <legend className="sr-only">{messages.relationships.group}</legend>
            {RELATIONSHIP_GROUP_SWATCHES.map((swatch) => (
              <button
                key={swatch}
                type="button"
                className="sl-swatch"
                style={{ background: swatch }}
                aria-pressed={swatch === color}
                aria-label={swatch}
                onClick={() => setColor(swatch)}
              />
            ))}
          </fieldset>
          <button
            type="button"
            className="sl-btn"
            onClick={() => void onAdd()}
            disabled={name.trim().length === 0 || busy}
            data-testid="sl-group-add"
          >
            +
          </button>
        </div>
      </section>
    </>
  );
}
