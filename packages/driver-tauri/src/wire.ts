import type { SqlValue } from "@starline/core";

/** Encodes driver parameters for the JSON wire: blobs become `{"$b64": ...}`, bigints numbers. */
export function encodeParams(params: readonly SqlValue[]): unknown[] {
  return params.map((value) => {
    if (value instanceof Uint8Array) {
      let binary = "";
      for (const byte of value) binary += String.fromCharCode(byte);
      return { $b64: btoa(binary) };
    }
    if (typeof value === "bigint") return Number(value);
    return value;
  });
}

function isB64Wrapper(value: unknown): value is { $b64: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "$b64" in value &&
    typeof (value as { $b64: unknown }).$b64 === "string"
  );
}

function fromB64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Decodes a result row: `{"$b64": ...}` values become Uint8Array. */
export function decodeRow<T = Record<string, unknown>>(row: Record<string, unknown>): T {
  for (const key of Object.keys(row)) {
    const value = row[key];
    if (isB64Wrapper(value)) row[key] = fromB64(value.$b64);
  }
  return row as T;
}

export function decodeRows<T = Record<string, unknown>>(rows: Record<string, unknown>[]): T[] {
  return rows.map((row) => decodeRow<T>(row));
}
