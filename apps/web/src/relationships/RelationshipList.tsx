import {
  format,
  messages,
  RELATIONSHIP_KIND_GLYPHS,
  type RelationshipCharacter,
  type RelationshipEdge,
  type RelationshipGroupSummary,
  sentimentColor,
} from "@starline/core";

/**
 * The accessibility twin of the matrix and the graph (spec §4.2.3: "the graph has a 'List view'
 * twin (same data as a keyboard-navigable table) — required for screen readers"). It reads the
 * same edge list and is the only view that is complete without spatial reasoning.
 */
export interface RelationshipListProps {
  edges: RelationshipEdge[];
  characters: RelationshipCharacter[];
  groups: RelationshipGroupSummary[];
  onEdit: (edge: RelationshipEdge) => void;
}

export function RelationshipList({ edges, characters, groups, onEdit }: RelationshipListProps) {
  const names = new Map(characters.map((character) => [character.id, character.name]));
  const groupNames = new Map(groups.map((group) => [group.id, group.name]));
  const sorted = [...edges].sort((a, b) => {
    const from = (names.get(a.sourceId) ?? "").localeCompare(names.get(b.sourceId) ?? "");
    if (from !== 0) return from;
    return (names.get(a.targetId) ?? "").localeCompare(names.get(b.targetId) ?? "");
  });

  if (sorted.length === 0) {
    return (
      <div className="sl-empty">
        <p className="text-sm font-medium">{messages.relationships.none}</p>
        <p className="mt-1 text-xs text-muted">{messages.relationships.noneHint}</p>
      </div>
    );
  }

  return (
    <table className="sl-rel-table" data-testid="sl-rel-list">
      <caption className="sr-only">{messages.relationships.heading}</caption>
      <thead>
        <tr>
          <th scope="col">{messages.relationships.from}</th>
          <th scope="col">{messages.relationships.kind}</th>
          <th scope="col">{messages.relationships.to}</th>
          <th scope="col">{messages.relationships.sentiment}</th>
          <th scope="col">{messages.relationships.group}</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((edge) => (
          <tr key={edge.id}>
            <td>{names.get(edge.sourceId) ?? "—"}</td>
            <td>
              <button
                type="button"
                className="sl-rel-kind"
                onClick={() => onEdit(edge)}
                aria-label={`${messages.relationshipKinds[edge.kind]} — ${messages.relationships.edit}`}
                data-testid="sl-rel-list-edit"
              >
                <span className="sl-rel-glyph" aria-hidden="true">
                  {RELATIONSHIP_KIND_GLYPHS[edge.kind]}
                </span>
                {edge.kind === "custom" && edge.customLabel.length > 0
                  ? edge.customLabel
                  : messages.relationshipKinds[edge.kind]}
                {edge.directed ? <span aria-hidden="true"> →</span> : null}
                {edge.secret ? <span aria-hidden="true"> ✦</span> : null}
              </button>
            </td>
            <td>{names.get(edge.targetId) ?? "—"}</td>
            <td>
              <span className="sl-rel-feeling" style={{ color: sentimentColor(edge.sentiment) }}>
                {edge.sentiment > 0 ? `+${edge.sentiment}` : edge.sentiment}{" "}
                {messages.relationships.feelings[String(edge.sentiment) as "0"]}
              </span>
            </td>
            <td>
              {edge.groupId
                ? (groupNames.get(edge.groupId) ?? "—")
                : messages.relationships.noGroup}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Screen-reader summary for one cell (used by the matrix). */
export function cellSummary(edge: RelationshipEdge, count: number): string {
  const kind =
    edge.kind === "custom" && edge.customLabel.length > 0
      ? edge.customLabel
      : messages.relationshipKinds[edge.kind];
  const feeling = messages.relationships.feelings[String(edge.sentiment) as "0"];
  return count > 1
    ? `${kind}, ${feeling}, ${format(messages.matrix.more, { count: count - 1 })}`
    : `${kind}, ${feeling}`;
}
