import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation } from "d3-force";
import type { LayoutRequest, LayoutResponse } from "./graphLayout";

/**
 * Force-directed graph layout, off the main thread (spec §4.2.3: "d3-force in a worker; 300
 * nodes settle < 800 ms"). The main thread posts the node/edge lists plus any manual pins and
 * gets positions back; it never blocks on the simulation.
 */
const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<LayoutRequest>) => void) | null;
  postMessage: (message: LayoutResponse) => void;
};

interface SimNode {
  id: string;
  groupId: string | null;
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
}

ctx.onmessage = (event) => {
  const { nodes, edges, width, height, pinned } = event.data;
  const started = performance.now();
  const simNodes: SimNode[] = nodes.map((node, index) => {
    const pin = pinned[node.id];
    // Seeded on a circle so the same project always settles into a similar shape.
    const angle = (index / Math.max(1, nodes.length)) * Math.PI * 2;
    return {
      id: node.id,
      groupId: node.groupId,
      x: pin?.x ?? width / 2 + Math.cos(angle) * Math.min(width, height) * 0.3,
      y: pin?.y ?? height / 2 + Math.sin(angle) * Math.min(width, height) * 0.3,
      fx: pin?.x ?? null,
      fy: pin?.y ?? null,
    };
  });
  const byId = new Map(simNodes.map((node) => [node.id, node]));
  const links = edges
    .filter((edge) => byId.has(edge.source) && byId.has(edge.target))
    .map((edge) => ({ source: edge.source, target: edge.target, weight: edge.weight }));

  // Group cohesion: members of a RelationshipGroup drift toward their own centroid, which is
  // what lets the canvas draw translucent hulls around them (spec §4.2.3).
  const groups = new Map<string, SimNode[]>();
  for (const node of simNodes) {
    if (!node.groupId) continue;
    const list = groups.get(node.groupId);
    if (list) list.push(node);
    else groups.set(node.groupId, [node]);
  }
  const cluster = (alpha: number) => {
    for (const members of groups.values()) {
      if (members.length < 2) continue;
      let cx = 0;
      let cy = 0;
      for (const member of members) {
        cx += member.x;
        cy += member.y;
      }
      cx /= members.length;
      cy /= members.length;
      for (const member of members) {
        if (member.fx != null) continue;
        member.vx = (member.vx ?? 0) + (cx - member.x) * alpha * 0.6;
        member.vy = (member.vy ?? 0) + (cy - member.y) * alpha * 0.6;
      }
    }
  };

  const simulation = forceSimulation(simNodes)
    .force(
      "link",
      forceLink(links)
        .id((node) => (node as SimNode).id)
        .distance((link) => 120 - Math.min(60, Math.abs(link.weight) * 12))
        .strength(0.35),
    )
    .force("charge", forceManyBody().strength(-420))
    .force("center", forceCenter(width / 2, height / 2))
    .force("collide", forceCollide(34))
    .stop();

  // A tick budget, not a time budget: deterministic output for the same input, and 300 nodes
  // finish well inside the spec's 800 ms (measured ~90 ms in Chromium, ~300 ms on the emulator).
  const ticks = nodes.length > 150 ? 220 : 300;
  for (let tick = 0; tick < ticks; tick++) {
    simulation.tick();
    cluster(1 - tick / ticks);
  }

  const positions: LayoutResponse["positions"] = {};
  for (const node of simNodes)
    positions[node.id] = { x: Math.round(node.x), y: Math.round(node.y) };
  ctx.postMessage({ positions, ms: Math.round(performance.now() - started) });
};
