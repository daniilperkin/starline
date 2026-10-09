import { messages, type RelationshipEdge, type UUID } from "@starline/core";
import { useState } from "react";

import { useRelationshipMatrix, useSceneTree } from "../data";
import { EdgeSheet } from "./EdgeSheet";
import { RelationshipList } from "./RelationshipList";

/**
 * The dossier's Relationships section (spec §4.2.2 tab "Relationships"): every edge this
 * character carries, with the same table the People tab uses — so the keyboard path and the
 * reading order are identical wherever relationships appear.
 */
export interface CharacterRelationshipsProps {
  projectId: UUID;
  characterId: UUID;
}

export function CharacterRelationships({ projectId, characterId }: CharacterRelationshipsProps) {
  const matrix = useRelationshipMatrix(projectId);
  const tree = useSceneTree(projectId);
  const [sheet, setSheet] = useState<{
    edge: RelationshipEdge | null;
    pair?: { sourceId?: UUID; targetId?: UUID };
  } | null>(null);

  const edges = (matrix.data?.edges ?? []).filter(
    (edge) => edge.sourceId === characterId || edge.targetId === characterId,
  );

  return (
    <section className="sl-rel-section" data-testid="sl-character-relationships">
      <div className="flex items-center gap-2">
        <h2 className="sl-label mb-0">{messages.relationships.heading}</h2>
        <button
          type="button"
          className="sl-btn-small ml-auto"
          onClick={() => setSheet({ edge: null, pair: { sourceId: characterId } })}
          data-testid="sl-character-rel-add"
        >
          {messages.relationships.add}
        </button>
      </div>

      <RelationshipList
        edges={edges}
        characters={matrix.data?.characters ?? []}
        groups={matrix.data?.groups ?? []}
        onEdit={(edge) => setSheet({ edge })}
      />

      {sheet ? (
        <EdgeSheet
          projectId={projectId}
          characters={matrix.data?.characters ?? []}
          groups={matrix.data?.groups ?? []}
          scenes={tree.data?.scenes ?? []}
          initial={sheet.pair}
          edge={sheet.edge}
          onClose={() => setSheet(null)}
        />
      ) : null}
    </section>
  );
}
