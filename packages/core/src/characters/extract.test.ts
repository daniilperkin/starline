import { describe, expect, it } from "vitest";
import { extractNameCandidates, extractNameCandidatesFromTexts } from "./extract";

describe("extractNameCandidates", () => {
  it("finds single- and multi-word capitalised names", () => {
    const text = "Mina Voss walked into the harbour. The Surveyor was waiting.";
    expect(extractNameCandidates(text)).toEqual(["Mina Voss", "Surveyor"]);
  });

  it("drops stopword-only runs and leading stopwords of longer runs", () => {
    expect(extractNameCandidates("The wind rose.")).toEqual([]);
    expect(extractNameCandidates("The Harbour lay still.")).toEqual(["Harbour"]);
  });

  it("excludes names that already exist (case-insensitive)", () => {
    const text = "Mina Voss met the Surveyor.";
    expect(extractNameCandidates(text, ["mina voss"])).toEqual(["Surveyor"]);
  });

  it("dedupes repeats and keeps source order", () => {
    expect(extractNameCandidates("Mina met Holst, then Mina left again.")).toEqual([
      "Mina",
      "Holst",
    ]);
  });

  it("ignores all-caps noise", () => {
    expect(extractNameCandidates("THE TV was OK at the harbour")).toEqual([]);
  });

  it("keeps apostrophes inside names", () => {
    expect(extractNameCandidates("O'Brien arrived late.")).toEqual(["O'Brien"]);
  });

  it("caps proposals at 20", () => {
    const text = Array.from(
      { length: 25 },
      (_, index) => `Name${String.fromCharCode(65 + index)} went`,
    ).join(" ");
    expect(extractNameCandidates(text)).toHaveLength(20);
  });
});

describe("extractNameCandidatesFromTexts", () => {
  it("merges several sources, deduped in order", () => {
    expect(
      extractNameCandidatesFromTexts(["Mina Voss guards the light.", "Voss kept watch."], []),
    ).toEqual(["Mina Voss"]);
  });
});
