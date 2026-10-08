import { describe, expect, it } from "vitest";
import { parseSceneList } from "./parse";

const NAMES = ["Mina Voss", "Tor", "The Surveyor"];

describe("parseSceneList", () => {
  it("parses a plain numbered list into one-liners", () => {
    const { rows, skipped } = parseSceneList("1. The ferry crosses at dawn\n2) Mina hides the map");
    expect(skipped).toHaveLength(0);
    expect(rows).toEqual([
      {
        line: 1,
        oneLine: "The ferry crosses at dawn",
        povName: null,
        estWords: null,
        chapterTitle: null,
      },
      { line: 2, oneLine: "Mina hides the map", povName: null, estWords: null, chapterTitle: null },
    ]);
  });

  it("parses TSV rows with #, POV and estimated words", () => {
    const { rows } = parseSceneList(
      "1\tMina Voss\tThe ferry crosses at dawn\t1200\n2\tTor\tA knife in the dark\t1,500",
      { knownNames: NAMES },
    );
    expect(rows).toEqual([
      {
        line: 1,
        oneLine: "The ferry crosses at dawn",
        povName: "Mina Voss",
        estWords: 1200,
        chapterTitle: null,
      },
      {
        line: 2,
        oneLine: "A knife in the dark",
        povName: "Tor",
        estWords: 1500,
        chapterTitle: null,
      },
    ]);
  });

  it("recognises aliases as POV and keeps an unmatched name inside the one-liner", () => {
    const { rows } = parseSceneList(
      "The Surveyor\tThe map is redrawn\nReyes\tNobody knows him yet",
      { knownNames: NAMES },
    );
    expect(rows[0]?.povName).toBe("The Surveyor");
    expect(rows[1]?.povName).toBeNull();
    expect(rows[1]?.oneLine).toBe("Reyes Nobody knows him yet");
  });

  it("reads a trailing chapter cell after the word count", () => {
    const { rows } = parseSceneList("Mina Voss\tThe ferry crosses\t1200\tChapter 2", {
      knownNames: NAMES,
    });
    expect(rows[0]).toMatchObject({
      povName: "Mina Voss",
      estWords: 1200,
      chapterTitle: "Chapter 2",
    });
  });

  it("reads a chapter cell without a word count", () => {
    const { rows } = parseSceneList("Tor\tA knife in the dark\tPart II", { knownNames: NAMES });
    expect(rows[0]).toMatchObject({ povName: "Tor", estWords: null, chapterTitle: "Part II" });
  });

  it("accepts pipe-separated rows and ~/w suffixes", () => {
    const { rows } = parseSceneList("Mina Voss | The ferry crosses | ~1 200 words", {
      knownNames: NAMES,
    });
    expect(rows[0]).toMatchObject({ povName: "Mina Voss", estWords: 1200 });
  });

  it("ignores blank lines silently but reports content that reduces to nothing", () => {
    const { rows, skipped } = parseSceneList("The ferry crosses\n\n42.\n   \nThe knife");
    expect(rows.map((row) => row.oneLine)).toEqual(["The ferry crosses", "The knife"]);
    expect(skipped).toEqual([{ line: 3, text: "42." }]);
  });

  it("keeps real line numbers so re-imports can merge by line", () => {
    const { rows } = parseSceneList("one\n\ntwo\nthree");
    expect(rows.map((row) => [row.line, row.oneLine])).toEqual([
      [1, "one"],
      [3, "two"],
      [4, "three"],
    ]);
  });

  it("does not treat a single trailing number as the word count without a description", () => {
    const { rows, skipped } = parseSceneList("1200");
    expect(rows).toHaveLength(0);
    expect(skipped).toEqual([{ line: 1, text: "1200" }]);
  });
});
