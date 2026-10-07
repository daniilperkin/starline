import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing";
import { v7 as uuidv7 } from "uuid";

/** Lowercase hyphenated UUID (v7 — time-ordered for B-tree locality, spec §3.1). */
export type UUID = string & { readonly __brand: "UUID" };
/** Unix epoch milliseconds, UTC (spec §3.1). */
export type EpochMs = number;
/** Fractional-indexing order key (base-62, spec §3.1). */
export type OrderKey = string;
/** "#RRGGBB". */
export type HexColor = `#${string}`;
/** "YYYY-MM-DD" for real-world dates only (spec §3.2). */
export type IsoDate = string;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function newUuid(): UUID {
  return uuidv7() as UUID;
}

export function isUuid(value: string): value is UUID {
  return UUID_RE.test(value);
}

export function epochNow(): EpochMs {
  return Date.now();
}

/** One key strictly between `a` and `b` (either may be null for the ends). */
export function orderKeyBetween(a: OrderKey | null, b: OrderKey | null): OrderKey {
  return generateKeyBetween(a, b);
}

/** `n` keys strictly between `a` and `b`, in ascending order. */
export function orderKeysBetween(a: OrderKey | null, b: OrderKey | null, n: number): OrderKey[] {
  return generateNKeysBetween(a, b, n);
}
