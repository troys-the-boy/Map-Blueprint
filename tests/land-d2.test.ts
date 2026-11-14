// Land and settlements, part D (entrances): an entrance can be up on raised ground,
// so a route can come in low at one end and leave high at the other.

import { describe, expect, it } from "vitest";
import { buildRegion } from "../src/core/buildRegion";
import { applyResult, generateRoute } from "../src/core/generate";
import { addNewMap, newRegion } from "../src/core/model";
import type { MapBlueprint, MapType, Opening } from "../src/core/model";
import { parseProject, serializeProject } from "../src/core/project";
import { MoveGraph, openingCells } from "../src/core/reach";
import { addOutdoor, newSketch, sketchCols } from "../src/core/sketch";
import { ELEVATION_LEVELS } from "../src/core/terrain";
import { cellElevationValue } from "../src/core/porymap";
import { newZone } from "../src/core/zones";

const name = (level: number) => ELEVATION_LEVELS[level];

function map(type: MapType, w: number, h: number, seed: number, openings: Opening[]): MapBlueprint {
  const m = addNewMap(newRegion("r", 1), { name: "Place", mapType: type, width: w, height: h, seed, biome: "temperate_rainforest" });
  m.openings = openings;
  return m;
}
function zone(m: MapBlueprint, level: number, test: (x: number, y: number) => boolean) {
  const z = newZone(m, "height", { level });
  for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width; x++) if (test(x, y)) z.mask.data[y * m.width + x] = 1;
  m.layers.zones.push(z);
}
const south = (w: number, extra: Partial<Opening> = {}): Opening => ({ id: "o1", edge: "south", start: Math.floor(w / 2) - 1, width: 3, kind: "walk", ...extra });
const north = (w: number, extra: Partial<Opening> = {}): Opening => ({ id: "o2", edge: "north", start: Math.floor(w / 2) - 1, width: 3, kind: "walk", ...extra });

function joined(m: MapBlueprint, res: ReturnType<typeof generateRoute>): boolean {
  const ends = res.openings.map((o) => openingCells(o, m.width, m.height));
  const reach = new MoveGraph({ width: m.width, height: m.height, terrain: res.terrain, entities: res.entities, elevation: res.elevation }, new Set()).forward(ends[0]);
  return ends.every((cells) => cells.some((c) => reach[c]));
}

describe("entrances above low ground", () => {
  it("a route over a pass: in low at the south, out high at the north", () => {
    for (let seed = 1; seed <= 10; seed++) {
      const m = map("route", 30, 60, seed, [south(30), north(30, { level: 1 })]);
      zone(m, 1, (_x, y) => y < 30);
      const res = generateRoute(m);
      expect(res.ok, `seed ${seed}: ${res.issues.filter((i) => i.severity === "error").map((i) => i.message)}`).toBe(true);
      expect(joined(m, res), `seed ${seed}`).toBe(true);
      // The south entrance is on low ground; the north one arrives on the raised ground.
      for (const c of openingCells(res.openings[0], 30, 60)) expect(name(res.elevation[c])).toBe("ground");
      const bt = 2;
      const inside = (bt + 1) * 30 + 15;
      expect(name(res.elevation[inside]), `seed ${seed}`).toBe("raised1");
      // Its cells on the map's edge are crossing (transition) tiles: Gen 3 elevation 0.
      for (const c of openingCells(res.openings[1], 30, 60)) {
        expect(name(res.elevation[c])).toBe("transition");
        expect(cellElevationValue(res.terrain[c], res.elevation[c])).toBe(0);
      }
      // No cliff across the gap: the three cells inside the entrance are all walkable on its level.
      for (let x = 14; x <= 16; x++) expect(name(res.elevation[(bt + 2) * 30 + x])).toBe("raised1");
    }
  });

  it("both entrances high, low ground between: stairs down and up again", () => {
    for (let seed = 1; seed <= 6; seed++) {
      const m = map("route", 30, 70, seed, [south(30, { level: 1 }), north(30, { level: 1 })]);
      zone(m, 1, (_x, y) => y < 20 || y >= 50);
      const res = generateRoute(m);
      expect(res.ok, `seed ${seed}`).toBe(true);
      expect(joined(m, res)).toBe(true);
      expect(name(res.elevation[35 * 30 + 15])).toBe("ground");
    }
  });

  it("a high entrance on a flat map gets a shelf to arrive on, with a way down", () => {
    for (const type of ["route", "town"] as const)
      for (let seed = 1; seed <= 6; seed++) {
        const m = map(type, 40, 40, seed, [south(40), north(40, { level: 1 })]);
        m.params = { elevation: 0 };
        const res = generateRoute(m);
        expect(res.ok, `${type} seed ${seed}: ${res.issues.filter((i) => i.severity === "error").map((i) => i.message)}`).toBe(true);
        expect(joined(m, res), `${type} seed ${seed}`).toBe(true);
        expect(name(res.elevation[3 * 40 + 20])).toBe("raised1");
      }
  });

  it("an entrance two levels up", () => {
    let top = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const m = map("route", 40, 90, seed, [south(40), north(40, { level: 2 })]);
      zone(m, 1, (_x, y) => y < 60);
      zone(m, 2, (_x, y) => y < 30);
      const res = generateRoute(m);
      expect(res.ok, `seed ${seed}`).toBe(true);
      expect(joined(m, res)).toBe(true);
      if (name(res.elevation[3 * 40 + 20]) === "raised2") top++;
    }
    expect(top).toBeGreaterThanOrEqual(5);
  });

  it("crossLevel alone makes the edge a crossing, on low ground", () => {
    const m = map("route", 30, 60, 2, [south(30), north(30, { crossLevel: true })]);
    const res = generateRoute(m);
    expect(res.ok).toBe(true);
    for (const c of openingCells(res.openings[1], 30, 60)) expect(name(res.elevation[c])).toBe("transition");
    expect(name(res.elevation[3 * 30 + 15])).toBe("ground");
    expect(joined(m, res)).toBe(true);
  });

  it("forests and caves stay flat, and still get the crossing", () => {
    const m = map("forest", 40, 40, 3, [south(40), north(40, { level: 2 })]);
    const res = generateRoute(m);
    expect(res.ok).toBe(true);
    expect(joined(m, res)).toBe(true);
    expect(name(res.elevation[4 * 40 + 20])).toBe("ground");
    for (const c of openingCells(res.openings[1], 40, 40)) expect(name(res.elevation[c])).toBe("transition");
  });

  it("is saved, and generates the same again", () => {
    const r = newRegion("r", 1);
    const m = addNewMap(r, { name: "Route 1", mapType: "route", width: 30, height: 60, seed: 5 });
    m.openings = [south(30), north(30, { level: 1, crossLevel: true })];
    zone(m, 1, (_x, y) => y < 30);
    const first = generateRoute(m);
    applyResult(m, first);
    const back = parseProject(serializeProject(r, "test")).maps[0];
    expect(back.openings[1]).toMatchObject({ level: 1, crossLevel: true });
    expect(Array.from(back.layers.elevation.data)).toEqual(Array.from(first.elevation));
    expect(Array.from(generateRoute(back).elevation)).toEqual(Array.from(first.elevation));
  });
});

describe("Build sets entrance levels from the sketch", () => {
  /** Lowland in the south, hills from y = 100 up, highland from y = 40 up. A route runs north through all three. */
  function passRegion() {
    const r = newRegion("r", 3);
    const s = (r.sketch = newSketch(200, 300));
    const cols = sketchCols(s);
    for (let i = 0; i < s.heights.length; i++) {
      const y = Math.floor(i / cols) * 5;
      s.heights[i] = y < 40 ? 2 : y < 100 ? 1 : 0;
    }
    return r;
  }

  it("a route over a pass, in two segments: the shared entrance is high on the low map and low on the high one", () => {
    const r = passRegion();
    r.settings.targetSegmentLength = 90;
    addOutdoor(r.sketch!, "route", { x: 80, y: 20, w: 30, h: 180 });
    const report = buildRegion(r);
    expect(report.blocked).toEqual([]);
    // Segments run north to south: the first is y 20–110 (highland and hills), the second 110–200 (lowland).
    const [upper, lower] = r.maps;
    const up = upper.openings.find((o) => o.edge === "south")!;
    const down = lower.openings.find((o) => o.edge === "north")!;
    // They meet at y = 110, in the lowland band: low ground for the lower map…
    expect(down.level).toBeUndefined();
    // …and the upper map's lowest land is hills, with the meeting point in lowland: that's its
    // low ground too (it can't go lower), but the two maps count it differently.
    expect(up.level).toBeUndefined();
    // Move the join up into the hills: now it's one up on the lower map, low on the upper.
    const r2 = passRegion();
    r2.settings.targetSegmentLength = 90;
    addOutdoor(r2.sketch!, "route", { x: 80, y: 0, w: 30, h: 160 });
    buildRegion(r2);
    const [top, bottom] = r2.maps; // y 0–80 (highland, hills) and 80–160 (hills, lowland)
    const a = top.openings.find((o) => o.edge === "south")!;
    const b = bottom.openings.find((o) => o.edge === "north")!;
    expect([a.level ?? 0, b.level ?? 0]).toEqual([0, 1]);
    expect([a.crossLevel, b.crossLevel]).toEqual([true, true]);
    // Both generate, the player gets through each, and the join is a crossing on both.
    for (const m of [top, bottom]) {
      const res = generateRoute(m);
      expect(res.ok, `${m.name}: ${res.issues.filter((i) => i.severity === "error").map((i) => i.message)}`).toBe(true);
      const o = res.openings.find((x) => x.crossLevel)!;
      for (const c of openingCells(o, m.width, m.height)) expect(name(res.elevation[c])).toBe("transition");
    }
    // On the lower map the player arrives up on the hills and comes down to the lowland.
    const res = generateRoute(bottom);
    expect(name(res.elevation[3 * 30 + b.start + 1])).toBe("raised1");
    expect(joined(bottom, res)).toBe(true);
  });

  it("maps that count the ground the same need no crossing", () => {
    const r = passRegion();
    addOutdoor(r.sketch!, "town", { x: 60, y: 200, w: 40, h: 40 });
    addOutdoor(r.sketch!, "town", { x: 100, y: 200, w: 40, h: 40 });
    buildRegion(r);
    for (const m of r.maps) for (const o of m.openings) expect([o.level, o.crossLevel]).toEqual([undefined, undefined]);
  });
});
