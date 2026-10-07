import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { SqlValue } from "@starline/core";
import type { Transport } from "./transport";
import { encodeParams } from "./wire";

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

export interface StdioTransportOptions {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

/**
 * NDJSON over stdin/stdout of the headless storage CLI
 * (`crates/starline-storage-cli`). One JSON request per line, one JSON response per line.
 */
export class StdioTransport implements Transport {
  private readonly child: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private stderr = "";
  private exited = false;

  constructor(options: StdioTransportOptions) {
    this.child = spawn(options.command, options.args ?? [], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...options.env },
      windowsHide: true,
    });
    const rl = createInterface({ input: this.child.stdout });
    rl.on("line", (line) => this.onLine(line));
    this.child.stderr.on("data", (chunk: Buffer) => {
      this.stderr += chunk.toString();
    });
    this.child.on("exit", (code) => {
      this.exited = true;
      const error = new Error(
        `storage process exited (code ${code}); stderr: ${this.stderr.slice(-500)}`,
      );
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    });
  }

  private onLine(line: string): void {
    if (!line.trim()) return;
    let message: {
      id: number | null;
      ok: boolean;
      result?: unknown;
      error?: { message?: string };
    };
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message.id == null) return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if (message.ok) pending.resolve(message.result);
    else pending.reject(new Error(message.error?.message ?? "storage error"));
  }

  request<T = unknown>(op: string, payload: Record<string, unknown> = {}): Promise<T> {
    if (this.exited) return Promise.reject(new Error("storage process is not running"));
    const id = this.nextId++;
    // JSON cannot carry Uint8Array: blob parameters go over the wire as {"$b64": ...}
    // (the driver turns `$b64` results back into Uint8Array on the way out).
    const body: Record<string, unknown> = { id, op, ...payload };
    if (Array.isArray(body.params)) {
      body.params = encodeParams(body.params as readonly SqlValue[]);
    }
    const line = JSON.stringify(body);
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.child.stdin.write(`${line}\n`, (error) => {
        if (error) {
          this.pending.delete(id);
          reject(error);
        }
      });
    });
  }

  async dispose(): Promise<void> {
    if (this.exited) return;
    try {
      await this.request("shutdown");
    } catch {
      // The process may already be gone; killing below is the real cleanup.
    }
    this.child.kill();
  }
}
