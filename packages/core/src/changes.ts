export type ChangeOp = "insert" | "update" | "delete";

/** Published after a committed transaction; query hooks map these to TanStack Query keys. */
export interface ChangeEvent {
  table: string;
  op: ChangeOp;
  id: string;
  parentIds?: readonly string[];
}

export type ChangeListener = (events: readonly ChangeEvent[]) => void;

/** In-process pub/sub between the command layer and the query cache (spec §2.3.1). */
export class ChangeBus {
  private readonly listeners = new Set<ChangeListener>();

  subscribe(listener: ChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  publish(events: readonly ChangeEvent[]): void {
    if (events.length === 0) return;
    for (const listener of [...this.listeners]) listener(events);
  }
}
