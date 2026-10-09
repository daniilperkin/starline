import { describe, expect, it } from "vitest";
import { normalizeFieldValue, parseFieldValue } from "../fields";
import type { UUID } from "../primitives";
import {
  buildCategoryTree,
  categoryPath,
  DEFAULT_LORE_TAXONOMY,
  entryPath,
  LORE_KIND_GLYPHS,
  LORE_KIND_TEMPLATES,
  LORE_KINDS,
  type LoreCategory,
  type LoreEntrySummary,
} from "./index";
import { extractMentions, MENTION_NODE } from "./mentions";

const doc = (content: unknown[]) => ({ type: "doc" as const, content: content as never[] });
const mention = (entityType: string, entityId: string) => ({
  type: MENTION_NODE,
  attrs: { entityType, entityId, label: "X" },
});

describe("lore taxonomy", () => {
  it("ships nine seeded categories, each with a default kind", () => {
    expect(DEFAULT_LORE_TAXONOMY).toHaveLength(9);
    for (const category of DEFAULT_LORE_TAXONOMY) {
      expect(LORE_KINDS).toContain(category.defaultKind);
      expect(category.name.trim().length).toBeGreaterThan(0);
    }
  });

  it("covers every kind with a glyph and a template list", () => {
    for (const kind of LORE_KINDS) {
      expect(LORE_KIND_GLYPHS[kind], kind).toBeTruthy();
      expect(LORE_KIND_TEMPLATES[kind], kind).toBeDefined();
    }
    expect(LORE_KIND_TEMPLATES.custom).toHaveLength(0);
    expect(LORE_KIND_TEMPLATES.location.map((field) => field.label)).toContain("Climate");
  });
});

describe("mention extraction", () => {
  it("counts repeated mentions of the same target", () => {
    const mentions = extractMentions(
      doc([
        { type: "paragraph", content: [{ type: "text", text: "The " }, mention("lore", "l1")] },
        { type: "paragraph", content: [mention("lore", "l1"), mention("character", "c1")] },
      ]),
    );
    expect(mentions).toHaveLength(2);
    const lore = mentions.find((entry) => entry.targetType === "lore");
    expect(lore?.targetId).toBe("l1");
    expect(lore?.count).toBe(2);
    expect(mentions.find((entry) => entry.targetType === "character")?.count).toBe(1);
  });

  it("ignores foreign node types and empty documents", () => {
    expect(extractMentions(null)).toHaveLength(0);
    expect(
      extractMentions(doc([{ type: "paragraph", content: [{ type: "text", text: "hi" }] }])),
    ).toHaveLength(0);
    expect(extractMentions(doc([mention("plotline", "p1")]))).toHaveLength(0);
  });
});

describe("category tree helpers", () => {
  const category = (id: string, parentId: string | null): LoreCategory => ({
    id: id as UUID,
    projectId: "p" as UUID,
    parentId: parentId as UUID | null,
    name: id,
    icon: "",
    color: null,
    defaultKind: null,
    orderKey: id,
  });

  it("nests children under their parents and counts entries", () => {
    const tree = buildCategoryTree(
      [category("a", null), category("b", "a"), category("c", null)],
      new Map([["a", 2]]),
    );
    expect(tree.map((node) => node.id)).toEqual(["a", "c"]);
    expect(tree[0]?.children.map((node) => node.id)).toEqual(["b"]);
    expect(tree[0]?.entryCount).toBe(2);
  });

  it("walks a category path and an entry path", () => {
    const categories = [category("a", null), category("b", "a"), category("c", "b")];
    expect(categoryPath(categories, "c" as UUID).map((node) => node.id)).toEqual(["a", "b", "c"]);
    expect(categoryPath(categories, null)).toEqual([]);

    const entry = (id: string, parentEntryId: string | null): LoreEntrySummary => ({
      id: id as UUID,
      projectId: "p" as UUID,
      categoryId: null,
      parentEntryId: parentEntryId as UUID | null,
      kind: "location",
      customKindLabel: "",
      name: id,
      aliases: [],
      summary: "",
      pinned: false,
      orderKey: id,
      updatedAt: 0,
    });
    const entries = [entry("one", null), entry("two", "one"), entry("three", "two")];
    expect(entryPath(entries, "three" as UUID).map((row) => row.id)).toEqual(["one", "two"]);
  });
});

describe("field value validation", () => {
  const def = (type: string, options: string[] | null = null) => ({
    type: type as never,
    options,
    label: "Field",
  });

  it("accepts and normalises valid values", () => {
    expect(parseFieldValue(normalizeFieldValue(def("text"), "hi"))).toBe("hi");
    expect(parseFieldValue(normalizeFieldValue(def("number"), "4.5"))).toBe(4.5);
    expect(parseFieldValue(normalizeFieldValue(def("boolean"), true))).toBe(true);
    expect(parseFieldValue(normalizeFieldValue(def("select", ["A", "B"]), "B"))).toBe("B");
    expect(parseFieldValue(normalizeFieldValue(def("multiselect", ["A", "B"]), ["A"]))).toEqual([
      "A",
    ]);
    expect(parseFieldValue(normalizeFieldValue(def("date"), "2026-10-09"))).toBe("2026-10-09");
    expect(parseFieldValue(normalizeFieldValue(def("color"), "#f6c760"))).toBe("#f6c760");
  });

  it("rejects wrong shapes with readable messages", () => {
    expect(() => normalizeFieldValue(def("number"), "abc")).toThrow(/expected a number/);
    expect(() => normalizeFieldValue(def("select", ["A"]), "C")).toThrow(/not an option/);
    expect(() => normalizeFieldValue(def("multiselect", ["A"]), ["C"])).toThrow(/not an option/);
    expect(() => normalizeFieldValue(def("date"), "09.10.2026")).toThrow(/YYYY-MM-DD/);
    expect(() => normalizeFieldValue(def("color"), "gold")).toThrow(/#RRGGBB/);
    expect(() => normalizeFieldValue(def("entity_ref"), "nope")).toThrow(/entity id/);
  });
});
