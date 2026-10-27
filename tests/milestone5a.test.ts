// Milestone 5, part A: towns.

import { describe, expect, it } from "vitest";
import { applyResult, generateRoute } from "../src/core/generate";
import { BUILDING_TYPES } from "../src/core/generators/townParams";
import { IS_WALKABLE, T } from "../src/core/grid";
import { addNewMap, newRegion } from "../src/core/model";
import { emptyDiff } from "../src/core/paint";
import { CURRENT_SCHEMA_VERSION, parseProject, serializeProject } from "../src/core/project";
import { MoveGraph, openingCells } from "../src/core/reach";
import { applySmartStroke, buildingLot } from "../src/core/strokes";
import { newWarp } from "../src/core/things";
import { validateMap } from "../src/core/validate";

function town(seed: number, params: Record<string, string | number | boolean> = {}, size = 30) {
  const region = newRegion("r", 1);
  const map = addNewMap(region, { name: "Fir Town", mapType: "town", width: size, height: size, seed, biome: "meadow" });
  map.params = params;
  return { region, map };
}

describe("Milestone 5 goal: towns generate valid maps over 100 seeds", () => {
  for (const townLayout of ["grid", "organic", "waterfront"])
    it(`${townLayout} towns`, () => {
      for (let seed = 1; seed <= 100; seed++) {
        const { map } = town(seed, { townLayout, gym: seed % 2 === 0 });
        const r = generateRoute(map);
        expect(r.ok, `seed ${seed}: ${r.issues.filter((i) => i.severity === "error").map((i) => i.code)}`).toBe(true);
      }
    }, 120_000);
});

describe("towns", () => {
  it("every door is on a building's bottom edge, with walkable ground in front and a warp to its interior", () => {
    for (let seed = 1; seed <= 10; seed++) {
      const { map } = town(seed, { gym: true, houses: 2 });
      const r = generateRoute(map);
      expect(r.warps.length).toBeGreaterThanOrEqual(3);
      for (const w of r.warps) {
        expect(w.kind).toBe("door");
        expect(w.locked).toBeFalsy();
        expect(r.terrain[w.y * 30 + w.x]).toBe(T.building);
        expect(IS_WALKABLE[r.terrain[(w.y + 1) * 30 + w.x]]).toBe(true);
        expect(w.destMap).toMatch(/^MAP_FIR_TOWN_(POKEMON_CENTER_1F|MART|GYM|LANDMARK|HOUSE\d+)$/);
      }
      expect(r.issues.some((i) => i.code === "door-placement" || i.code === "unreachable-warp")).toBe(false);
    }
  });

  it("buildings have their footprints, and the Center gets a heal location in front of its door", () => {
    const { map } = town(3);
    const r = generateRoute(map);
    const center = r.warps.find((w) => w.destMap.endsWith("_POKEMON_CENTER_1F"))!;
    const heal = r.entities.find((e) => e.kind === "heal_location")!;
    expect([heal.x, heal.y]).toEqual([center.x, center.y + 1]);
    expect(heal.fields.id).toBe("HEAL_LOCATION_FIR_TOWN");
    // The Center's footprint: count its building cells along the door's row.
    let w = 0;
    for (let x = 0; x < 30; x++) if (r.terrain[center.y * 30 + x] === T.building && Math.abs(x - center.x) <= 3) w++;
    expect(w).toBeGreaterThanOrEqual(BUILDING_TYPES.center.width);
  });

  it("edge grass is never needed to reach an exit or a door", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const { map } = town(seed, { edgeGrass: 1 });
      const r = generateRoute(map);
      const terrain = r.terrain.slice();
      for (let i = 0; i < terrain.length; i++) if (terrain[i] === T.tallGrass) terrain[i] = T.tree;
      const starts = r.openings.filter((o) => o.kind === "walk").flatMap((o) => openingCells(o, 30, 30));
      const reach = new MoveGraph({ width: 30, height: 30, terrain, entities: r.entities }, new Set()).forward(starts);
      for (const o of r.openings) expect(openingCells(o, 30, 30).some((c) => reach[c]), `seed ${seed}`).toBe(true);
      for (const w of r.warps) expect(reach[(w.y + 1) * 30 + w.x], `seed ${seed} door`).toBe(1);
    }
  });

  it("says when buildings don't fit", () => {
    const { map } = town(1, { houses: 12, gym: true, landmark: true }, 20);
    const r = generateRoute(map);
    expect(r.ok).toBe(true);
    expect(r.notes?.[0]).toMatch(/Only \d+ of the 16 buildings fit/);
  });

  it("keeps warps placed by hand and makes its own doors again each time", () => {
    const { map } = town(5);
    const mine = { ...newWarp(map, 4, 4), kind: "cave_mouth" as const, destMap: "MAP_SECRET_CAVE" };
    map.warps.push(mine);
    applyResult(map, generateRoute(map));
    expect(map.warps.filter((w) => w.locked)).toEqual([mine]);
    map.seed = 6;
    applyResult(map, generateRoute(map));
    expect(map.warps.filter((w) => w.locked)).toEqual([mine]);
    expect(map.warps.filter((w) => !w.locked).length).toBeGreaterThan(0);
    expect(new Set(map.warps.map((w) => w.id)).size).toBe(map.warps.length);
  });

  it("the building lot stroke makes a building with its door at the bottom middle", () => {
    const { map } = town(1);
    const points = [5, 5, 9, 8];
    expect(buildingLot(map, points)).toEqual({ x: 5, y: 5, w: 5, h: 4, doorX: 7, doorY: 8 });
    applySmartStroke(map, { type: "smart", kind: "building", width: 1, direction: null, points }, emptyDiff(), new Map());
    expect(map.layers.terrain.data[5 * 30 + 5]).toBe(T.building);
    expect(map.layers.terrain.data[8 * 30 + 9]).toBe(T.building);
    expect(map.layers.locks.data[8 * 30 + 7]).toBe(1);
    expect(IS_WALKABLE[map.layers.terrain.data[9 * 30 + 7]]).toBe(true);
    map.warps.push({ ...newWarp(map, 7, 8) });
    expect(map.warps[0].kind).toBe("door");
    expect(validateMap(map).some((i) => i.code === "door-placement")).toBe(false);
  });

  it("a door that isn't on a building, or has a wall in front, is an error", () => {
    const { map } = town(1);
    map.layers.terrain.data.fill(T.ground);
    map.warps.push({ ...newWarp(map, 3, 3), kind: "door" });
    expect(validateMap(map).filter((i) => i.code === "door-placement")).toHaveLength(1);
    map.layers.terrain.data[3 * 30 + 3] = T.building;
    map.layers.terrain.data[4 * 30 + 3] = T.tree;
    expect(validateMap(map).find((i) => i.code === "door-placement")?.message).toMatch(/in front/);
  });

  it("warps in older files count as placed by hand (file format 9)", () => {
    const { region, map } = town(1);
    map.warps.push({ ...newWarp(map, 3, 3), destMap: "MAP_X" });
    const file = JSON.parse(serializeProject(region, "test"));
    file.schemaVersion = 8;
    delete file.region.maps[0].warps[0].locked;
    expect(CURRENT_SCHEMA_VERSION).toBe(9);
    expect(parseProject(JSON.stringify(file)).maps[0].warps[0].locked).toBe(true);
  });
});
