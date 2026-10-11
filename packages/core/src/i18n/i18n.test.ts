import { describe, expect, it } from "vitest";
import { en, format, getLocale, issueMessage, messages, plural, setLocale, uk } from "./index";

function leaves(value: unknown, path: string): Array<[string, unknown]> {
  if (typeof value !== "object" || value === null) return [[path, value]];
  const out: Array<[string, unknown]> = [];
  for (const [key, child] of Object.entries(value)) {
    out.push(...leaves(child, path === "" ? key : `${path}.${key}`));
  }
  return out;
}

function isPlural(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "other" in value &&
    typeof (value as { other: unknown }).other === "string"
  );
}

/** Key-for-key structure, with plural entries collapsed to one node (locales add categories). */
function shape(value: unknown): unknown {
  if (typeof value === "string") return "string";
  if (isPlural(value)) return "plural";
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, shape(child)]),
  );
}

describe("i18n catalogues", () => {
  it("every en leaf is a non-empty string", () => {
    for (const [path, value] of leaves(en, "")) {
      expect(typeof value, `leaf ${path}`).toBe("string");
      expect((value as string).trim().length, `leaf ${path}`).toBeGreaterThan(0);
    }
  });

  it("uk has exactly the same keys and leaf kinds as en", () => {
    expect(shape(uk)).toEqual(shape(en));
  });

  it("every uk leaf is a non-empty string", () => {
    for (const [path, value] of leaves(uk, "")) {
      expect(typeof value, `leaf ${path}`).toBe("string");
      expect((value as string).trim().length, `leaf ${path}`).toBeGreaterThan(0);
    }
  });

  it("format interpolates and keeps unknown placeholders visible", () => {
    expect(format("{n} of 9", { n: 3 })).toBe("3 of 9");
    expect(format("{missing} here", {})).toBe("{missing} here");
    expect(format("plain", {})).toBe("plain");
  });
});

describe("locale runtime", () => {
  it("messages follows setLocale (the proxy reads the active catalogue)", () => {
    expect(getLocale()).toBe("en");
    expect(messages.app.tagline).toBe(en.app.tagline);
    setLocale("uk");
    expect(messages.app.tagline).toBe(uk.app.tagline);
    expect(messages.plan.stepsComplete).toBe(uk.plan.stepsComplete);
    setLocale("en");
    expect(messages.app.tagline).toBe(en.app.tagline);
  });

  it("issueMessage resolves in the active locale and falls back to the code", () => {
    setLocale("uk");
    expect(issueMessage("S8_NO_SCENES")).toBe(uk.issues.S8_NO_SCENES);
    setLocale("en");
    expect(issueMessage("S8_NO_SCENES")).toBe(en.issues.S8_NO_SCENES);
    expect(issueMessage("NOT_A_CODE")).toBe("NOT_A_CODE");
  });
});

describe("plural()", () => {
  it("English picks one / other", () => {
    expect(plural(en.scenes.sceneCount, 1)).toBe("1 scene");
    expect(plural(en.scenes.sceneCount, 3)).toBe("3 scenes");
    expect(plural(en.world.entries, 1)).toBe("1 entry");
  });

  it("Ukrainian picks one / few / many", () => {
    setLocale("uk");
    expect(plural(uk.scenes.sceneCount, 1)).toBe("1 сцена");
    expect(plural(uk.scenes.sceneCount, 2)).toBe("2 сцени");
    expect(plural(uk.scenes.sceneCount, 5)).toBe("5 сцен");
    expect(plural(uk.scenes.sceneCount, 21)).toBe("21 сцена");
    expect(plural(uk.scenes.sceneCount, 22)).toBe("22 сцени");
    setLocale("en");
  });

  it("interpolates the count and any extra placeholders", () => {
    setLocale("uk");
    expect(plural(uk.timeline.coverage, 3, { placed: 2 })).toBe("Розміщено 2 з 3 сцен");
    expect(plural(uk.timeline.coverage, 1, { placed: 1 })).toBe("Розміщено 1 з 1 сцени");
    setLocale("en");
    expect(plural(en.timeline.coverage, 3, { placed: 2 })).toBe("2 of 3 scenes placed");
  });
});
