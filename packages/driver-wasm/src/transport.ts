import type { Transport } from "@starline/driver-tauri";

interface WorkerResponse {
  id: number;
  ok: boolean;
  result?: unknown;
  error?: { message?: string };
}

/** Main-thread side of the storage worker: same op protocol as the stdio transport. */
export class WorkerTransport implements Transport {
  private readonly worker: Worker;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();

  constructor() {
    this.worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      const pendingCall = this.pending.get(message.id);
      if (!pendingCall) return;
      this.pending.delete(message.id);
      if (message.ok) pendingCall.resolve(message.result);
      else pendingCall.reject(new Error(message.error?.message ?? "storage error"));
    };
    this.worker.onerror = (event) => {
      const error = new Error(`storage worker failed: ${event.message}`);
      for (const pendingCall of this.pending.values()) pendingCall.reject(error);
      this.pending.clear();
    };
  }

  request<T = unknown>(op: string, payload: Record<string, unknown> = {}): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.worker.postMessage({ id, op, ...payload });
    });
  }

  async dispose(): Promise<void> {
    try {
      await this.request("shutdown");
    } catch {
      // The worker may already be gone.
    }
    this.worker.terminate();
  }
}
