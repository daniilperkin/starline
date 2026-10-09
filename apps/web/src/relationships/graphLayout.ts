import type { GraphPositions } from "@starline/core";

/** Worker protocol for the force layout (spec §4.2.3: d3-force off the main thread). */
export interface LayoutRequest {
  nodes: Array<{ id: string; groupId: string | null }>;
  edges: Array<{ source: string; target: string; weight: number }>;
  width: number;
  height: number;
  /** Manual pins from `meta.graph_positions` — pinned nodes keep their spot. */
  pinned: GraphPositions;
}

export interface LayoutResponse {
  positions: GraphPositions;
  ms: number;
}

/** Deterministic fallback (a ring) for the rare case where a worker cannot start or hangs. */
export function ringLayout(request: LayoutRequest): GraphPositions {
  const { nodes, width, height, pinned } = request;
  const positions: GraphPositions = {};
  nodes.forEach((node, index) => {
    const pin = pinned[node.id];
    if (pin) {
      positions[node.id] = pin;
      return;
    }
    const angle = (index / Math.max(1, nodes.length)) * Math.PI * 2;
    positions[node.id] = {
      x: Math.round(width / 2 + Math.cos(angle) * Math.min(width, height) * 0.32),
      y: Math.round(height / 2 + Math.sin(angle) * Math.min(width, height) * 0.32),
    };
  });
  return positions;
}

/**
 * Runs the force layout in a worker. Any failure (no Worker in the environment, a module-worker
 * hiccup, a hang) degrades to the ring layout instead of leaving the canvas empty — the graph is
 * a view, and a view must never take the screen down with it.
 */
export async function runGraphLayout(
  request: LayoutRequest,
  timeoutMs = 5_000,
): Promise<LayoutResponse> {
  if (typeof Worker === "undefined" || request.nodes.length === 0) {
    return { positions: ringLayout(request), ms: 0 };
  }
  return new Promise<LayoutResponse>((resolve) => {
    let settled = false;
    const finish = (response: LayoutResponse) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      resolve(response);
    };
    const timer = setTimeout(
      () => finish({ positions: ringLayout(request), ms: timeoutMs }),
      timeoutMs,
    );
    let worker: Worker;
    try {
      worker = new Worker(new URL("./graph-layout.worker.ts", import.meta.url), { type: "module" });
    } catch {
      settled = true;
      clearTimeout(timer);
      resolve({ positions: ringLayout(request), ms: 0 });
      return;
    }
    worker.onmessage = (event: MessageEvent<LayoutResponse>) => finish(event.data);
    worker.onerror = () => finish({ positions: ringLayout(request), ms: 0 });
    worker.postMessage(request);
  });
}
