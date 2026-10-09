import {
  filterRelationships,
  format,
  graphCharacters,
  messages,
  RELATIONSHIP_KIND_GLYPHS,
  RELATIONSHIP_KINDS,
  type RelationshipCharacter,
  type RelationshipEdge,
  type RelationshipGroupSummary,
  type RelationshipKind,
  type SceneSummary,
  sentimentColor,
  type UUID,
} from "@starline/core";
import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  type Edge as FlowEdge,
  type Node as FlowNode,
  Handle,
  MarkerType,
  type NodeChange,
  type NodeProps,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useSetGraphPositions } from "../data";
import { type LayoutResponse, runGraphLayout } from "./graphLayout";
import { RelationshipList } from "./RelationshipList";

const CANVAS = { width: 900, height: 620 };

interface CharacterNodeData extends Record<string, unknown> {
  name: string;
  color: string;
  role: string;
  pinned: boolean;
}

interface HullNodeData extends Record<string, unknown> {
  label: string;
  color: string;
}

type GraphNode = FlowNode<CharacterNodeData | HullNodeData>;

function CharacterNode({ data }: NodeProps) {
  const node = data as CharacterNodeData;
  return (
    <div className="sl-graph-node" data-pinned={node.pinned ? "true" : "false"}>
      {/* xyflow needs a handle on each side or the edges cannot attach at all (it logs
          "Couldn't create edge for source handle id: null" and draws nothing). */}
      <Handle type="target" position={Position.Left} className="sl-graph-handle" />
      <span className="sl-graph-node-dot" style={{ background: node.color }} aria-hidden="true" />
      <span className="sl-graph-node-name">{node.name}</span>
      <Handle type="source" position={Position.Right} className="sl-graph-handle" />
    </div>
  );
}

function HullNode({ data }: NodeProps) {
  const node = data as HullNodeData;
  return (
    <div className="sl-graph-hull" style={{ borderColor: node.color }}>
      <span className="sl-graph-hull-label" style={{ color: node.color }}>
        {node.label}
      </span>
    </div>
  );
}

const NODE_TYPES = { character: CharacterNode, hull: HullNode };

export interface RelationshipGraphProps {
  projectId: UUID;
  characters: RelationshipCharacter[];
  edges: RelationshipEdge[];
  groups: RelationshipGroupSummary[];
  scenes: SceneSummary[];
  pinned: Record<string, { x: number; y: number }>;
  onEditEdge: (edge: RelationshipEdge) => void;
}

/**
 * The character web (spec §4.2.3): xyflow canvas over a d3-force layout computed in a worker.
 * Sentiment colours the edge, width follows |sentiment|, secrets are dashed, directed edges get
 * an arrowhead; groups are drawn as translucent hulls; dragging a node pins it in
 * `meta.graph_positions`; and the whole view has a list twin for screen readers.
 */
export function RelationshipGraph(props: RelationshipGraphProps) {
  return (
    <ReactFlowProvider>
      <GraphCanvas {...props} />
    </ReactFlowProvider>
  );
}

function GraphCanvas({
  projectId,
  characters,
  edges,
  groups,
  scenes,
  pinned,
  onEditEdge,
}: RelationshipGraphProps) {
  const [kinds, setKinds] = useState<RelationshipKind[]>([]);
  const [groupId, setGroupId] = useState<UUID | "">("");
  const [minFeeling, setMinFeeling] = useState(0);
  const [hideMinor, setHideMinor] = useState(false);
  const [asOfSceneId, setAsOfSceneId] = useState<UUID | "">("");
  const [listView, setListView] = useState(false);
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [layoutMs, setLayoutMs] = useState<number | null>(null);
  const setPins = useSetGraphPositions();
  const { fitView } = useReactFlow();
  const paneRef = useRef<HTMLDivElement>(null);

  const sceneOrder = useMemo(
    () => new Map(scenes.map((scene, index) => [scene.id, index])),
    [scenes],
  );

  const visibleEdges = useMemo(
    () =>
      filterRelationships(edges, characters, {
        kinds,
        groupId: groupId === "" ? null : groupId,
        minAbsSentiment: minFeeling,
        hideMinor,
        asOf: asOfSceneId === "" ? null : { atSceneId: asOfSceneId, order: sceneOrder },
      }),
    [edges, characters, kinds, groupId, minFeeling, hideMinor, asOfSceneId, sceneOrder],
  );
  const visibleCharacters = useMemo(
    () => graphCharacters(characters, visibleEdges),
    [characters, visibleEdges],
  );

  // Re-run the force layout whenever the node set changes; pins are honoured inside the worker.
  useEffect(() => {
    if (listView || visibleCharacters.length === 0) return;
    let cancelled = false;
    const request = {
      nodes: visibleCharacters.map((character) => ({
        id: character.id,
        groupId: groupOf(character.id, visibleEdges),
      })),
      edges: visibleEdges.map((edge) => ({
        source: edge.sourceId,
        target: edge.targetId,
        weight: edge.sentiment,
      })),
      width: paneRef.current?.clientWidth ?? CANVAS.width,
      height: paneRef.current?.clientHeight ?? CANVAS.height,
      pinned,
    };
    void runGraphLayout(request).then((response: LayoutResponse) => {
      if (cancelled) return;
      setPositions(response.positions);
      setLayoutMs(response.ms);
      // The canvas mounts before the layout lands, so the initial fitView fits empty space.
      // Re-fit once the nodes have real coordinates — otherwise a settled graph can sit off-screen.
      window.setTimeout(() => {
        if (!cancelled) void fitView({ duration: 200, padding: 0.25 });
      }, 60);
    });
    return () => {
      cancelled = true;
    };
  }, [visibleEdges, visibleCharacters, pinned, listView, fitView]);

  /**
   * Nodes are controlled (xyflow's recommended pattern): the derived list is the source of
   * truth whenever the layout, the filters or the pins change, and `onNodesChange` applies the
   * drag while it happens. Without it a dragged node snaps straight back and can never be pinned.
   */
  const derivedNodes = useMemo<GraphNode[]>(() => {
    const hulls: GraphNode[] = [];
    for (const group of groups) {
      const members = visibleCharacters.filter(
        (character) => groupOf(character.id, visibleEdges) === group.id,
      );
      if (members.length < 2) continue;
      const points = members
        .map((member) => positions[member.id])
        .filter((point): point is { x: number; y: number } => point !== undefined);
      if (points.length < 2) continue;
      const pad = 56;
      const minX = Math.min(...points.map((point) => point.x)) - pad;
      const minY = Math.min(...points.map((point) => point.y)) - pad;
      const maxX = Math.max(...points.map((point) => point.x)) + pad;
      const maxY = Math.max(...points.map((point) => point.y)) + pad;
      hulls.push({
        id: `hull:${group.id}`,
        type: "hull",
        position: { x: minX, y: minY },
        data: { label: group.name, color: group.color },
        draggable: false,
        selectable: false,
        style: { width: maxX - minX, height: maxY - minY, zIndex: 0 },
      });
    }
    const nodes: GraphNode[] = visibleCharacters.map((character) => ({
      id: character.id,
      type: "character",
      position: positions[character.id] ?? { x: CANVAS.width / 2, y: CANVAS.height / 2 },
      data: {
        name: character.name,
        color: character.color,
        role: character.role,
        pinned: pinned[character.id] !== undefined,
      },
      style: { zIndex: 2 },
    }));
    return [...hulls, ...nodes];
  }, [groups, visibleCharacters, visibleEdges, positions, pinned]);

  const [flowNodes, setFlowNodes] = useState<GraphNode[]>(derivedNodes);
  useEffect(() => {
    setFlowNodes(derivedNodes);
  }, [derivedNodes]);

  const onNodesChange = useCallback((changes: NodeChange<GraphNode>[]) => {
    setFlowNodes((current) => applyNodeChanges(changes, current));
  }, []);

  const flowEdges = useMemo<FlowEdge[]>(
    () =>
      visibleEdges.map((edge) => ({
        id: edge.id,
        source: edge.sourceId,
        target: edge.targetId,
        label: RELATIONSHIP_KIND_GLYPHS[edge.kind],
        style: {
          stroke: sentimentColor(edge.sentiment),
          strokeWidth: 1 + Math.abs(edge.sentiment) * 0.5,
          strokeDasharray: edge.secret ? "6 4" : undefined,
        },
        markerEnd: edge.directed
          ? { type: MarkerType.ArrowClosed, color: sentimentColor(edge.sentiment) }
          : undefined,
        data: { edgeId: edge.id },
      })),
    [visibleEdges],
  );

  const onNodeDragStop = useCallback(
    (_event: unknown, node: FlowNode) => {
      if (node.id.startsWith("hull:")) return;
      const next = {
        ...pinned,
        [node.id]: { x: Math.round(node.position.x), y: Math.round(node.position.y) },
      };
      setPositions((current) => ({
        ...current,
        [node.id]: { x: node.position.x, y: node.position.y },
      }));
      setPins.mutate({ projectId, positions: next });
    },
    [pinned, projectId, setPins],
  );

  const toggleKind = (kind: RelationshipKind) => {
    setKinds((current) =>
      current.includes(kind) ? current.filter((item) => item !== kind) : [...current, kind],
    );
  };

  return (
    <div className="sl-graph-wrap" data-testid="sl-graph">
      <div className="sl-graph-toolbar">
        <button
          type="button"
          className="sl-btn-small"
          onClick={() => setListView((current) => !current)}
          aria-pressed={listView}
          data-testid="sl-graph-list-toggle"
        >
          {listView ? messages.relationships.graph : messages.graph.listView}
        </button>
        <button
          type="button"
          className="sl-btn-small"
          onClick={() => {
            setPins.mutate({ projectId, positions: {} });
            setPositions({});
          }}
          data-testid="sl-graph-reset"
        >
          {messages.graph.resetLayout}
        </button>
        <button
          type="button"
          className="sl-btn-small"
          onClick={() => void fitView({ duration: 240, padding: 0.2 })}
        >
          {messages.graph.fit}
        </button>
        <span className="sl-graph-stats">
          {format(messages.graph.nodes, {
            count: visibleCharacters.length,
            edges: visibleEdges.length,
          })}
          {layoutMs !== null ? ` · ${layoutMs} ms` : ""}
        </span>
      </div>

      <div className="sl-graph-filters">
        <fieldset className="sl-graph-kinds sl-fieldset">
          <legend className="sr-only">{messages.graph.kinds}</legend>
          {RELATIONSHIP_KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              className="sl-chip sl-graph-kind"
              aria-pressed={kinds.includes(kind)}
              onClick={() => toggleKind(kind)}
              title={messages.relationshipKinds[kind]}
            >
              <span aria-hidden="true">{RELATIONSHIP_KIND_GLYPHS[kind]}</span>
            </button>
          ))}
        </fieldset>
        <div className="sl-graph-filter-row">
          <label className="sl-field">
            <span className="sl-label">{messages.graph.group}</span>
            <select
              className="sl-input"
              value={groupId}
              onChange={(event) => setGroupId(event.target.value as UUID)}
            >
              <option value="">{messages.graph.allKinds}</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
          </label>
          <label className="sl-field">
            <span className="sl-label">
              {messages.graph.minFeeling}: {minFeeling}
            </span>
            <input
              className="sl-slider"
              type="range"
              min={0}
              max={5}
              step={1}
              value={minFeeling}
              onChange={(event) => setMinFeeling(Number(event.target.value))}
            />
          </label>
          <label className="sl-field">
            <span className="sl-label">{messages.graph.asOf}</span>
            <select
              className="sl-input"
              value={asOfSceneId}
              onChange={(event) => setAsOfSceneId(event.target.value as UUID)}
            >
              <option value="">{messages.graph.asOfAll}</option>
              {scenes.map((scene) => (
                <option key={scene.id} value={scene.id}>
                  {scene.title}
                </option>
              ))}
            </select>
          </label>
          <label className="sl-check">
            <input
              type="checkbox"
              checked={hideMinor}
              onChange={(event) => setHideMinor(event.target.checked)}
            />
            {messages.graph.hideMinor}
          </label>
        </div>
      </div>

      {listView ? (
        <RelationshipList
          edges={visibleEdges}
          characters={characters}
          groups={groups}
          onEdit={onEditEdge}
        />
      ) : visibleCharacters.length === 0 ? (
        <div className="sl-empty">
          <p className="text-sm font-medium">{messages.graph.empty}</p>
        </div>
      ) : (
        <div className="sl-graph-pane" ref={paneRef}>
          <ReactFlow
            nodes={flowNodes}
            edges={flowEdges}
            nodeTypes={NODE_TYPES}
            fitView
            minZoom={0.2}
            maxZoom={2.5}
            onNodesChange={onNodesChange}
            onNodeDragStop={onNodeDragStop}
            onEdgeClick={(_event, edge) => {
              const match = visibleEdges.find((item) => item.id === edge.id);
              if (match) onEditEdge(match);
            }}
          >
            <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#2a2a44" />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
      )}

      <p className="sl-graph-hint">{messages.graph.hint}</p>
    </div>
  );
}

/** The group a character belongs to through its edges (first match wins, groups are ordered). */
function groupOf(characterId: string, edges: readonly RelationshipEdge[]): string | null {
  for (const edge of edges) {
    if (edge.groupId && (edge.sourceId === characterId || edge.targetId === characterId)) {
      return edge.groupId;
    }
  }
  return null;
}
