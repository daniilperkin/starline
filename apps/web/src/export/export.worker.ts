/// <reference lib="webworker" />
/**
 * Export worker (spec §4.5.1: "Export runs in a worker with a progress bar and is cancelable").
 * The project rows are read on the main thread (they come from the storage worker) and posted
 * here; this worker only builds bytes, so a 300-scene DOCX never freezes the editor.
 */
import { type BuildRequest, buildExportFile } from "./build";

export interface ExportWorkerRequest {
  id: number;
  request: BuildRequest;
}

export type ExportWorkerMessage =
  | { id: number; stage: "building" | "packing" }
  | { id: number; done: { name: string; mime: string; bytes: ArrayBuffer } }
  | { id: number; error: string };

const scope = self as unknown as {
  postMessage: (message: ExportWorkerMessage, transfer?: Transferable[]) => void;
  onmessage: ((event: MessageEvent<ExportWorkerRequest>) => void) | null;
};

scope.onmessage = (event) => {
  const { id, request } = event.data;
  try {
    scope.postMessage({ id, stage: "building" });
    const file = buildExportFile(request);
    scope.postMessage({ id, stage: "packing" });
    // The bytes are handed over, not copied: a 5 MB DOCX would otherwise be cloned.
    const buffer = file.bytes.buffer as ArrayBuffer;
    scope.postMessage({ id, done: { name: file.name, mime: file.mime, bytes: buffer } }, [buffer]);
  } catch (cause) {
    scope.postMessage({ id, error: cause instanceof Error ? cause.message : String(cause) });
  }
};
