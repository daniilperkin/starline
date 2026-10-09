import { describe, expect, it } from "vitest";
import type { UUID } from "../primitives";
import { buildMatrixCells, filterRelationships, graphCharacters, matrixCellKey } from "./matrix";
import {
  clampSentiment,
  defaultDirected,
  normalizeEdgePair,
  RELATIONSHIP_KIND_GLYPHS,
  RELATIONSHIP_KINDS,
  type RelationshipCharacter,
  type RelationshipEdge,
  sentimentColor,
} from "./types";

const id = (value: string) => value as UUID;

function edge(
  overrides: Omit<Partial<RelationshipEdge>, "sourceId" | "targetId"> & {
    sourceId: string;
    targetId: string;
  },
): RelationshipEdge {
  return {
    id: id(`edge-${overrides.sourceId}-${overrides.targetId}-${overrides.kind ?? "friend"}`),
    projectId: id("p1"),
    kind: "friend",
    customLabel: "",
    directed: false,
    sentiment: 0,
    notes: { json: null, text: "", wordCount: 0 },
    groupId: null,
    startsAtSceneId: null,
    endsAtSceneId: null,
    secret: false,
    updatedAt: 1,
    ...overrides,
    // Branded last: the overrides carry plain strings on purpose (test literals).
    sourceId: id(overrides.sourceId),
    targetId: id(overrides.targetId),
  };
}

const character = (value: string, role = "supporting"): RelationshipCharacter => ({
  id: id(value),
  name: value,
  color: "#ffffff",
  role,
});

describe("relationship kinds", () => {
  it("lists all 18 kinds with a glyph each", () => {
    expect(RELATIONSHIP_KINDS).toHaveLength(18);
    for (const kind of RELATIONSHIP_KINDS) {
      expect(RELATIONSHIP_KIND_GLYPHS[kind]).toBeTruthy();
      expect(RELATIONSHIP_KIND_GLYPHS[kind].length).toBeLessThanOrEqual(1);
    }
  });

  it("gives every kind a distinct glyph (the matrix legend must not be ambiguous)", () => {
    const glyphs = RELATIONSHIP_KINDS.map((kind) => RELATIONSHIP_KIND_GLYPHS[kind]);
    expect(new Set(glyphs).size).toBe(glyphs.length);
  });

  it("defaults symmetric kinds to undirected and role kinds to directed", () => {
    expect(defaultDirected("friend")).toBe(false);
    expect(defaultDirected("romantic")).toBe(false);
    expect(defaultDirected("enemy")).toBe(false);
    expect(defaultDirected("mentor")).toBe(true);
    expect(defaultDirected("family_parent")).toBe(true);
    expect(defaultDirected("employer")).toBe(true);
  });
});

describe("edge normalization", () => {
  it("sorts undirected pairs so either end lands on one row", () => {
    expect(normalizeEdgePair(id("b"), id("a"), false)).toEqual({
      sourceId: id("a"),
      targetId: id("b"),
    });
    expect(normalizeEdgePair(id("a"), id("b"), false)).toEqual({
      sourceId: id("a"),
      targetId: id("b"),
    });
  });

  it("keeps the drawn direction for directed edges", () => {
    expect(normalizeEdgePair(id("b"), id("a"), true)).toEqual({
      sourceId: id("b"),
      targetId: id("a"),
    });
  });
});

describe("sentiment", () => {
  it("clamps and rounds", () => {
    expect(clampSentiment(9)).toBe(5);
    expect(clampSentiment(-9)).toBe(-5);
    expect(clampSentiment(2.4)).toBe(2);
    expect(clampSentiment(Number.NaN)).toBe(0);
  });

  it("runs red → grey → green and is neutral at zero", () => {
    expect(sentimentColor(0)).toBe("#9aa0c0");
    expect(sentimentColor(-5)).toBe("#f87171");
    expect(sentimentColor(5)).toBe("#5ad1a5");
    // Monotone-ish green channel from hostile to warm.
    const green = (value: number) => Number.parseInt(sentimentColor(value).slice(3, 5), 16);
    expect(green(-5)).toBeLessThan(green(-2));
    expect(green(-2)).toBeLessThan(green(0));
    expect(green(0)).toBeLessThan(green(5));
  });
});

describe("matrix cells", () => {
  it("keys a pair the same from either axis", () => {
    expect(matrixCellKey(id("a"), id("b"))).toBe(matrixCellKey(id("b"), id("a")));
  });

  it("collects both directions of a pair into one cell and picks the strongest edge", () => {
    const cells = buildMatrixCells([
      edge({ sourceId: "a", targetId: "b", kind: "friend", sentiment: 2 }),
      edge({ sourceId: "b", targetId: "a", kind: "rival", sentiment: -4, directed: true }),
    ]);
    const cell = cells.get(matrixCellKey(id("a"), id("b")));
    expect(cell?.count).toBe(2);
    expect(cell?.primary.kind).toBe("rival");
    expect(cell?.sentiment).toBe(-4);
    expect(cell?.kinds).toEqual(["rival", "friend"]);
    expect(cell?.directed).toBe(true);
    expect(cells.size).toBe(1);
  });

  it("flags a secret edge anywhere in the pair", () => {
    const cells = buildMatrixCells([
      edge({ sourceId: "a", targetId: "b", sentiment: 1 }),
      edge({ sourceId: "a", targetId: "b", kind: "ally", sentiment: 3, secret: true }),
    ]);
    expect(cells.get(matrixCellKey(id("a"), id("b")))?.secret).toBe(true);
  });
});

describe("graph filters", () => {
  const characters = [
    character("a", "protagonist"),
    character("b", "major"),
    character("c", "minor"),
  ];
  const edges = [
    edge({ sourceId: "a", targetId: "b", kind: "friend", sentiment: 3 }),
    edge({ sourceId: "a", targetId: "c", kind: "enemy", sentiment: -5 }),
    edge({ sourceId: "b", targetId: "c", kind: "mentor", sentiment: 1, groupId: id("g1") }),
  ];

  it("filters by kind", () => {
    const kept = filterRelationships(edges, characters, { kinds: ["friend", "mentor"] });
    expect(kept.map((item) => item.kind)).toEqual(["friend", "mentor"]);
  });

  it("filters by group", () => {
    const kept = filterRelationships(edges, characters, { groupId: id("g1") });
    expect(kept).toHaveLength(1);
    expect(kept[0]?.kind).toBe("mentor");
  });

  it("filters by minimum feeling", () => {
    const kept = filterRelationships(edges, characters, { minAbsSentiment: 4 });
    expect(kept.map((item) => item.kind)).toEqual(["enemy"]);
  });

  it("hides minor characters on request", () => {
    const kept = filterRelationships(edges, characters, { hideMinor: true });
    expect(kept).toHaveLength(1);
    expect(kept[0]?.kind).toBe("friend");
  });

  it("reads edge lifetimes against the scene order", () => {
    const order = new Map<UUID, number>([
      [id("s1"), 0],
      [id("s2"), 1],
      [id("s3"), 2],
    ]);
    const lifetime = [
      edge({ sourceId: "a", targetId: "b", kind: "friend", startsAtSceneId: id("s2") }),
      edge({
        sourceId: "a",
        targetId: "c",
        kind: "enemy",
        startsAtSceneId: id("s1"),
        endsAtSceneId: id("s1"),
      }),
      edge({ sourceId: "b", targetId: "c", kind: "ally" }),
    ];
    const atS1 = filterRelationships(lifetime, characters, {
      asOf: { atSceneId: id("s1"), order },
    });
    expect(atS1.map((item) => item.kind).sort()).toEqual(["ally", "enemy"]);
    const atS3 = filterRelationships(lifetime, characters, {
      asOf: { atSceneId: id("s3"), order },
    });
    expect(atS3.map((item) => item.kind).sort()).toEqual(["ally", "friend"]);
  });

  it("keeps only connected characters as nodes", () => {
    const kept = filterRelationships(edges, characters, { kinds: ["friend"] });
    expect(graphCharacters(characters, kept).map((item) => item.id)).toEqual([id("a"), id("b")]);
  });
});
