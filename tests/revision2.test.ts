// Second revision: Porymap-style elevation, the elevation brush, 4 raised levels,
// snow and ice, and mountainous alpine routes.

import { describe, expect, it } from "vitest";
import { unzipSync } from "fflate";
import { generateRoute } from "../src/core/generate";
import { T } from "../src/core/grid";
import { addNewMap, newRegion } from "../src/core/model";
import { applyDiff, emptyDiff, paintElevation, replayStroke } from "../src/core/paint";
import { CURRENT_SCHEMA_VERSION, parseProject, serializeProject } from "../src/core/project";
import { ELEVATION_VALUES, LEVEL_VALUE, cellElevationValue, isImpassable } from "../src/core/porymap";
import { MoveGraph } from "../src/core/reach";
import { ELEVATION_LEVELS } from "../src/core/terrain";
import { elevationPng, screenTilesZip } from "../src/core/exporters";

const lvl = (name: (typeof ELEVATION_LEVELS)[number]) => ELEVATION_LEVELS.indexOf(name);

describe("Porymap elevation values", () => {
  it("match pokeemerald's global.fieldmap.h and Porymap's usual raised levels", () => {
    expect(ELEVATION_VALUES.transition).toBe(0);
    expect(LEVEL_VALUE[lvl("water")]).toBe(1);
    expect(LEVEL_VALUE[lvl("ground")]).toBe(3);
    expect([lvl("raised1"), lvl("raised2"), lvl("raised3"), lvl("raised4")].map((l) => LEVEL_VALUE[l])).toEqual([4, 5, 6, 7]);
    expect(LEVEL_VALUE[lvl("bridge")]).toBe(15);
  });

  it("stairs show the transition value whatever level they sit on; walls are impassable", () => {
    expect(cellElevationValue(T.stairs, lvl("raised2"))).toBe(0);
    expect(cellElevationValue(T.path, lvl("raised2"))).toBe(5);
    expect(isImpassable(T.rockWall)).toBe(true);
    expect(isImpassable(T.ice)).toBe(false);
  });
});

describe("elevation brush", () => {
  const blank = () => addNewMap(newRegion("r", 1), { name: "m", mapType: "route", width: 8, height: 8, seed: 1 });

  it("paints elevation without touching terrain, and undo restores it", () => {
    const map = blank();
    const terrainBefore = Array.from(map.layers.terrain.data);
    const diff = emptyDiff();
    paintElevation(map, 2, 3, lvl("raised3"), 1, diff, new Map());
    expect(map.layers.elevation.data[3 * 8 + 2]).toBe(lvl("raised3"));
    expect(Array.from(map.layers.terrain.data)).toEqual(terrainBefore);
    applyDiff(map, diff, "before");
    expect(map.layers.elevation.data[3 * 8 + 2]).toBe(lvl("ground"));
  });

  it("is saved as an edit, survives save and open, and replays", () => {
    const region = newRegion("r", 1);
    const map = addNewMap(region, { name: "m", mapType: "route", width: 8, height: 8, seed: 1 });
    map.edits.push({ type: "elevation", level: "raised4", brush: 1, locked: true, cells: [1, 1, 2, 1] });
    const loaded = parseProject(serializeProject(region, "t"));
    expect(loaded.maps[0].edits).toEqual(map.edits);
    replayStroke(loaded.maps[0], loaded.maps[0].edits[0]);
    expect(loaded.maps[0].layers.elevation.data[1 * 8 + 2]).toBe(lvl("raised4"));
  });

  it("rejects an unknown elevation level in a file", () => {
    const region = newRegion("r", 1);
    const map = addNewMap(region, { name: "m", mapType: "route", width: 8, height: 8, seed: 1 });
    map.edits.push({ type: "elevation", level: "raised1", brush: 1, locked: true, cells: [1, 1] });
    const text = serializeProject(region, "t").replace('"level": "raised1"', '"level": "raised9"');
    expect(() => parseProject(text)).toThrow(/expected one of/);
  });
});

describe("file format 4", () => {
  it("opens a version-3 file unchanged", () => {
    const region = newRegion("r", 1);
    addNewMap(region, { name: "m", mapType: "route", width: 8, height: 8, seed: 1 });
    const f = JSON.parse(serializeProject(region, "t"));
    expect(f.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    f.schemaVersion = 3;
    expect(parseProject(JSON.stringify(f)).maps).toHaveLength(1);
  });
});

describe("movement", () => {
  /** A one-row corridor; returns the move graph. */
  const row = (cells: number[], levels?: number[]) =>
    new MoveGraph(
      { width: cells.length, height: 1, terrain: Uint8Array.from(cells), entities: [], elevation: levels ? Uint8Array.from(levels) : undefined },
      new Set(),
    );

  it("slides across ice until something stops you", () => {
    // ground, ice, ice, ice, rock: stepping east from cell 0 slides to cell 3.
    const g = row([T.ground, T.ice, T.ice, T.ice, T.rockWall]);
    expect(g.out[0 * 4 + 1]).toBe(3);
    // Slides off the ice onto ground and stops there.
    const h = row([T.ground, T.ice, T.ice, T.ground, T.ground]);
    expect(h.out[0 * 4 + 1]).toBe(3);
  });

  it("climbs stairs one level at a time, up to the fourth raised level", () => {
    const r3 = lvl("raised3");
    const r4 = lvl("raised4");
    const g = row([T.ground, T.stairs, T.ground], [r3, r4, r4]);
    expect(g.out[0 * 4 + 1]).toBe(1);
    expect(g.forward([0])[2]).toBe(1);
    // No stairs: a level apart is a cliff.
    const h = row([T.ground, T.ground], [r3, r4]);
    expect(h.out[0 * 4 + 1]).toBe(-1);
  });
});

describe("generator", () => {
  const route = (seed: number, biome: Parameters<typeof addNewMap>[1]["biome"], params: Record<string, number | string>, w = 40, h = 70) => {
    const map = addNewMap(newRegion("t", 1), { name: "Route 9", mapType: "route", width: w, height: h, seed, biome });
    map.params = params;
    return generateRoute(map);
  };

  it("alpine routes climb in terraces of several levels, with cliff borders", () => {
    let highest = 0;
    for (const seed of [1, 2, 3, 4]) {
      const r = route(seed, "alpine", { elevation: 1, layout: "land" });
      expect(r.ok).toBe(true);
      for (const e of r.elevation) highest = Math.max(highest, [lvl("raised1"), lvl("raised2"), lvl("raised3"), lvl("raised4")].indexOf(e) + 1);
      expect(r.terrain[0]).toBe(T.rockWall);
    }
    expect(highest).toBeGreaterThanOrEqual(3);
  });

  it("every thing stands at the elevation of its cell", () => {
    const r = route(5, "alpine", { elevation: 1, layout: "land" });
    for (const e of r.entities) expect(e.elevation).toBe(ELEVATION_LEVELS[r.elevation[e.y * 40 + e.x]]);
  });

  it("snow 100 snows the whole route in; snow 0 leaves no snow", () => {
    const snowy = route(6, "meadow", { snow: 1, water: 0.6 }, 30, 60);
    const ts = Array.from(snowy.terrain);
    expect(ts.includes(T.tallGrass) || ts.includes(T.longGrass)).toBe(false);
    expect(ts.includes(T.snowGrass)).toBe(true);
    expect(ts.includes(T.snow) || ts.includes(T.snowdrift)).toBe(true);
    expect(snowy.ok).toBe(true);
    const green = Array.from(route(6, "meadow", { snow: 0 }, 30, 60).terrain);
    expect([T.snow, T.snowGrass, T.ice, T.snowdrift].some((t) => green.includes(t))).toBe(false);
  });

  it("snow covers high ground first", () => {
    const r = route(8, "meadow", { snow: 0.35, elevation: 1 }, 40, 70);
    let high = 0;
    let highSnow = 0;
    let low = 0;
    let lowSnow = 0;
    r.terrain.forEach((t, i) => {
      if (t !== T.snow && t !== T.ground && t !== T.snowGrass && t !== T.tallGrass) return;
      const snow = t === T.snow || t === T.snowGrass;
      if (r.elevation[i] === lvl("ground")) {
        low++;
        if (snow) lowSnow++;
      } else if (r.elevation[i] !== lvl("water")) {
        high++;
        if (snow) highSnow++;
      }
    });
    expect(highSnow / Math.max(1, high)).toBeGreaterThan(lowSnow / Math.max(1, low));
  });
});

describe("exports", () => {
  const map = addNewMap(newRegion("t", 1), { name: "Route 9", mapType: "route", width: 20, height: 20, seed: 3 });
  const ctx = { paletteId: "pnw", regionName: "T", appVersion: "t" };

  it("writes an Elevation PNG", () => {
    const f = elevationPng.run(map, ctx);
    expect(f.name).toBe("Route-9-elevation.png");
    expect(Array.from((f.data as Uint8Array).slice(1, 4))).toEqual([0x50, 0x4e, 0x47]);
  });

  it("screen tiles include an elevation sheet for every screen", () => {
    const files = Object.keys(unzipSync(screenTilesZip.run(map, ctx).data as Uint8Array));
    const screens = files.filter((n) => /screens\/[A-Z]+\d+\.png$/.test(n)).length;
    expect(files.filter((n) => n.includes("/elevation/"))).toHaveLength(screens);
  });
});
