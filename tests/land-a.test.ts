// Land and settlements, part A: how a map's land is generated is separate from what the
// place is, and buildings can be fitted into any land.

import { describe, expect, it } from "vitest";
import { applyResult, generateRoute } from "../src/core/generate";
import { readTownParams } from "../src/core/generators/townParams";
import { T } from "../src/core/grid";
import { addNewMap, newRegion, styleOf } from "../src/core/model";
import type { LandStyle, MapType, Opening, Settlement } from "../src/core/model";
import { CURRENT_SCHEMA_VERSION, migrate, parseProject, serializeProject } from "../src/core/project";

function make(mapType: MapType, style: LandStyle, settlement: Settlement, seed: number, w = 40, h = 40) {
  const r = newRegion("r", 1);
  const m = addNewMap(r, { name: "Place", mapType, width: w, height: h, seed, biome: "temperate_rainforest" });
  m.style = style;
  m.settlement = settlement;
  return { r, m };
}

const count = (data: Uint8Array, t: number) => data.reduce((n, v) => n + (v === t ? 1 : 0), 0);

describe("land style", () => {
  it("a new map is generated as what it is; only a town has a settlement", () => {
    const r = newRegion("r", 1);
    const town = addNewMap(r, { name: "Town", mapType: "town", width: 30, height: 30, seed: 1 });
    const route = addNewMap(r, { name: "Route 1", mapType: "route", width: 30, height: 60, seed: 1 });
    expect([town.style, town.settlement]).toEqual(["town", "town"]);
    expect([route.style, route.settlement]).toEqual(["route", "none"]);
  });

  it("a town generated as a forest is still a town, with dense forest and its buildings", () => {
    const { m } = make("town", "forest", "village", 3);
    const before = { ...m.header };
    const res = generateRoute(m);
    expect(res.ok).toBe(true);
    applyResult(m, res);
    expect(m.mapType).toBe("town");
    expect(m.header).toEqual(before);
    expect(m.header.map_type).toBe("MAP_TYPE_TOWN");
    expect(count(res.terrain, T.denseForest)).toBeGreaterThan(100);
    expect(res.warps.filter((w) => w.kind === "door").length).toBe(4); // a Center and three houses
    expect(res.entities.some((e) => e.kind === "heal_location")).toBe(true);
  });

  it("a cave place is always a cave", () => {
    const { m } = make("cave", "forest", "none", 1);
    expect(styleOf(m)).toBe("cave");
    const res = generateRoute(m);
    expect(count(res.terrain, T.caveFloor)).toBeGreaterThan(50);
    expect(count(res.terrain, T.denseForest)).toBe(0);
  });

  it("a route generated as a cave is entered through its edges, with one floor", () => {
    for (let seed = 1; seed <= 6; seed++) {
      const { m } = make("route", "cave", "none", seed, 30, 50);
      m.params = { floors: 3 };
      const openings: Opening[] = [
        { id: "o1", edge: "south", start: 14, width: 3, kind: "walk" },
        { id: "o2", edge: "north", start: 14, width: 3, kind: "walk" },
      ];
      m.openings = openings;
      const res = generateRoute(m);
      expect(res.ok, `seed ${seed}: ${res.issues.filter((i) => i.severity === "error").map((i) => i.code)}`).toBe(true);
      // The gaps in the rock are cave floor, and there are no cave mouths or ladders.
      expect(res.terrain[49 * 30 + 15]).toBe(T.caveFloor);
      expect(res.terrain[15]).toBe(T.caveFloor);
      expect(res.warps).toEqual([]);
      applyResult(m, res);
      expect(m.layout.borderBlock[0]).toBe("rock_wall");
    }
  });

  it("the same seed and settings give the same map", () => {
    const a = generateRoute(make("town", "forest", "town", 9).m);
    const b = generateRoute(make("town", "forest", "town", 9).m);
    expect(Array.from(a.terrain)).toEqual(Array.from(b.terrain));
    expect(a.warps).toEqual(b.warps);
  });
});

describe("settlements in any land", () => {
  const cases: Array<[MapType, LandStyle, Settlement, number, number, number]> = [
    ["route", "route", "hamlet", 30, 60, 2],
    ["route", "forest", "hamlet", 30, 60, 2],
    ["town", "forest", "village", 40, 40, 4],
    ["town", "cave", "village", 40, 40, 4],
    ["town", "route", "town", 40, 40, 5],
  ];
  for (const [mapType, style, settlement, w, h, wanted] of cases)
    it(`${mapType} as ${style} with a ${settlement}: every door reached, nothing broken`, () => {
      let built = 0;
      for (let seed = 1; seed <= 8; seed++) {
        const { m } = make(mapType, style, settlement, seed, w, h);
        if (style === "cave")
          m.openings = [
            { id: "o1", edge: "south", start: Math.floor(w / 2) - 1, width: 3, kind: "walk" },
            { id: "o2", edge: "north", start: Math.floor(w / 2) - 1, width: 3, kind: "walk" },
          ];
        const res = generateRoute(m);
        // No errors: every door is on a building with ground in front, and can be reached.
        expect(res.ok, `seed ${seed}: ${res.issues.filter((i) => i.severity === "error").map((i) => i.message)}`).toBe(true);
        const doors = res.warps.filter((x) => x.kind === "door");
        built += doors.length;
        for (const d of doors) {
          expect(res.terrain[d.y * w + d.x]).toBe(T.building);
          expect(d.destMap).toMatch(/^MAP_PLACE_/);
        }
        expect(res.issues.some((i) => i.code === "narrow-path")).toBe(false);
      }
      // Nearly all the buildings asked for fit (a cave has less room: they stand in the rock beside the floor).
      expect(built).toBeGreaterThanOrEqual(wanted * 8 - (style === "cave" ? 6 : 3));
    });

  it("no settlement means no buildings, even on town land", () => {
    const { m } = make("town", "town", "none", 4);
    m.params = { houses: 6, center: true };
    const res = generateRoute(m);
    expect(res.ok).toBe(true);
    expect(count(res.terrain, T.building)).toBe(0);
    expect(res.warps).toEqual([]);
    // The streets are still there.
    expect(count(res.terrain, T.road)).toBeGreaterThan(20);
  });

  it("buildings never replace locked cells, paths or water", () => {
    const { m } = make("route", "route", "village", 5, 40, 40);
    const plain = generateRoute({ ...m, settlement: "none" });
    const res = generateRoute(m);
    expect(res.ok).toBe(true);
    for (let i = 0; i < res.terrain.length; i++) {
      if (res.terrain[i] !== T.building) continue;
      // What was there without the settlement: trees or open ground, never path, water or a ledge.
      expect([T.path, T.waterDeep, T.waterShallow, T.bridge, T.stairs]).not.toContain(plain.terrain[i]);
    }
  });

  it("each size starts with its own buildings, which can be changed", () => {
    expect(readTownParams({}, "hamlet")).toMatchObject({ center: false, mart: false, houses: 2 });
    expect(readTownParams({}, "village")).toMatchObject({ center: true, mart: false, houses: 3 });
    expect(readTownParams({}, "town")).toMatchObject({ center: true, mart: true, houses: 3 });
    expect(readTownParams({ houses: 5 }, "hamlet").houses).toBe(5);
    expect(readTownParams({ houses: 5, gym: true }, "none")).toMatchObject({ houses: 0, gym: false });
  });
});

describe("project format 16", () => {
  it("saves the land style and settlement", () => {
    const { r, m } = make("town", "forest", "village", 1);
    expect(CURRENT_SCHEMA_VERSION).toBeGreaterThanOrEqual(16);
    const back = parseProject(serializeProject(r, "test"));
    expect([back.maps[0].mapType, back.maps[0].style, back.maps[0].settlement]).toEqual(["town", "forest", "village"]);
    expect(m.style).toBe("forest");
  });

  it("older maps are generated as what they are, and only towns have buildings", () => {
    const r = newRegion("r", 1);
    addNewMap(r, { name: "Town", mapType: "town", width: 30, height: 30, seed: 1 });
    addNewMap(r, { name: "Woods", mapType: "forest", width: 30, height: 30, seed: 1 });
    addNewMap(r, { name: "House", mapType: "interior_stub", width: 10, height: 8, seed: 1 });
    const file = JSON.parse(serializeProject(r, "test"));
    file.schemaVersion = 15;
    for (const m of file.region.maps) {
      delete m.style;
      delete m.settlement;
    }
    const up = migrate(file) as { region: { maps: Array<{ style: string; settlement: string }> } };
    expect(up.region.maps.map((m) => [m.style, m.settlement])).toEqual([
      ["town", "town"],
      ["forest", "none"],
      ["route", "none"],
    ]);
    // And they generate exactly as before: a town from an old file matches a new town.
    const old = parseProject(JSON.stringify(file)).maps[0];
    const fresh = addNewMap(newRegion("r", 1), { name: "Town", mapType: "town", width: 30, height: 30, seed: 1 });
    expect(Array.from(generateRoute(old).terrain)).toEqual(Array.from(generateRoute(fresh).terrain));
  });

  it("rejects a land style that doesn't exist", () => {
    const { r } = make("town", "town", "town", 1);
    const file = JSON.parse(serializeProject(r, "test"));
    file.region.maps[0].style = "city";
    expect(() => parseProject(JSON.stringify(file))).toThrow(/style/);
  });
});
