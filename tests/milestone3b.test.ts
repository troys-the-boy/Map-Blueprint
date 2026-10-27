// Milestone 3, part B: smart strokes.

import { describe, expect, it } from "vitest";
import { applyResult, generateRoute } from "../src/core/generate";
import { T } from "../src/core/grid";
import type { SmartEdit } from "../src/core/model";
import { addNewMap, newRegion } from "../src/core/model";
import { applyDiff, emptyDiff } from "../src/core/paint";
import { CURRENT_SCHEMA_VERSION, parseProject, serializeProject } from "../src/core/project";
import { applySmartStroke, ledgeDirection, strokeWidth } from "../src/core/strokes";
import { ELEVATION_LEVELS } from "../src/core/terrain";

const LEVEL = (n: (typeof ELEVATION_LEVELS)[number]) => ELEVATION_LEVELS.indexOf(n);

function blank(w = 20, h = 20) {
  const region = newRegion("r", 1);
  return { region, map: addNewMap(region, { name: "Route 5", mapType: "route", width: w, height: h, seed: 3 }) };
}
const stroke = (kind: SmartEdit["kind"], points: number[], width = 1, direction: SmartEdit["direction"] = null): SmartEdit => ({ type: "smart", kind, width, direction, points });
const at = (map: ReturnType<typeof blank>["map"], x: number, y: number) => map.layers.terrain.data[y * map.width + x];
const apply = (map: ReturnType<typeof blank>["map"], e: SmartEdit) => {
  const diff = emptyDiff();
  applySmartStroke(map, e, diff, new Map());
  return diff;
};

describe("smart strokes", () => {
  it("paths are widened to the narrowest-path setting, and locked", () => {
    expect(strokeWidth("path", 1, 2)).toBe(2);
    expect(strokeWidth("path", 3, 2)).toBe(3);
    expect(strokeWidth("stream", 1, 1)).toBe(2);
    const { map } = blank();
    apply(map, stroke("path", [2, 5, 10, 5], 2));
    for (let x = 2; x <= 10; x++) {
      expect(at(map, x, 5)).toBe(T.path);
      expect(at(map, x, 6)).toBe(T.path);
      expect(map.layers.locks.data[5 * 20 + x]).toBe(1);
    }
  });

  it("a stream gets banks through trees, and a bridge where it crosses a path", () => {
    const { map } = blank();
    map.layers.terrain.data.fill(T.tree);
    apply(map, stroke("path", [0, 10, 19, 10], 2));
    apply(map, stroke("stream", [5, 0, 5, 19], 2));
    // Water, at Porymap's water level.
    expect(at(map, 5, 2)).toBe(T.waterDeep);
    expect(map.layers.elevation.data[2 * 20 + 5]).toBe(LEVEL("water"));
    // Banks: open ground on both sides where there were trees.
    expect(at(map, 4, 2)).toBe(T.ground);
    expect(at(map, 7, 2)).toBe(T.ground);
    expect(at(map, 3, 2)).toBe(T.tree);
    // Bridge where it crosses the path.
    expect(at(map, 5, 10)).toBe(T.bridge);
    expect(at(map, 6, 11)).toBe(T.bridge);
    expect(map.layers.elevation.data[10 * 20 + 5]).toBe(LEVEL("bridge"));
  });

  it("a path drawn across water becomes a bridge", () => {
    const { map } = blank();
    apply(map, stroke("stream", [0, 8, 19, 8], 2));
    apply(map, stroke("path", [10, 0, 10, 19], 2));
    expect(at(map, 10, 8)).toBe(T.bridge);
    expect(at(map, 10, 2)).toBe(T.path);
  });

  it("tree walls are at least 2 thick", () => {
    const { map } = blank();
    apply(map, stroke("tree_wall", [3, 3, 3, 12], 2));
    expect(at(map, 3, 6)).toBe(T.tree);
    expect(at(map, 4, 6)).toBe(T.tree);
  });

  it("grass fills an outline but leaves paths and water", () => {
    const { map } = blank();
    apply(map, stroke("path", [10, 0, 10, 19], 1));
    apply(map, stroke("grass", [4, 4, 16, 4, 16, 16, 4, 16]));
    expect(at(map, 7, 10)).toBe(T.tallGrass);
    expect(at(map, 10, 10)).toBe(T.path);
    expect(at(map, 2, 2)).toBe(T.ground);
  });

  it("water bodies fill an outline with a tidy shoreline", () => {
    const { map } = blank();
    apply(map, stroke("water", [4, 4, 14, 4, 14, 14, 4, 14]));
    expect(at(map, 9, 9)).toBe(T.waterDeep);
    expect(map.layers.elevation.data[9 * 20 + 9]).toBe(LEVEL("water"));
    // No water cell sticks out on its own.
    for (let y = 0; y < 20; y++)
      for (let x = 0; x < 20; x++) {
        if (at(map, x, y) !== T.waterDeep) continue;
        const n = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => at(map, x + dx, y + dy) === T.waterDeep).length;
        expect(n).toBeGreaterThanOrEqual(2);
      }
  });

  it("ledges jump south across the map and east down it, unless set", () => {
    expect(ledgeDirection([2, 5, 12, 6], null)).toBe("s");
    expect(ledgeDirection([5, 2, 6, 14], null)).toBe("e");
    expect(ledgeDirection([5, 2, 6, 14], "w")).toBe("w");
    const { map } = blank();
    apply(map, stroke("ledge", [2, 5, 12, 5]));
    expect(at(map, 7, 5)).toBe(T.ledgeS);
    expect(at(map, 7, 6)).toBe(T.ground);
  });

  it("undo restores everything a stroke changed", () => {
    const { map } = blank();
    const before = map.layers.terrain.data.slice();
    const diff = apply(map, stroke("stream", [0, 3, 19, 15], 3));
    applyDiff(map, diff, "before");
    expect(Array.from(map.layers.terrain.data)).toEqual(Array.from(before));
  });

  it("smart-stroke edits save and open (file format 6 and later)", () => {
    const { region, map } = blank();
    const e = stroke("ledge", [1, 1, 5, 1], 1, "s");
    map.edits.push(e);
    expect(CURRENT_SCHEMA_VERSION).toBeGreaterThanOrEqual(6);
    expect(parseProject(serializeProject(region, "test")).maps[0].edits).toEqual([e]);
  });
});

describe("Milestone 3 goal: drawn features survive Generate", () => {
  it("a winding path and a stream, crossing with a bridge, are kept when the route is generated again", () => {
    const { map } = blank(30, 60);
    applyResult(map, generateRoute(map));
    apply(map, stroke("path", [3, 10, 8, 14, 12, 12, 18, 18, 14, 26, 20, 32, 26, 30], 2));
    apply(map, stroke("stream", [2, 22, 10, 20, 16, 24, 27, 21], 2));
    const drawn = map.layers.terrain.data.slice();
    const locked = Array.from(map.layers.locks.data.entries()).filter(([, v]) => v).map(([i]) => i);
    expect(drawn.some((t) => t === T.bridge)).toBe(true);
    for (let seed = 1; seed <= 5; seed++) {
      map.seed = seed;
      const r = generateRoute(map);
      // Every drawn cell is kept, except that Generate may lay a bridge over the drawn stream
      // where its own path crosses it (Milestone 5).
      for (const i of locked) {
        if (drawn[i] === T.waterDeep && r.terrain[i] === T.bridge) continue;
        expect(r.terrain[i]).toBe(drawn[i]);
      }
    }
  });
});
