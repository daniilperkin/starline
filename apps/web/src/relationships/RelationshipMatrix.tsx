import {
  buildMatrixCells,
  format,
  type MatrixCell,
  matrixCellKey,
  messages,
  orderCharactersByGroup,
  RELATIONSHIP_KIND_GLYPHS,
  type RelationshipCharacter,
  type RelationshipEdge,
  type RelationshipGroupSummary,
  sentimentColor,
  type UUID,
} from "@starline/core";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useMemo, useRef, useState } from "react";

import { cellSummary } from "./RelationshipList";

const CELL = 34;
const ROW_HEAD = 104;
const COL_HEAD = 38;

/**
 * Relationship matrix (spec §4.2.3): an N×N grid of characters, one cell per pair, glyph =
 * kind and background = sentiment. Both axes are virtualized (N ≤ 300 in the spec), and the
 * header strips stay pinned while the body scrolls in either direction. Tapping a cell opens the
 * edge that is already there, or creates one for an empty cell — the matrix is the fastest way
 * to fill in a cast.
 */
export interface RelationshipMatrixProps {
  characters: RelationshipCharacter[];
  edges: RelationshipEdge[];
  groups: RelationshipGroupSummary[];
  /** Tap on a cell: edit the primary edge when the cell has one, otherwise create. */
  onOpenCell: (pair: { sourceId: UUID; targetId: UUID }, cell: MatrixCell | null) => void;
}

export function RelationshipMatrix({
  characters,
  edges,
  groups,
  onOpenCell,
}: RelationshipMatrixProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState({ left: 0, top: 0 });

  const ordered = useMemo(
    () => orderCharactersByGroup(characters, edges, groups),
    [characters, edges, groups],
  );
  const cells = useMemo(() => buildMatrixCells(edges), [edges]);

  const rowVirtualizer = useVirtualizer({
    count: ordered.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => CELL,
    overscan: 4,
  });
  const colVirtualizer = useVirtualizer({
    count: ordered.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => CELL,
    horizontal: true,
    overscan: 4,
  });

  const rows = rowVirtualizer.getVirtualItems();
  const cols = colVirtualizer.getVirtualItems();
  const width = ROW_HEAD + ordered.length * CELL;
  const height = COL_HEAD + ordered.length * CELL;

  // Only the kinds that actually appear — a legend that lists 18 glyphs helps nobody.
  const legendKinds = useMemo(() => [...new Set(edges.map((edge) => edge.kind))].sort(), [edges]);

  if (ordered.length === 0) {
    return (
      <div className="sl-empty">
        <p className="text-sm font-medium">{messages.relationships.none}</p>
        <p className="mt-1 text-xs text-muted">{messages.relationships.noneHint}</p>
      </div>
    );
  }

  return (
    <div className="sl-matrix-wrap">
      <p className="sl-matrix-hint">{messages.matrix.hint}</p>
      <div
        ref={scrollRef}
        className="sl-matrix-scroll"
        data-testid="sl-matrix"
        onScroll={(event) =>
          setScroll({ left: event.currentTarget.scrollLeft, top: event.currentTarget.scrollTop })
        }
      >
        <div className="sl-matrix-canvas" style={{ width, height }}>
          {/* Column headers, pinned to the top while the body scrolls vertically. */}
          <div
            className="sl-matrix-colheads"
            style={{ transform: `translateY(${scroll.top}px)`, left: ROW_HEAD, height: COL_HEAD }}
            aria-hidden="true"
          >
            {cols.map((col) => {
              const character = ordered[col.index];
              if (!character) return null;
              return (
                <span
                  key={character.id}
                  className="sl-matrix-colhead"
                  style={{ transform: `translateX(${col.start}px)`, width: CELL }}
                  title={character.name}
                >
                  {initials(character.name)}
                </span>
              );
            })}
          </div>

          {/* Row headers, pinned to the left while the body scrolls horizontally. */}
          <div
            className="sl-matrix-rowheads"
            style={{ transform: `translateX(${scroll.left}px)`, top: COL_HEAD, width: ROW_HEAD }}
          >
            {rows.map((row) => {
              const character = ordered[row.index];
              if (!character) return null;
              return (
                <span
                  key={character.id}
                  className="sl-matrix-rowhead"
                  style={{ transform: `translateY(${row.start}px)`, height: CELL }}
                  title={character.name}
                >
                  <span
                    className="sl-dot"
                    style={{ background: character.color }}
                    aria-hidden="true"
                  />
                  {character.name}
                </span>
              );
            })}
          </div>

          {/* Body cells. */}
          {rows.map((row) => {
            const rowCharacter = ordered[row.index];
            if (!rowCharacter) return null;
            return cols.map((col) => {
              const colCharacter = ordered[col.index];
              if (!colCharacter) return null;
              const self = rowCharacter.id === colCharacter.id;
              const cell = cells.get(matrixCellKey(rowCharacter.id, colCharacter.id)) ?? null;
              const left = ROW_HEAD + col.start;
              const top = COL_HEAD + row.start;
              if (self) {
                return (
                  <span
                    key={`${rowCharacter.id}:${colCharacter.id}`}
                    className="sl-matrix-cell sl-matrix-cell-self"
                    style={{
                      transform: `translate(${left}px, ${top}px)`,
                      width: CELL,
                      height: CELL,
                    }}
                    aria-hidden="true"
                  />
                );
              }
              const primary = cell?.primary ?? null;
              const label =
                cell && primary
                  ? format(messages.matrix.cellSummary, {
                      a: rowCharacter.name,
                      b: colCharacter.name,
                      summary: cellSummary(primary, cell.count),
                    })
                  : format(messages.matrix.cellAdd, { a: rowCharacter.name, b: colCharacter.name });
              return (
                <button
                  key={`${rowCharacter.id}:${colCharacter.id}`}
                  type="button"
                  className="sl-matrix-cell"
                  data-filled={cell ? "true" : "false"}
                  data-secret={cell?.secret ? "true" : "false"}
                  style={{
                    transform: `translate(${left}px, ${top}px)`,
                    width: CELL,
                    height: CELL,
                    background: primary ? sentimentColor(primary.sentiment) : undefined,
                  }}
                  aria-label={label}
                  title={label}
                  onClick={() =>
                    onOpenCell({ sourceId: rowCharacter.id, targetId: colCharacter.id }, cell)
                  }
                >
                  {primary ? (
                    <span aria-hidden="true">
                      {RELATIONSHIP_KIND_GLYPHS[primary.kind]}
                      {cell && cell.count > 1 ? <sup>{cell.count}</sup> : null}
                    </span>
                  ) : (
                    <span aria-hidden="true">{messages.matrix.cellEmpty}</span>
                  )}
                </button>
              );
            });
          })}
        </div>
      </div>

      <div className="sl-matrix-legend">
        {legendKinds.map((kind) => (
          <span key={kind} className="sl-matrix-legend-item">
            <span aria-hidden="true">{RELATIONSHIP_KIND_GLYPHS[kind]}</span>{" "}
            {messages.relationshipKinds[kind]}
          </span>
        ))}
        <span className="sl-matrix-legend-item sl-matrix-legend-count">
          {format(messages.matrix.count, { count: ordered.length })}
        </span>
      </div>
    </div>
  );
}

/** Two letters for the column strip; the row strip carries the full name. */
function initials(name: string): string {
  const parts = name.split(/\s+/).filter((part) => part.length > 0);
  const first = parts[0]?.[0] ?? "?";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : (parts[0]?.[1] ?? "");
  return `${first}${last}`.toUpperCase();
}

export type { MatrixCell };
export { matrixCellKey };
