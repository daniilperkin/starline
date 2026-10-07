import type { Transport } from "./transport";

/**
 * Tauri `invoke` transport: the desktop shell exposes one `storage` command taking
 * `{ op, payload }` and returning the wire result (see `apps/desktop/src-tauri`).
 * Loaded lazily so the web build never pulls in `@tauri-apps/api`.
 */
export class InvokeTransport implements Transport {
  async request<T = unknown>(op: string, payload: Record<string, unknown> = {}): Promise<T> {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<T>("storage", { op, payload });
  }

  async dispose(): Promise<void> {
    // The shell owns the storage process; nothing to tear down here.
  }
}
