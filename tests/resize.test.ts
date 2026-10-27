// Resizing a map after it was made.

import { describe, expect, it } from "vitest";
import { generateRoute, applyResult } from "../src/core/generate";
import { T } from "../src/core/grid";
import { addNewMap, newRegion } from "../src/core/model";
import { parseProject, serializeProject } from "../src/core/project";
import { hasLoss, resizeMap, resizePreview } from "../src/core/resize";
import { newThing } from "../src/core/things";
import { edgeBand, newZone } from "../src/core/zones";

function blank(w = 20, h = 30) {
  const region = newRegion("r", 1);
  return { region, map: addNewMap(region, { name: "Route 9", mapType: "route", width: w, height: h, seed: 4, biome: "meadow" }) };
}

describe("resizing a map", () => {
  it("growing with the top-left anchor keeps every cell where it was and adds plain unlocked ground", () => {
    const { map } = blank();
    map.layers.terrain.data[5 * 20 + 3] = T.tree;
    map.layers.locks.data[5 * 20 + 3] = 1;
    resizeMap(map, 25, 34, { x: 0, y: 0 });
    expect([map.width, map.height]).toEqual([25, 34]);
    expect(map.layers.terrain.data[5 * 25 + 3]).toBe(T.tree);
    expect(map.layers.locks.data[5 * 25 + 3]).toBe(1);
    expect(map.layers.terrain.data[33 * 25 + 24]).toBe(T.ground);
    expect(map.layers.locks.data[33 * 25 + 24]).toBe(0);
    expect(hasLoss(resizePreview(blank().map, 25, 34, { x: 0, y: 0 }))).toBe(false);
  });

  it("growing from the middle moves everything by half the added size", () => {
    const { map } = blank();
    map.entities.push(newThing(map, "trainer", 4, 6));
    map.openings.push({ id: "o1", edge: "north", start: 8, width: 3, kind: "walk" });
    resizeMap(map, 24, 36, { x: 1, y: 1 });
    expect([map.entities[0].x, map.entities[0].y]).toEqual([6, 9]);
    expect(map.openings[0].start).toBe(10);
  });

  it("shrinking lists what is cut off, then removes it", () => {
    const { map } = blank();
    map.entities.push(newThing(map, "trainer", 18, 2), newThing(map, "item_ball", 2, 2));
    map.layers.locks.data[2 * 20 + 19] = 1;
    map.openings.push({ id: "o1", edge: "south", start: 14, width: 4, kind: "walk" }, { id: "o2", edge: "east", start: 10, width: 3, kind: "walk" });
    const edge = newZone(map, "edge", { boundary: "cliff" });
    for (const i of edgeBand(map, "east", 0, 29, 2)) edge.mask.data[i] = 1;
    map.layers.zones.push(edge);
    const loss = resizePreview(map, 16, 30, { x: 0, y: 0 });
    expect(loss.cells).toBe(4 * 30);
    expect(loss.lockedCells).toBe(1);
    expect(loss.things).toHaveLength(1);
    expect(loss.zonesRemoved).toEqual([edge.name]);
    expect(loss.openingsTrimmed).toHaveLength(1);
    // The east entrance moves with the east edge, so it isn't lost.
    expect(loss.openingsRemoved).toHaveLength(0);

    resizeMap(map, 16, 30, { x: 0, y: 0 });
    expect(map.entities.map((e) => e.kind)).toEqual(["item_ball"]);
    expect(map.layers.zones).toHaveLength(0);
    expect(map.openings.find((o) => o.id === "o1")).toMatchObject({ start: 14, width: 2 });
  });

  it("keeps the saved file valid (edit records move or are dropped)", () => {
    const { region, map } = blank();
    map.edits.push(
      { type: "stroke", tool: "pencil", terrain: "tree", brush: 1, locked: true, cells: [1, 1, 19, 29] },
      { type: "area", action: "move", area: { x: 15, y: 20, w: 5, h: 5 }, toX: 2, toY: 2 },
      { type: "smart", kind: "path", width: 2, direction: null, points: [18, 28, 19, 29] },
      { type: "entity", action: "place", id: "t1", kind: "trainer", x: 3, y: 3 },
    );
    resizeMap(map, 12, 18, { x: 0, y: 0 });
    expect(map.edits).toHaveLength(2);
    expect(() => parseProject(serializeProject(region, "test"))).not.toThrow();
  });

  it("a resized map still generates", () => {
    const { map } = blank(20, 40);
    applyResult(map, generateRoute(map));
    resizeMap(map, 26, 50, { x: 1, y: 1 });
    map.openings = [];
    expect(generateRoute(map).ok).toBe(true);
  });
});
