import { describe, expect, it } from "vitest";

import {
  isTagTarget,
  normalizeTagName,
  TAG_MAX_PER_ENTITY,
  TAG_NAME_MAX,
  TAG_TARGET_TABLES,
  TAG_TARGETS,
  tagNameKey,
} from "./index";

/**
 * Pure tag rules. The behaviour that needs a database (uniqueness, merging, cascades) lives in
 * `packages/driver-tauri/tests/slice9-tags.test.ts`; these are the normalisations every writer
 * funnels through, so a mistake here would silently duplicate tags instead of erroring.
 */
describe("normalizeTagName", () => {
  it("trims, collapses inner whitespace and caps the length", () => {
    expect(normalizeTagName("  red   herring  ")).toBe("red herring");
    expect(normalizeTagName("x".repeat(80))).toHaveLength(TAG_NAME_MAX);
  });

  it("keeps case — the tag manager shows what the writer typed", () => {
    expect(normalizeTagName("Mina's arc")).toBe("Mina's arc");
  });

  it("returns an empty string for whitespace-only input", () => {
    expect(normalizeTagName("   ")).toBe("");
  });
});

describe("tagNameKey", () => {
  it("folds case the way the schema's NOCASE unique index does", () => {
    expect(tagNameKey("  Red Herring ")).toBe("red herring");
    expect(tagNameKey("RED HERRING")).toBe(tagNameKey("red herring"));
  });
});

describe("tag targets", () => {
  it("accepts the entity types the app renders chips on", () => {
    for (const target of TAG_TARGETS) expect(isTagTarget(target)).toBe(true);
  });

  it("refuses entities with no chip surface", () => {
    expect(isTagTarget("note")).toBe(false);
    expect(isTagTarget("project")).toBe(false);
    expect(isTagTarget("timeline_event")).toBe(false);
  });

  it("has a liveness table for every target — a missing one would throw at attach time", () => {
    for (const target of TAG_TARGETS) {
      expect(TAG_TARGET_TABLES[target]).toBeTruthy();
    }
    expect(Object.keys(TAG_TARGET_TABLES).sort()).toEqual([...TAG_TARGETS].sort());
  });

  it("caps an entity's tag row", () => {
    expect(TAG_MAX_PER_ENTITY).toBeGreaterThan(0);
    expect(TAG_MAX_PER_ENTITY).toBeLessThanOrEqual(30);
  });
});
