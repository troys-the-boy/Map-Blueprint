import { describe, expect, it } from "vitest";
import { Rng, deriveSeed, normalizeSeed } from "../src/core/rng";

describe("Rng", () => {
  it("gives the same sequence for the same seed", () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 1000; i++) expect(a.nextUint32()).toBe(b.nextUint32());
  });

  it("matches a fixed reference sequence (guards against accidental algorithm changes)", () => {
    const r = new Rng(1);
    const first = [r.nextUint32(), r.nextUint32(), r.nextUint32()];
    // Changing these numbers changes every generated map; only update on purpose.
    expect(first).toEqual([2693262067, 11749833, 2265367787]);
  });

  it("gives different sequences for different seeds", () => {
    const a = new Rng(1);
    const b = new Rng(2);
    const same = Array.from({ length: 20 }, () => a.nextUint32() === b.nextUint32()).filter(Boolean).length;
    expect(same).toBeLessThan(2);
  });

  it("keeps int() inside its bounds and reaches both ends", () => {
    const r = new Rng(7);
    const seen = new Set<number>();
    for (let i = 0; i < 5000; i++) {
      const v = r.int(3, 9);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(9);
      seen.add(v);
    }
    expect([...seen].sort()).toEqual([3, 4, 5, 6, 7, 8, 9]);
  });

  it("next() stays in [0, 1)", () => {
    const r = new Rng(123);
    for (let i = 0; i < 10000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("fork() depends only on the seed and label, not on draws so far", () => {
    const a = new Rng(99);
    const b = new Rng(99);
    for (let i = 0; i < 50; i++) b.next();
    expect(a.fork("terrain").nextUint32()).toBe(b.fork("terrain").nextUint32());
    expect(a.fork("terrain").nextUint32()).not.toBe(a.fork("entities").nextUint32());
  });

  it("shuffle keeps every element", () => {
    const r = new Rng(5);
    const list = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(r.shuffle(list).sort()).toEqual(list);
  });

  it("normalizes odd seeds", () => {
    expect(normalizeSeed(-5)).toBe(5);
    expect(normalizeSeed(3.7)).toBe(3);
    expect(normalizeSeed(NaN)).toBe(0);
    expect(normalizeSeed(2 ** 32)).toBe(0);
    expect(deriveSeed(1, "a")).toBe(deriveSeed(1, "a"));
    expect(deriveSeed(1, "a")).not.toBe(deriveSeed(2, "a"));
  });
});
