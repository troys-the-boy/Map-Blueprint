import { describe, expect, it } from "vitest";
import { applyResult, generateRoute } from "../src/core/generate";
import { readRouteParams, writeRouteParams } from "../src/core/generators/params";
import { T } from "../src/core/grid";
import { BIOMES, addNewMap, newRegion } from "../src/core/model";
import type { Biome } from "../src/core/model";
import { MoveGraph, openingCells } from "../src/core/reach";
import { Rng } from "../src/core/rng";
import { serializeProject } from "../src/core/project";

const SIZES: Array<[number, number]> = [
  [20, 40],
  [30, 60],
  [40, 80],
  [40, 20],
  [60, 30],
  [24, 70],
  [15, 100],
];

function makeRoute(seed: number, width: number, height: number, biome: Biome = "temperate_rainforest") {
  const region = newRegion("Test", 1);
  const map = addNewMap(region, { name: "Route 1", mapType: "route", width, height, seed, biome });
  return { region, map };
}

describe("route generator", () => {
  it("passes reachability on 200 random seeds (and every other validation error check)", () => {
    const rng = new Rng(2026);
    const failures: string[] = [];
    for (let k = 0; k < 200; k++) {
      const seed = rng.nextUint32();
      const [w, h] = SIZES[k % SIZES.length];
      const { map } = makeRoute(seed, w, h, BIOMES[k % BIOMES.length]);
      const result = generateRoute(map);
      const errors = result.issues.filter((i) => i.severity === "error");
      if (errors.length) failures.push(`seed ${seed} (${w}×${h}): ${errors.map((e) => e.message).join("; ")}`);

      // Independent check: every entrance reaches every other one without HMs.
      const graph = new MoveGraph({ width: w, height: h, terrain: result.terrain, entities: result.entities }, new Set());
      const ends = result.openings.map((o) => openingCells(o, w, h));
      for (const a of ends) {
        const reach = graph.forward(a);
        for (const b of ends) if (!b.some((c) => reach[c])) failures.push(`seed ${seed}: entrance not reachable`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("gives exactly the same map for the same seed", () => {
    for (const seed of [1, 42, 99999]) {
      const a = makeRoute(seed, 30, 60);
      const b = makeRoute(seed, 30, 60);
      applyResult(a.map, generateRoute(a.map));
      applyResult(b.map, generateRoute(b.map));
      expect(serializeProject(a.region, "t", new Date(0))).toBe(serializeProject(b.region, "t", new Date(0)));
    }
  });

  it("gives different maps for different seeds", () => {
    const a = generateRoute(makeRoute(1, 30, 60).map);
    const b = generateRoute(makeRoute(2, 30, 60).map);
    expect(Array.from(a.terrain)).not.toEqual(Array.from(b.terrain));
  });

  it("places the basic entities", () => {
    const r = generateRoute(makeRoute(7, 30, 60).map);
    const kinds = new Set(r.entities.map((e) => e.kind));
    expect(kinds.has("trainer")).toBe(true);
    expect(kinds.has("item_ball")).toBe(true);
    expect(kinds.has("sign")).toBe(true);
    // IDs are unique.
    expect(new Set(r.entities.map((e) => e.id)).size).toBe(r.entities.length);
  });

  it("never changes locked cells", () => {
    const { map } = makeRoute(5, 30, 60);
    const w = map.width;
    // Lock a pond the user painted in the middle of the map.
    for (let y = 20; y < 24; y++)
      for (let x = 4; x < 9; x++) {
        map.layers.terrain.data[y * w + x] = T.waterDeep;
        map.layers.locks.data[y * w + x] = 1;
      }
    const r = generateRoute(map);
    for (let y = 20; y < 24; y++) for (let x = 4; x < 9; x++) expect(r.terrain[y * w + x]).toBe(T.waterDeep);
  });

  it("explains, rather than overwrites, a locked wall across the whole route", () => {
    const { map } = makeRoute(5, 20, 40);
    const w = map.width;
    for (let x = 0; x < w; x++) {
      map.layers.terrain.data[20 * w + x] = T.rockWall;
      map.layers.locks.data[20 * w + x] = 1;
    }
    const r = generateRoute(map);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "unreachable-exit")).toBe(true);
    for (let x = 0; x < w; x++) expect(r.terrain[20 * w + x]).toBe(T.rockWall);
  });

  it("keeps the user's own entrances", () => {
    const { map } = makeRoute(3, 40, 20);
    map.openings = [
      { id: "a", edge: "west", start: 8, width: 3 },
      { id: "b", edge: "east", start: 4, width: 3 },
      { id: "c", edge: "north", start: 20, width: 2 },
    ];
    const r = generateRoute(map);
    expect(r.openings).toEqual(map.openings);
    expect(r.ok).toBe(true);
  });

  it("reads and writes settings, clamping bad values", () => {
    const p = readRouteParams({ winding: 5, trainers: -3, availableHms: "cut,surf,teleport", borderStyle: "cliff" });
    expect(p.winding).toBe(1);
    expect(p.trainers).toBe(0);
    expect(p.availableHms).toEqual(["cut", "surf"]);
    expect(p.borderStyle).toBe("cliff");
    expect(readRouteParams(writeRouteParams(p))).toEqual(p);
  });
});
