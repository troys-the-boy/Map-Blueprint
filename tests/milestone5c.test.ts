// Milestone 5, part C: caves (one floor).

import { describe, expect, it } from "vitest";
import { applyResult, generateRoute } from "../src/core/generate";
import { neededTables, draftEncounters, parseSpeciesList, EXAMPLE_SPECIES } from "../src/core/encounters";
import { readCaveParams } from "../src/core/generators/caveParams";
import { IS_WALKABLE, T } from "../src/core/grid";
import { addNewMap, newRegion } from "../src/core/model";
import { MOVEMENT_HMS, MoveGraph } from "../src/core/reach";
import { newWarp } from "../src/core/things";

function cave(seed: number, params: Record<string, string | number | boolean> = {}, size = 40) {
  const region = newRegion("r", 1);
  const map = addNewMap(region, { name: "Moss Cave", mapType: "cave", width: size, height: size, seed, biome: "alpine" });
  map.params = params;
  return map;
}

const count = (terrain: Uint8Array, t: number) => terrain.reduce((n, v) => n + (v === t ? 1 : 0), 0);

describe("Milestone 5 goal: caves generate valid maps over 100 seeds", () => {
  it("across sizes, openness, exits, platforms and water", () => {
    for (let seed = 1; seed <= 100; seed++) {
      const map = cave(seed, { openness: (seed % 5) / 4, exits: 1 + (seed % 3), platforms: seed % 3, waterLevel: (seed % 4) / 3, rockSmash: seed % 3 }, [30, 40, 50][seed % 3]);
      const r = generateRoute(map);
      expect(r.ok, `seed ${seed}: ${r.issues.filter((i) => i.severity === "error").map((i) => i.code)}`).toBe(true);
    }
  }, 240_000);
});

describe("caves", () => {
  it("are cave floor inside rock, with the asked-for number of exits as cave mouths", () => {
    const r = generateRoute(cave(1, { exits: 3 }));
    expect(count(r.terrain, T.caveFloor)).toBeGreaterThan(200);
    expect(count(r.terrain, T.rockWall)).toBeGreaterThan(400);
    expect(count(r.terrain, T.tree) + count(r.terrain, T.ground)).toBe(0);
    const exits = r.warps.filter((w) => w.kind === "cave_mouth");
    expect(exits).toHaveLength(3);
    for (const w of exits) {
      expect(r.terrain[w.y * 40 + w.x]).toBe(T.caveEntrance);
      expect(IS_WALKABLE[r.terrain[(w.y + 1) * 40 + w.x]]).toBe(true);
    }
  });

  it("every exit leads to every other one (the checks treat exits as the entrances)", () => {
    for (let seed = 1; seed <= 10; seed++) {
      const r = generateRoute(cave(seed, { exits: 3 }));
      const graph = new MoveGraph({ width: 40, height: 40, terrain: r.terrain, entities: r.entities, elevation: r.elevation }, new Set());
      const fronts = r.warps.map((w) => (w.y + 1) * 40 + w.x);
      const reach = graph.forward([fronts[0]]);
      for (const f of fronts) expect(reach[f], `seed ${seed}`).toBe(1);
    }
  });

  it("an exit set up by hand is kept and used; Generate only adds the rest", () => {
    const map = cave(2, { exits: 2 });
    applyResult(map, generateRoute(map));
    const mine = { ...map.warps[0], destMap: "MAP_ROUTE5", destWarpId: 0, locked: true };
    map.warps = [mine];
    applyResult(map, generateRoute(map));
    expect(map.warps.filter((w) => w.locked)).toEqual([mine]);
    expect(map.warps).toHaveLength(2);
  });

  it("has trainers watching the main way, platforms with stairs, Rock Smash rocks and items", () => {
    let trainers = 0;
    let stairs = 0;
    let rocks = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const r = generateRoute(cave(seed, { platforms: 2, rockSmash: 2 }, 50));
      trainers += r.entities.filter((e) => e.kind === "trainer").length;
      stairs += count(r.terrain, T.stairs);
      rocks += r.entities.filter((e) => e.kind === "smash_rock").length;
      expect(r.entities.some((e) => e.kind === "item_ball")).toBe(true);
    }
    expect(trainers).toBeGreaterThan(10);
    expect(stairs).toBeGreaterThan(0);
    expect(rocks).toBeGreaterThan(5);
  });

  it("puts underground water only off the main way, and every item can be reached", () => {
    for (let seed = 1; seed <= 10; seed++) {
      const r = generateRoute(cave(seed, { waterLevel: 1 }));
      const all = new MoveGraph({ width: 40, height: 40, terrain: r.terrain, entities: r.entities, elevation: r.elevation }, new Set(MOVEMENT_HMS)).forward(r.warps.map((w) => (w.y + 1) * 40 + w.x));
      for (const e of r.entities.filter((x) => x.kind === "item_ball")) {
        const near = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => all[(e.y + dy) * 40 + e.x + dx]);
        expect(near, `seed ${seed} item ${e.id}`).toBe(true);
      }
      expect(r.issues.some((i) => i.code === "unreachable-exit")).toBe(false);
    }
  });

  it("drafts cave encounters at the cave rate", () => {
    const map = cave(3, { rockSmash: 2 });
    applyResult(map, generateRoute(map));
    expect(neededTables(map)).toContain("land");
    const plan = draftEncounters(map, parseSpeciesList(EXAMPLE_SPECIES).entries);
    expect(plan.land?.rate).toBe(10);
  });

  it("settings are read with defaults and clamped", () => {
    expect(readCaveParams({})).toEqual({ exits: 2, openness: 0.5, platforms: 1, waterLevel: 0.2, rockSmash: 1, boulders: 0, floors: 1, ladders: 1, laddersUp: 0, laddersDown: 0 });
    expect(readCaveParams({ exits: 9, openness: -1 })).toMatchObject({ exits: 4, openness: 0 });
  });

  it("a hand-placed warp doesn't count as an exit unless it's a cave mouth", () => {
    const map = cave(4, { exits: 1 });
    map.warps.push({ ...newWarp(map, 5, 5), kind: "ladder", destMap: "MAP_X", destWarpId: 0 });
    const r = generateRoute(map);
    expect(r.warps.filter((w) => w.kind === "cave_mouth")).toHaveLength(1);
  });
});
