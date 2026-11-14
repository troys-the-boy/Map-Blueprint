// Land and settlements, part D: maps take their land from the region sketch. The
// sketch's heights become raised-ground zones, and the hills follow them.

import { describe, expect, it } from "vitest";
import { buildRegion, landUnder } from "../src/core/buildRegion";
import { generateRoute } from "../src/core/generate";
import { T } from "../src/core/grid";
import { addNewMap, newRegion } from "../src/core/model";
import type { MapBlueprint, MapType, Region } from "../src/core/model";
import { parseProject, serializeProject } from "../src/core/project";
import { MoveGraph, openingCells } from "../src/core/reach";
import { paintHeights } from "../src/core/regionTerrain";
import { SKETCH_AREAS, addOutdoor, newSketch, sketchCols } from "../src/core/sketch";
import { ELEVATION_LEVELS } from "../src/core/terrain";
import { heightLevel, newZone, zoneLabel } from "../src/core/zones";

const RAISED = (level: number) => ELEVATION_LEVELS[level].startsWith("raised");

function map(type: MapType, w: number, h: number, seed: number): MapBlueprint {
  return addNewMap(newRegion("r", 1), { name: "Place", mapType: type, width: w, height: h, seed, biome: "temperate_rainforest" });
}

function zone(m: MapBlueprint, level: number, test: (x: number, y: number) => boolean, hard = false) {
  const z = newZone(m, "height", { level });
  z.hard = hard;
  for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width; x++) if (test(x, y)) z.mask.data[y * m.width + x] = 1;
  m.layers.zones.push(z);
  return z;
}

/** Can the player walk between every pair of entrances? */
function entrancesJoined(m: MapBlueprint, res: ReturnType<typeof generateRoute>): boolean {
  const ends = res.openings.filter((o) => o.kind === "walk").map((o) => openingCells(o, m.width, m.height));
  const reach = new MoveGraph({ width: m.width, height: m.height, terrain: res.terrain, entities: res.entities, elevation: res.elevation }, new Set()).forward(ends[0]);
  return ends.every((cells) => cells.some((c) => reach[c]));
}

describe("raised-ground zones", () => {
  it("a new one is one level up, and names itself", () => {
    const m = map("route", 30, 60, 1);
    const z = newZone(m, "height");
    expect([z.kind, z.data.level, z.name, heightLevel(z)]).toEqual(["height", 1, "Raised ground (1 up)", 1]);
    z.data.level = 9;
    expect(heightLevel(z)).toBe(4);
    expect(zoneLabel({ ...z, data: { level: 2 } })).toBe("Raised ground (2 up)");
  });

  it("the hills are where the zone says, and nowhere else", () => {
    for (let seed = 1; seed <= 6; seed++) {
      const m = map("route", 40, 60, seed);
      zone(m, 1, (x) => x >= 22, true);
      const res = generateRoute(m);
      expect(res.ok, `seed ${seed}`).toBe(true);
      let inZone = 0;
      let up = 0;
      for (let y = 0; y < 60; y++)
        for (let x = 0; x < 40; x++) {
          const raised = RAISED(res.elevation[y * 40 + x]);
          // Nothing is raised outside the zone.
          if (x < 22) expect(raised, `seed ${seed} (${x}, ${y})`).toBe(false);
          else if (x < 38 && y >= 12 && y < 48) (inZone++, raised && up++);
        }
      // Away from the entrances and the border, the zone is raised.
      expect(up / inZone).toBeGreaterThan(0.85);
      // It has cliffs and a way up.
      expect(Array.from(res.terrain).filter((t) => t === T.stairs).length).toBeGreaterThanOrEqual(1);
    }
  });

  it("works with the Elevation setting at 0, and replaces it when it isn't", () => {
    const flat = map("route", 40, 60, 2);
    flat.params = { elevation: 0 };
    expect(Array.from(generateRoute(flat).elevation).some(RAISED)).toBe(false);
    zone(flat, 1, (x, y) => x >= 24 && y >= 15 && y < 45, true);
    expect(Array.from(generateRoute(flat).elevation).some(RAISED)).toBe(true);
    // With Elevation up, the hills are still only where the zone is.
    const hilly = map("route", 40, 60, 2);
    hilly.params = { elevation: 0.9 };
    zone(hilly, 1, (x, y) => x >= 24 && y >= 15 && y < 45, true);
    const res = generateRoute(hilly);
    for (let y = 0; y < 60; y++) for (let x = 0; x < 22; x++) expect(RAISED(res.elevation[y * 40 + x])).toBe(false);
  });

  it("levels nest: two up has a step one up round it", () => {
    const m = map("route", 50, 60, 3);
    zone(m, 1, (x) => x >= 20, true);
    zone(m, 2, (x) => x >= 34, true);
    const res = generateRoute(m);
    expect(res.ok).toBe(true);
    const names = new Set(Array.from(res.elevation).map((e) => ELEVATION_LEVELS[e]));
    expect(names.has("raised1")).toBe(true);
    expect(names.has("raised2")).toBe(true);
    for (let y = 0; y < 60; y++) for (let x = 0; x < 33; x++) expect(ELEVATION_LEVELS[res.elevation[y * 50 + x]]).not.toBe("raised2");
  });

  it("a hill right across the map still lets the player through, by stairs", () => {
    const cases: Array<[MapType, number, number, (m: MapBlueprint) => void]> = [
      ["route", 30, 60, (m) => zone(m, 1, (_x, y) => y < 30)],
      ["route", 40, 90, (m) => (zone(m, 1, (_x, y) => y < 60), zone(m, 2, (_x, y) => y < 30))],
      ["town", 40, 40, (m) => zone(m, 1, (_x, y) => y < 20)],
    ];
    for (const [type, w, h, setup] of cases)
      for (let seed = 1; seed <= 8; seed++) {
        const m = map(type, w, h, seed);
        setup(m);
        const res = generateRoute(m);
        expect(res.ok, `${type} ${w}×${h} seed ${seed}: ${res.issues.filter((i) => i.severity === "error").map((i) => i.message)}`).toBe(true);
        expect(entrancesJoined(m, res), `${type} seed ${seed}`).toBe(true);
        // The entrances themselves are on low ground, so they match the next map.
        for (const o of res.openings) for (const c of openingCells(o, w, h)) expect(ELEVATION_LEVELS[res.elevation[c]]).toBe("ground");
      }
  });

  it("a town builds on its raised ground too", () => {
    let high = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const m = map("town", 40, 40, seed);
      m.params = { houses: 6 };
      zone(m, 1, (_x, y) => y < 20);
      const res = generateRoute(m);
      expect(res.ok, `seed ${seed}`).toBe(true);
      high += res.warps.filter((w) => w.kind === "door" && RAISED(res.elevation[w.y * 40 + w.x])).length;
    }
    expect(high).toBeGreaterThanOrEqual(6);
  });

  it("is saved with the map, and gives the same hills again", () => {
    const r = newRegion("r", 1);
    const m = addNewMap(r, { name: "Route 1", mapType: "route", width: 40, height: 60, seed: 4 });
    zone(m, 2, (x) => x >= 22);
    const back = parseProject(serializeProject(r, "test")).maps[0];
    expect(back.layers.zones[0]).toMatchObject({ kind: "height", data: { level: 2 } });
    expect(Array.from(generateRoute(back).elevation)).toEqual(Array.from(generateRoute(m).elevation));
  });
});

describe("building maps from the sketch's heights", () => {
  /** A region whose sketch has hills east of x = 100, and highland east of x = 200. */
  function hillRegion(): Region {
    const r = newRegion("r", 7);
    const s = (r.sketch = newSketch(300, 200));
    const cols = sketchCols(s);
    for (let i = 0; i < s.heights.length; i++) s.heights[i] = i % cols >= 40 ? 2 : i % cols >= 20 ? 1 : 0;
    return r;
  }
  const heightZones = (m: MapBlueprint) => m.layers.zones.filter((z) => z.kind === "height");

  it("knows the land under a rectangle", () => {
    const s = hillRegion().sketch!;
    expect(landUnder(s, { x: 50, y: 0, w: 100, h: 30 })).toEqual({ low: 0, high: 1, main: 0 });
    expect(landUnder(s, { x: 110, y: 0, w: 60, h: 30 })).toEqual({ low: 1, high: 1, main: 1 });
    expect(landUnder(s, { x: 150, y: 0, w: 100, h: 30 })).toEqual({ low: 1, high: 2, main: 1 });
    // All sea: no land.
    s.areas.fill(1 + SKETCH_AREAS.indexOf("sea"));
    expect(landUnder(s, { x: 0, y: 0, w: 50, h: 50 })).toBeNull();
  });

  it("land higher than the map's lowest becomes raised ground, where the sketch has it", () => {
    const r = hillRegion();
    // A route lying across the edge of the hills: its west 40 are lowland, its east 40 hills.
    addOutdoor(r.sketch!, "route", { x: 60, y: 50, w: 80, h: 30 });
    const report = buildRegion(r);
    expect(report.blocked).toEqual([]);
    const m = r.maps[0];
    const zones = heightZones(m);
    expect(zones).toHaveLength(1);
    expect(zones[0]).toMatchObject({ hard: false, data: { level: 1, fromSketch: true } });
    for (let y = 0; y < 30; y++) for (let x = 0; x < 80; x++) expect(zones[0].mask.data[y * 80 + x], `(${x}, ${y})`).toBe(x >= 40 ? 1 : 0);
    expect(report.needsGenerate).toContain(m.id);
    // And the generated map has its hills on that side.
    const res = generateRoute(m);
    expect(res.ok).toBe(true);
    let west = 0;
    let east = 0;
    for (let y = 0; y < 30; y++) for (let x = 0; x < 80; x++) if (RAISED(res.elevation[y * 80 + x])) x < 34 ? west++ : east++;
    expect(west).toBe(0);
    expect(east).toBeGreaterThan(200);
  });

  it("a map all on one band is flat as far as the sketch goes; two bands above nest", () => {
    const r = hillRegion();
    addOutdoor(r.sketch!, "town", { x: 120, y: 20, w: 40, h: 40 }); // all hills
    addOutdoor(r.sketch!, "route", { x: 60, y: 100, w: 180, h: 30 }); // lowland, hills, highland (as two segments of 90)
    buildRegion(r);
    const [town, west, east] = r.maps;
    expect(heightZones(town)).toEqual([]);
    // The west segment (x 60 to 150): lowland then hills. The east (150 to 240): hills then highland.
    expect(heightZones(west).map((z) => z.data.level)).toEqual([1]);
    expect(heightZones(east).map((z) => z.data.level)).toEqual([1]);
    // East's lowest land is hills, so its highland is one up, starting at x = 200 (50 in).
    expect(heightZones(east)[0].mask.data[10 * 90 + 49]).toBe(0);
    expect(heightZones(east)[0].mask.data[10 * 90 + 50]).toBe(1);
    // A place across all three bands: two zones, the higher inside the lower.
    const r2 = hillRegion();
    addOutdoor(r2.sketch!, "town", { x: 80, y: 20, w: 140, h: 40 });
    buildRegion(r2);
    const z = heightZones(r2.maps[0]);
    expect(z.map((k) => k.data.level)).toEqual([1, 2]);
    for (let i = 0; i < z[1].mask.data.length; i++) if (z[1].mask.data[i]) expect(z[0].mask.data[i]).toBe(1);
  });

  it("neighbouring maps see the same land along their shared edge", () => {
    const r = hillRegion();
    // Two towns side by side, north and south, both across the edge of the hills.
    addOutdoor(r.sketch!, "town", { x: 70, y: 20, w: 60, h: 40 });
    addOutdoor(r.sketch!, "town", { x: 70, y: 60, w: 60, h: 40 });
    buildRegion(r);
    const [north, south] = r.maps;
    const a = heightZones(north)[0].mask.data;
    const b = heightZones(south)[0].mask.data;
    for (let x = 0; x < 60; x++) expect(a[39 * 60 + x], `x ${x}`).toBe(b[x]);
    // And their shared entrance is on low ground on both, so the player can cross.
    for (const m of [north, south]) {
      const res = generateRoute(m);
      expect(res.ok).toBe(true);
      for (const o of res.openings) for (const c of openingCells(o, m.width, m.height)) expect(ELEVATION_LEVELS[res.elevation[c]]).toBe("ground");
    }
  });

  it("a new map starts with a look that suits its land; Build never changes it afterwards", () => {
    const r = hillRegion();
    const s = r.sketch!;
    addOutdoor(s, "route", { x: 20, y: 20, w: 30, h: 80 }); // lowland
    addOutdoor(s, "route", { x: 120, y: 20, w: 30, h: 80 }); // hills
    addOutdoor(s, "town", { x: 220, y: 20, w: 40, h: 40 }); // highland
    buildRegion(r);
    const [low, hills, high] = r.maps;
    expect(low.params.elevation).toBeUndefined();
    expect(low.biome).toBe(r.settings.defaultBiome);
    expect(hills.params.elevation).toBe(0.5);
    expect(hills.biome).toBe(r.settings.defaultBiome);
    expect(high.params.elevation).toBe(0.6);
    expect(high.biome).toBe("alpine");
    // The user's own choices stay through another Build.
    high.biome = "meadow";
    high.params = { ...high.params, elevation: 0.1 };
    buildRegion(r);
    expect([high.biome, high.params.elevation]).toEqual(["meadow", 0.1]);
  });

  it("a painted biome wins over the land's suggestion", () => {
    const r = hillRegion();
    const s = r.sketch!;
    const cols = sketchCols(s);
    const meadow = 1 + SKETCH_AREAS.indexOf("meadow");
    for (let y = 4; y < 12; y++) for (let x = 44; x < 52; x++) s.areas[y * cols + x] = meadow;
    addOutdoor(s, "town", { x: 220, y: 20, w: 40, h: 40 });
    buildRegion(r);
    expect(r.maps[0].biome).toBe("meadow");
  });

  it("changing the heights and building again updates the zones, and keeps your own", () => {
    const r = hillRegion();
    addOutdoor(r.sketch!, "route", { x: 60, y: 50, w: 80, h: 30 });
    buildRegion(r);
    const m = r.maps[0];
    const mine = newZone(m, "height", { level: 1 });
    mine.mask.data[0] = 1;
    m.layers.zones.push(mine);
    // Nothing changed on the sketch: nothing to generate again.
    expect(buildRegion(r).needsGenerate).toEqual([]);
    // Flatten the hills under the route: its sketch zone goes, the user's stays.
    for (let y = 40; y <= 85; y += 5) for (let x = 60; x < 140; x += 5) paintHeights(r.sketch!, x, y, 1, 0);
    const report = buildRegion(r);
    expect(report.needsGenerate).toEqual([m.id]);
    expect(heightZones(m)).toEqual([mine]);
  });
});
