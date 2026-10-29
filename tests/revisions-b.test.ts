// Revisions after Milestone 6, part B: editing rivers on the sketch.

import { describe, expect, it } from "vitest";
import type { SketchRiver } from "../src/core/sketch";
import { insertRiverPoint, newSketch, removeRiverPoint, riverAt, riverMidpoints, riverPointAt } from "../src/core/sketch";

const river = (): SketchRiver => ({ id: "r1", points: [0, 0, 40, 0, 40, 30], width: 3 });

describe("river editing helpers", () => {
  it("finds the river under a point, counting its width", () => {
    const s = newSketch(100, 100);
    s.rivers.push(river());
    expect(riverAt(s, 20, 1, 0)?.id).toBe("r1"); // on the line (width 3 reaches 1.5 each side)
    expect(riverAt(s, 20, 3, 0)).toBeNull();
    expect(riverAt(s, 20, 3, 2)?.id).toBe("r1"); // within the tolerance
    expect(riverAt(s, 41, 15, 0)?.id).toBe("r1"); // the second stretch
  });

  it("finds a point by number, the nearest one within reach", () => {
    expect(riverPointAt(river(), 39, 1, 3)).toBe(1);
    expect(riverPointAt(river(), 20, 0, 3)).toBe(-1);
  });

  it("adds a point in the middle of a stretch, and removes points but keeps at least two", () => {
    const r = river();
    expect(riverMidpoints(r)).toEqual([
      [20, 0],
      [40, 15],
    ]);
    const k = insertRiverPoint(r, 0, 20, 0);
    expect(k).toBe(1);
    expect(r.points).toEqual([0, 0, 20, 0, 40, 0, 40, 30]);
    expect(removeRiverPoint(r, 2)).toBe(true);
    expect(r.points).toEqual([0, 0, 20, 0, 40, 30]);
    expect(removeRiverPoint(r, 0)).toBe(true);
    expect(removeRiverPoint(r, 0)).toBe(false);
    expect(r.points).toEqual([20, 0, 40, 30]);
  });
});
