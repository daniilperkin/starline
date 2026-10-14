import { describe, expect, it } from "vitest";
import { CONSTELLATIONS } from "./constellations";

/**
 * Structural guards for the backdrop's constellation data (owner request, 2026-10-14).
 * A bad join would silently draw nothing (NaN canvas coordinates), so the data is
 * checked here rather than discovered as a missing line on screen.
 */
describe("constellation data", () => {
  it("ships the twelve iconic northern constellations with unique ids", () => {
    expect(CONSTELLATIONS).toHaveLength(12);
    expect(new Set(CONSTELLATIONS.map((c) => c.id)).size).toBe(12);
  });

  it("has finite, in-range geometry and a real angular span", () => {
    for (const c of CONSTELLATIONS) {
      expect(c.stars.length).toBeGreaterThanOrEqual(5);
      expect(c.span).toBeGreaterThan(4);
      expect(c.span).toBeLessThan(35);
      for (const s of c.stars) {
        expect(Number.isFinite(s.x)).toBe(true);
        expect(Number.isFinite(s.y)).toBe(true);
        expect(Math.abs(s.x)).toBeLessThanOrEqual(20);
        expect(Math.abs(s.y)).toBeLessThanOrEqual(20);
        expect(s.mag).toBeGreaterThanOrEqual(-1);
        expect(s.mag).toBeLessThanOrEqual(5.5);
      }
    }
  });

  it("joins only existing stars, without self-links", () => {
    for (const c of CONSTELLATIONS) {
      for (const [a, b] of c.lines) {
        expect(a).not.toBe(b);
        expect(c.stars[a]).toBeDefined();
        expect(c.stars[b]).toBeDefined();
      }
    }
  });

  it("gives every constellation a bright anchor star", () => {
    for (const c of CONSTELLATIONS) {
      expect(Math.min(...c.stars.map((s) => s.mag))).toBeLessThanOrEqual(2.3);
    }
  });

  it("joins every star into the figure (no orphan dots)", () => {
    for (const c of CONSTELLATIONS) {
      const joined = new Set<number>();
      for (const [a, b] of c.lines) {
        joined.add(a);
        joined.add(b);
      }
      for (let i = 0; i < c.stars.length; i++) {
        expect(joined.has(i)).toBe(true);
      }
    }
  });
});
