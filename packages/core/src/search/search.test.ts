import { describe, expect, it } from "vitest";
import type { PMDoc } from "../richtext";
import { removeMentionNodes, rewriteDocWithMention } from "./possible";
import {
  countLabelOccurrences,
  firstLabelMatch,
  headSnippet,
  labelPattern,
  levenshtein,
  nearDuplicatePairs,
  normalizeName,
  snippetAround,
  toFtsQuery,
  toTrigramQuery,
} from "./text";

describe("FTS query building", () => {
  it("quotes terms, ANDs them and prefixes the last one", () => {
    expect(toFtsQuery("Sundered Coast")).toBe('"sundered" AND "coast"*');
    expect(toFtsQuery("  Emb  ")).toBe('"emb"*');
  });

  it("strips FTS syntax instead of passing it through", () => {
    expect(toFtsQuery('"quote" OR (x)^')).toBe('"quote" AND "or" AND "x"*');
    expect(toFtsQuery("   ")).toBeNull();
    expect(toFtsQuery('"*:^')).toBeNull();
  });

  it("caps the term count and needs three characters for trigram", () => {
    expect(toFtsQuery("a b c d e f g h")).toBe('"a" AND "b" AND "c" AND "d" AND "e" AND "f"*');
    expect(toTrigramQuery("mi")).toBeNull();
    expect(toTrigramQuery("mir")).toBe('"mir"');
  });
});

describe("label matching", () => {
  const labels = ["Mira Voss", "Voss"];

  it("matches whole words only, longest label first", () => {
    expect(countLabelOccurrences("Mira Voss met Voss again.", labels)).toBe(2);
    expect(countLabelOccurrences("Vosselin is a different name.", labels)).toBe(0);
    expect(firstLabelMatch("x Mira Voss y", labels)?.label).toBe("Mira Voss");
  });

  it("builds a snippet window around the hit", () => {
    const text = `${"a".repeat(200)} Emberfall ${"b".repeat(200)}`;
    const snippet = snippetAround(text, ["Emberfall"], 20);
    expect(snippet).toContain("Emberfall");
    expect(snippet.startsWith("…")).toBe(true);
    expect(snippet.endsWith("…")).toBe(true);
    expect(snippet.length).toBeLessThan(70);
  });

  it("falls back to the head when the label is gone", () => {
    expect(snippetAround("short body", ["missing"])).toBe("short body");
    expect(headSnippet("x".repeat(120), 10)).toBe(`${"x".repeat(10)}…`);
  });

  it("ignores labels shorter than two characters", () => {
    expect(labelPattern(["a", ""])).toBeNull();
    expect(countLabelOccurrences("a a a", ["a"])).toBe(0);
  });
});

describe("near-duplicate detection", () => {
  it("normalises names and measures distance", () => {
    expect(normalizeName("  Mira   Holt! ")).toBe("mira holt");
    expect(levenshtein("emberfall", "emberfal")).toBe(1);
    expect(levenshtein("mira", "mira")).toBe(0);
  });

  it("pairs one-edit-apart names and ignores unrelated ones", () => {
    const pairs = nearDuplicatePairs([
      { entityType: "character", entityId: "1", name: "Mira Holt" },
      { entityType: "character", entityId: "2", name: "Mira Hold" },
      { entityType: "lore", entityId: "3", name: "Emberfall" },
      { entityType: "lore", entityId: "4", name: "The Sundered Coast" },
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.a.name).toBe("Mira Holt");
    expect(pairs[0]?.b.name).toBe("Mira Hold");
  });

  it("never pairs a name with itself", () => {
    expect(
      nearDuplicatePairs([
        { entityType: "lore", entityId: "1", name: "Emberfall" },
        { entityType: "lore", entityId: "2", name: "Emberfall" },
      ]),
    ).toHaveLength(0);
  });
});

describe("mention rewrite", () => {
  const doc: PMDoc = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "North of " },
          { type: "text", text: "Emberfall", marks: [{ type: "bold" }] },
          { type: "text", text: " lies the glass sea." },
        ],
      },
    ],
  };

  it("splits text nodes into chips, keeping surrounding text and marks", () => {
    const { doc: next, linked } = rewriteDocWithMention(doc, ["Emberfall"], "lore", "l1");
    expect(linked).toBe(1);
    const paragraph = next?.content[0];
    expect(paragraph?.content?.map((node) => node.type)).toEqual(["text", "mention", "text"]);
    expect(paragraph?.content?.[1]?.attrs).toMatchObject({
      entityType: "lore",
      entityId: "l1",
      label: "Emberfall",
    });
    expect(paragraph?.content?.[2]?.text).toBe(" lies the glass sea.");
  });

  it("leaves chips alone on a second pass and never touches existing mentions", () => {
    const first = rewriteDocWithMention(doc, ["Emberfall"], "lore", "l1").doc;
    const second = rewriteDocWithMention(first, ["Emberfall"], "lore", "l1");
    expect(second.linked).toBe(0);
    expect(second.doc?.content[0]?.content?.filter((node) => node.type === "mention")).toHaveLength(
      1,
    );
  });

  it("is undone exactly by removeMentionNodes", () => {
    const { doc: next } = rewriteDocWithMention(doc, ["Emberfall"], "lore", "l1");
    const { doc: back, linked } = removeMentionNodes(next, "lore", "l1");
    expect(linked).toBe(1);
    expect(back?.content[0]?.content?.map((node) => node.type)).toEqual(["text", "text", "text"]);
    expect(back?.content[0]?.content?.[1]?.text).toBe("Emberfall");
  });

  it("rewrites nested structures and reports every occurrence", () => {
    const nested: PMDoc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Emberfall and Emberfall" }] },
        { type: "paragraph", content: [{ type: "text", text: "nothing here" }] },
      ],
    };
    const { doc: next, linked } = rewriteDocWithMention(nested, ["Emberfall"], "lore", "l1");
    expect(linked).toBe(2);
    expect(next?.content[0]?.content?.filter((node) => node.type === "mention")).toHaveLength(2);
  });
});
