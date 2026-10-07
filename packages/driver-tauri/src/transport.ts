/**
 * Request/response transport behind the native driver: Tauri `invoke` in the app, a stdio
 * child process in tests and the chaos harness. Both speak the same op protocol, which mirrors
 * `crates/starline-storage-cli`.
 */
export interface Transport {
  request<T = unknown>(op: string, payload?: Record<string, unknown>): Promise<T>;
  dispose(): Promise<void>;
}
