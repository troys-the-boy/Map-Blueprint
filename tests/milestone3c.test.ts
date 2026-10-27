// Milestone 3, part C: zones.

import { describe, expect, it } from "vitest";
import { generateRoute } from "../src/core/generate";
import { IS_WALKABLE, T } from "../src/core/grid";
import type { MapBlueprint, Zone } from "../src/core/model";
import { addNewMap, newRegion } from "../src/core/model";
import { parseProject, serializeProject } from "../src/core/project";
import { edgeBand, newZone, zoneLabel } from "../src/core/zones";

function blank(w = 40, h = 60, seed = 1) {
  const region = newRegion("r", 1);
  return { region, map: addNewMap(region, { name: "Route 7", mapType: "route", width: w, height: h, seed, biome: "meadow" }) };
}

/** Add a zone covering the given cells. */
function zone(map: MapBlueprint, kind: Zone["kind"], data: Zone["data"], cells: number[], hard = false): Zone {
  const z = newZone(map, kind as never, data);
  z.hard = hard;
  for (const i of cells) z.mask.data[i] = 1;
  map.layers.zones.push(z);
  return z;
}

const rect = (map: MapBlueprint, x0: number, y0: number, x1: number, y1: number) => {
  const out: number[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push(y * map.width + x);
  return out;
};

describe("zones", () => {
  it("edge bands cover the right cells", () => {
    const { map } = blank(10, 8);
    expect(edgeBand(map, "east", 2, 4, 3).sort((a, b) => a - b)).toEqual([27, 28, 29, 37, 38, 39, 47, 48, 49]);
    expect(edgeBand(map, "north", 0, 9, 1)).toHaveLength(10);
  });

  it("get readable names", () => {
    const { map } = blank();
    expect(zoneLabel(newZone(map, "water", { water: "ocean", depth: "shallow" }))).toBe("Ocean (shallow)");
    expect(zoneLabel(newZone(map, "edge", { boundary: "cliff" }))).toBe("Cliff edge");
    expect(zoneLabel(newZone(map, "biome", { biome: "alpine" }))).toBe("Alpine");
  });

  it("a hard lake zone is water exactly where painted, and the route goes round it", () => {
    const { map } = blank();
    const lake = rect(map, 6, 20, 16, 30);
    zone(map, "water", { water: "lake", depth: "deep" }, lake, true);
    const r = generateRoute(map);
    expect(r.ok).toBe(true);
    for (const i of lake) expect(r.terrain[i]).toBe(T.waterDeep);
  });

  it("a river zone across the route is crossed on a bridge", () => {
    const { map } = blank();
    zone(map, "water", { water: "river", depth: "deep" }, rect(map, 0, 28, 39, 30), true);
    const r = generateRoute(map);
    expect(r.ok).toBe(true);
    expect(Array.from(r.terrain).some((t) => t === T.bridge)).toBe(true);
  });

  it("keep-clear ground stays walkable, with no trees or water", () => {
    const { map } = blank();
    const clear = rect(map, 8, 12, 14, 18);
    zone(map, "keep_clear", {}, clear, true);
    const r = generateRoute(map);
    for (const i of clear) expect(IS_WALKABLE[r.terrain[i]]).toBe(true);
  });

  it("a thin soft zone keeps its shape (it only wobbles outward much)", () => {
    const { map } = blank();
    const strip = rect(map, 6, 14, 30, 16);
    const z = zone(map, "keep_clear", {}, strip);
    z.fuzziness = 1;
    const r = generateRoute(map);
    const walkable = strip.filter((i) => IS_WALKABLE[r.terrain[i]]).length;
    expect(walkable / strip.length).toBeGreaterThan(0.9);
  });

  it("a cliff edge is rock along that edge", () => {
    const { map } = blank();
    const band = edgeBand(map, "west", 10, 50, 4);
    zone(map, "edge", { boundary: "cliff" }, band, true);
    const r = generateRoute(map);
    expect(r.ok).toBe(true);
    for (const i of band) expect(r.terrain[i]).toBe(T.rockWall);
  });

  it("marsh is shallow pools, long grass and mud", () => {
    const { map } = blank();
    const marsh = rect(map, 4, 10, 18, 24);
    zone(map, "water", { water: "marsh" }, marsh, true);
    const r = generateRoute(map);
    const kinds = new Set(marsh.map((i) => r.terrain[i]));
    expect(kinds.has(T.waterShallow)).toBe(true);
    expect(kinds.has(T.longGrass)).toBe(true);
  });

  it("soft zones wobble at the edges but keep their middle", () => {
    const { map } = blank();
    const lake = rect(map, 4, 20, 18, 34);
    const z = zone(map, "water", { water: "lake", depth: "deep" }, lake);
    z.fuzziness = 1;
    const r = generateRoute(map);
    // The middle is always water; some cells near the edge differ from the painted shape.
    for (const i of rect(map, 10, 26, 12, 28)) expect(r.terrain[i]).toBe(T.waterDeep);
    const edgeCells = [...rect(map, 4, 20, 18, 20), ...rect(map, 4, 34, 18, 34), ...rect(map, 4, 19, 18, 19), ...rect(map, 4, 35, 18, 35)];
    const water = edgeCells.filter((i) => r.terrain[i] === T.waterDeep).length;
    expect(water).toBeGreaterThan(0);
    expect(water).toBeLessThan(edgeCells.length);
  });

  it("zones are saved and opened with the map", () => {
    const { region, map } = blank(12, 12);
    zone(map, "edge", { boundary: "coast" }, edgeBand(map, "east", 0, 11, 3));
    const loaded = parseProject(serializeProject(region, "test")).maps[0].layers.zones[0];
    expect(loaded.kind).toBe("edge");
    expect(loaded.data.boundary).toBe("coast");
    expect(Array.from(loaded.mask.data)).toEqual(Array.from(map.layers.zones[0].mask.data));
  });
});

describe("Milestone 3 goal: an ocean edge on the east and a wetland in the south", () => {
  it("are followed by the generated map across 20 seeds", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const { map } = blank(40, 60, seed);
      zone(map, "edge", { boundary: "coast" }, edgeBand(map, "east", 0, 59, 10));
      zone(map, "biome", { biome: "wetland" }, rect(map, 0, 40, 39, 59));
      const r = generateRoute(map);
      expect(r.ok, `seed ${seed}: ${r.issues.filter((i) => i.severity === "error").map((i) => i.code)}`).toBe(true);
      // The east edge is sea: the outer 6 columns (well inside the soft edge) are deep water away from the entrances.
      let sea = 0;
      let total = 0;
      for (let y = 6; y < 54; y++)
        for (let x = 34; x < 40; x++) {
          total++;
          if (r.terrain[y * 40 + x] === T.waterDeep) sea++;
        }
      expect(sea / total, `seed ${seed} sea`).toBeGreaterThan(0.95);
      // Wetland in the south: its grass is long grass, while the meadow north of it has tall grass.
      const count = (t: number, y0: number, y1: number) => {
        let n = 0;
        for (let y = y0; y <= y1; y++) for (let x = 0; x < 40; x++) if (r.terrain[y * 40 + x] === t) n++;
        return n;
      };
      expect(count(T.tallGrass, 46, 59), `seed ${seed} wetland has no tall grass`).toBe(0);
      expect(count(T.longGrass, 46, 59) + count(T.mud, 46, 59), `seed ${seed} wetland has long grass or mud`).toBeGreaterThan(0);
      expect(count(T.longGrass, 0, 33), `seed ${seed} meadow has no long grass`).toBe(0);
    }
  });
});
