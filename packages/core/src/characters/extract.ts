/**
 * "Find characters in this text" (spec §3.4.3): tokenises text and proposes capitalised
 * names (single- or multi-word) that are not already known. The UI confirms each proposal;
 * this module is the pure part and is unit-tested.
 */
const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "but",
  "by",
  "for",
  "from",
  "he",
  "her",
  "his",
  "i",
  "if",
  "in",
  "it",
  "its",
  "my",
  "no",
  "not",
  "of",
  "on",
  "one",
  "or",
  "our",
  "she",
  "so",
  "that",
  "the",
  "their",
  "then",
  "there",
  "they",
  "this",
  "to",
  "up",
  "was",
  "we",
  "when",
  "where",
  "which",
  "who",
  "why",
  "with",
  "you",
  "your",
]);

const MAX_PROPOSALS = 20;
const MAX_WORDS_PER_NAME = 3;

function isCapitalized(word: string): boolean {
  // Unicode-aware: uppercase first letter, and not ALL-CAPS noise like "OK" / "TV".
  return /^\p{Lu}/u.test(word) && !/^\p{Lu}+$/u.test(word.slice(0, 2));
}

/** Capitalised token runs (1–3 words), stopword-filtered, deduped, existing names excluded. */
export function extractNameCandidates(
  text: string,
  existingNames: readonly string[] = [],
): string[] {
  const known = new Set(existingNames.map((name) => name.trim().toLowerCase()).filter(Boolean));
  const seen = new Set<string>();
  const proposals: string[] = [];
  let run: string[] = [];

  const flush = () => {
    if (run.length === 0) return;
    // "The Harbour" is a place, not a person — drop a leading stopword of a longer run.
    const words =
      run.length > 1 && STOPWORDS.has((run[0] ?? "").toLowerCase()) ? run.slice(1) : run;
    run = [];
    const joined = words.join(" ");
    const key = joined.toLowerCase();
    if (known.has(key) || seen.has(key)) return;
    if (words.every((word) => STOPWORDS.has(word.toLowerCase()))) return;
    // "Voss" adds nothing once "Mina Voss" is already proposed/known.
    if (words.length === 1) {
      const word = key;
      const within = (name: string) => name.split(" ").includes(word);
      if ([...seen].some(within) || [...known].some(within)) return;
    }
    seen.add(key);
    proposals.push(joined);
  };

  for (const token of text.split(/[^\p{L}\p{N}'’]+/u)) {
    if (token.length === 0) continue;
    if (isCapitalized(token)) {
      if (run.length >= MAX_WORDS_PER_NAME) flush();
      run.push(token);
    } else {
      flush();
    }
  }
  flush();

  return proposals.slice(0, MAX_PROPOSALS);
}

/** Collects candidate names from several text sources, deduped in source order. */
export function extractNameCandidatesFromTexts(
  texts: readonly string[],
  existingNames: readonly string[] = [],
): string[] {
  const merged: string[] = [];
  const known = [...existingNames];
  for (const text of texts) {
    for (const candidate of extractNameCandidates(text, known)) {
      merged.push(candidate);
      known.push(candidate); // later texts see earlier proposals, incl. the suffix rule
    }
  }
  return merged.slice(0, MAX_PROPOSALS);
}
