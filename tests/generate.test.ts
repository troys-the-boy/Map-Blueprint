import { describe, expect, it } from "vitest";
import { applyResult, generateRoute } from "../src/core/generate";
import { readRouteParams, writeRouteParams } from "../src/core/generators/params";
import { IS_GRASS, T, cheapestPath } from "../src/core/grid";
import { trainerSight } from "../src/core/entities";
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

const LAYOUTS = ["land", "coastal", "river", "water"] as const;

describe("route generator", () => {
  it("passes reachability on 200 random seeds across every layout (and every other validation error check)", () => {
    const rng = new Rng(2026);
    const failures: string[] = [];
    for (let k = 0; k < 200; k++) {
      const seed = rng.nextUint32();
      const [w, h] = SIZES[k % SIZES.length];
      const layout = LAYOUTS[k % LAYOUTS.length];
      const { map } = makeRoute(seed, w, h, BIOMES[k % BIOMES.length]);
      map.params = { layout, elevation: (k % 5) / 4 };
      const result = generateRoute(map);
      const errors = result.issues.filter((i) => i.severity === "error");
      if (errors.length) failures.push(`seed ${seed} (${w}×${h}, ${layout}): ${errors.map((e) => e.message).join("; ")}`);

      // Independent check, honouring ledges and elevation: on foot, every walk entrance
      // reaches every other one with no HMs; on open water, surf entrances connect with Surf.
      const kind = layout === "water" ? "surf" : "walk";
      const graph = new MoveGraph({ width: w, height: h, terrain: result.terrain, entities: result.entities, elevation: result.elevation }, new Set(layout === "water" ? ["surf"] : []));
      const ends = result.openings.filter((o) => o.kind === kind).map((o) => openingCells(o, w, h));
      if (ends.length < 2) failures.push(`seed ${seed} (${layout}): fewer than two ${kind} entrances`);
      for (const a of ends) {
        const reach = graph.forward(a);
        for (const b of ends) if (!b.some((c) => reach[c])) failures.push(`seed ${seed} (${layout}): entrance not reachable`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("coastal: the sea fills one long side, out to the map edge, with surf entrances on it", () => {
    for (const seed of [3, 30, 300]) {
      const { map } = makeRoute(seed, 30, 60, "coastal");
      const r = generateRoute(map);
      const water = (x: number, y: number) => r.terrain[y * 30 + x] === T.waterDeep;
      const westSea = Array.from({ length: 60 }, (_, y) => water(0, y)).filter(Boolean).length;
      const eastSea = Array.from({ length: 60 }, (_, y) => water(29, y)).filter(Boolean).length;
      expect(Math.max(westSea, eastSea)).toBe(60);
      const share = Array.from(r.terrain).filter((t) => t === T.waterDeep).length / r.terrain.length;
      expect(share).toBeGreaterThan(0.2);
      expect(r.openings.filter((o) => o.kind === "surf")).toHaveLength(2);
      expect(r.ok).toBe(true);
    }
  });

  it("river: water runs from one short edge to the other", () => {
    const { map } = makeRoute(8, 30, 60);
    map.params = { layout: "river" };
    const r = generateRoute(map);
    const graph = new MoveGraph({ width: 30, height: 60, terrain: r.terrain, entities: [], elevation: r.elevation }, new Set(["surf"]));
    const [north, south] = r.openings.filter((o) => o.kind === "surf");
    expect(graph.forward(openingCells(north, 30, 60)).some((v, i) => v && openingCells(south, 30, 60).includes(i))).toBe(true);
  });

  it("open water: mostly sea, swimmers on the water, items on islands", () => {
    const { map } = makeRoute(12, 30, 60);
    map.params = { layout: "water" };
    const r = generateRoute(map);
    expect(Array.from(r.terrain).filter((t) => t === T.waterDeep).length / r.terrain.length).toBeGreaterThan(0.5);
    for (const t of r.entities.filter((e) => e.kind === "trainer")) expect(r.terrain[t.y * 30 + t.x]).toBe(T.waterDeep);
    for (const i of r.entities.filter((e) => e.kind === "item_ball")) expect(r.terrain[i.y * 30 + i.x]).not.toBe(T.waterDeep);
    expect(r.ok).toBe(true);
  });

  it("elevation: plateaus have cliffs, stairs and raised ground, and none when elevation is 0", () => {
    const hilly = makeRoute(21, 40, 80).map;
    hilly.params = { elevation: 1 };
    const r = generateRoute(hilly);
    expect(r.terrain.includes(T.stairs)).toBe(true);
    expect(r.elevation.some((e) => e >= 2)).toBe(true); // raised1 or higher
    const flat = makeRoute(21, 40, 80).map;
    flat.params = { elevation: 0 };
    const f = generateRoute(flat);
    expect(f.terrain.includes(T.stairs)).toBe(false);
  });

  it("two ways through: dodging trainers means more grass, sticking to the path means more battles", () => {
    let walkerBattles = 0;
    let dodgerBattles = 0;
    let walkerGrass = 0;
    let dodgerGrass = 0;
    for (const seed of [2, 4, 6, 8, 10, 12]) {
      const { map } = makeRoute(seed, 30, 60, "meadow");
      const r = generateRoute(map);
      const stand = new MoveGraph({ width: 30, height: 60, terrain: r.terrain, entities: r.entities, elevation: r.elevation }, new Set()).canStand;
      const sight = new Map<number, number>();
      r.entities.filter((e) => e.kind === "trainer").forEach((e, k) => trainerSight(e, 30, 60, r.terrain).forEach((c) => sight.set(c, k)));
      const [a, b] = r.openings.filter((o) => o.kind === "walk").map((o) => openingCells(o, 30, 60)[0]);
      const walk = (grassCost: number, sightCost: number) =>
        cheapestPath(30, 60, a, b, (i) => (!stand[i] ? Infinity : 1 + (IS_GRASS[r.terrain[i]] ? grassCost : 0) + (sight.has(i) ? sightCost : 0)))!;
      const walker = walk(40, 0);
      const dodger = walk(0, 40);
      walkerBattles += new Set(walker.filter((c) => sight.has(c)).map((c) => sight.get(c))).size;
      dodgerBattles += new Set(dodger.filter((c) => sight.has(c)).map((c) => sight.get(c))).size;
      walkerGrass += walker.filter((c) => IS_GRASS[r.terrain[c]]).length;
      dodgerGrass += dodger.filter((c) => IS_GRASS[r.terrain[c]]).length;
    }
    expect(walkerBattles).toBeGreaterThan(dodgerBattles);
    expect(dodgerGrass).toBeGreaterThan(walkerGrass);
    // Taking the path still crosses some grass.
    expect(walkerGrass).toBeGreaterThan(0);
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
      { id: "a", edge: "west", start: 8, width: 3, kind: "walk" },
      { id: "b", edge: "east", start: 4, width: 3, kind: "walk" },
      { id: "c", edge: "north", start: 20, width: 2, kind: "walk" },
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
