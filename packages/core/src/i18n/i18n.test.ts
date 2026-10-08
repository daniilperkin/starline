import { describe, expect, it } from "vitest";
import { en, format, messages } from "./index";

function leaves(value: unknown, path: string): Array<[string, unknown]> {
  if (typeof value !== "object" || value === null) return [[path, value]];
  const out: Array<[string, unknown]> = [];
  for (const [key, child] of Object.entries(value)) {
    out.push(...leaves(child, path === "" ? key : `${path}.${key}`));
  }
  return out;
}

describe("i18n catalogue", () => {
  it("every leaf is a non-empty string", () => {
    for (const [path, value] of leaves(en, "")) {
      expect(typeof value, `leaf ${path}`).toBe("string");
      expect((value as string).trim().length, `leaf ${path}`).toBeGreaterThan(0);
    }
  });

  it("has no empty groups", () => {
    for (const [path, value] of leaves(en, "")) {
      expect(typeof value, `group ${path}`).toBe("string");
    }
  });

  it("messages is the en catalogue (swap point)", () => {
    expect(messages).toBe(en);
  });

  it("format interpolates and keeps unknown placeholders visible", () => {
    expect(format("{n} of 9", { n: 3 })).toBe("3 of 9");
    expect(format("{missing} here", {})).toBe("{missing} here");
    expect(format("plain", {})).toBe("plain");
  });
});
