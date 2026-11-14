// Maps build on the region sketch: water that's already on a map (from the sketch, or its
// zones) is the water the generator uses, and everything from the sketch is followed
// loosely, with natural edges, but exactly where one map meets the next.

import { describe, expect, it } from "vitest";
import { buildRegion } from "../src/core/buildRegion";
import { generateRoute } from "../src/core/generate";
import { IS_WATER, T } from "../src/core/grid";
import { addNewMap, newRegion } from "../src/core/model";
import type { MapBlueprint, MapType } from "../src/core/model";
import { SKETCH_AREAS, addOutdoor, newSketch, sketchCols } from "../src/core/sketch";
import { layoutOver, newZone, zonedWater } from "../src/core/zones";

function map(type: MapType, w: number, h: number, seed: number, params: Record<string, string | number | boolean> = {}): MapBlueprint {
  const m = addNewMap(newRegion("r", 1), { name: "Place", mapType: type, width: w, height: h, seed });
  m.params = { ...m.params, ...params };
  return m;
}
function water(m: MapBlueprint, kind: string, test: (x: number, y: number) => boolean) {
  const z = newZone(m, "water", { water: kind, depth: "deep" });
  for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width; x++) if (test(x, y)) z.mask.data[y * m.width + x] = 1;
  m.layers.zones.push(z);
  return z;
}
const wet = (t: number) => IS_WATER[t] || t === T.bridge;

describe("a map's own water is the water it's built on", () => {
  it("knows what water the zones give", () => {
    const m = map("town", 40, 40, 1);
    expect(zonedWater(m)).toEqual({ river: false, sea: false });
    expect(layoutOver(m, "river")).toBe("river");
    water(m, "river", (x) => x >= 18 && x < 21);
    expect(zonedWater(m)).toEqual({ river: true, sea: false });
    expect([layoutOver(m, "river"), layoutOver(m, "coastal"), layoutOver(m, "land")]).toEqual(["land", "coastal", "land"]);
    // An empty zone gives nothing.
    const empty = map("town", 40, 40, 1);
    empty.layers.zones.push(newZone(empty, "water", { water: "river", depth: "deep" }));
    expect(zonedWater(empty).river).toBe(false);
  });

  it("a riverside town uses the river that's there and adds no other", () => {
    for (let seed = 1; seed <= 8; seed++) {
      // A river down the west side, at x = 12 to 15: not where the plan would put its own.
      const m = map("town", 50, 50, seed, { townLayout: "riverside", houses: 5, outskirts: 0 });
      water(m, "river", (x) => x >= 12 && x < 16);
      const res = generateRoute(m);
      expect(res.ok, `seed ${seed}: ${res.issues.filter((i) => i.severity === "error").map((i) => i.message)}`).toBe(true);
      // All the water is along that river (within its loose edges): nothing anywhere else.
      for (let y = 0; y < 50; y++) for (let x = 0; x < 50; x++) if (wet(res.terrain[y * 50 + x])) expect(x >= 7 && x <= 21, `seed ${seed} water at (${x}, ${y})`).toBe(true);
      // The town crosses it, and builds beside it.
      expect(res.terrain.filter((t) => t === T.bridge).length, `seed ${seed}`).toBeGreaterThanOrEqual(3);
      expect(res.warps.filter((w) => w.kind === "door").length).toBeGreaterThanOrEqual(6);
    }
  });

  it("with no river on the map, the riverside plan makes its own", () => {
    const res = generateRoute(map("town", 50, 50, 2, { townLayout: "riverside" }));
    expect(res.terrain.filter((t) => IS_WATER[t]).length).toBeGreaterThan(80);
  });

  it("a harbour uses the sea that's there", () => {
    for (let seed = 1; seed <= 6; seed++) {
      const m = map("town", 50, 50, seed, { townLayout: "waterfront", outskirts: 0 });
      m.openings = [
        { id: "o1", edge: "north", start: 24, width: 3, kind: "walk" },
        { id: "o2", edge: "west", start: 15, width: 3, kind: "walk" },
      ];
      water(m, "ocean", (_x, y) => y >= 40);
      const res = generateRoute(m);
      expect(res.ok, `seed ${seed}: ${res.issues.filter((i) => i.severity === "error").map((i) => i.message)}`).toBe(true);
      for (let y = 0; y < 32; y++) for (let x = 0; x < 50; x++) expect(IS_WATER[res.terrain[y * 50 + x]], `seed ${seed} (${x}, ${y})`).toBe(false);
      expect(res.terrain.filter((t) => IS_WATER[t]).length).toBeGreaterThan(250);
    }
  });

  it("a river route follows the river that's there", () => {
    for (let seed = 1; seed <= 6; seed++) {
      const m = map("route", 40, 60, seed, { layout: "river", water: -1, stream: "no" });
      water(m, "river", (_x, y) => y >= 28 && y < 32);
      const res = generateRoute(m);
      expect(res.ok, `seed ${seed}`).toBe(true);
      // No second river down the route (that would be 150 cells or more): at most a pond elsewhere.
      let elsewhere = 0;
      for (let y = 0; y < 60; y++) for (let x = 0; x < 40; x++) if (wet(res.terrain[y * 40 + x]) && (y < 23 || y > 37)) elsewhere++;
      expect(elsewhere, `seed ${seed}`).toBeLessThan(40);
    }
  });
});

describe("the sketch is a starting point with soft edges", () => {
  /** A sketch with a river running north to south at x = 100, and sea east of x = 250. */
  function region() {
    const r = newRegion("r", 5);
    const s = (r.sketch = newSketch(300, 300));
    s.rivers.push({ id: "r1", points: [100, 0, 100, 300], width: 4 });
    const cols = sketchCols(s);
    const sea = 1 + SKETCH_AREAS.indexOf("sea");
    for (let i = 0; i < s.areas.length; i++) if (i % cols >= 50) s.areas[i] = sea;
    return r;
  }

  it("every zone from the sketch is soft, rivers included", () => {
    const r = region();
    addOutdoor(r.sketch!, "town", { x: 80, y: 40, w: 50, h: 50 });
    addOutdoor(r.sketch!, "town", { x: 220, y: 40, w: 50, h: 50 });
    buildRegion(r);
    for (const m of r.maps)
      for (const z of m.layers.zones.filter((k) => k.data.fromSketch === true)) {
        expect(z.hard, `${m.name} ${z.name}`).toBe(false);
        expect(z.fuzziness).toBeGreaterThan(0);
      }
    expect(r.maps[0].layers.zones.find((z) => z.data.water === "river")).toBeTruthy();
  });

  it("a new town on a river is a riverside town, one by the sea a harbour; Build doesn't change it back", () => {
    const r = region();
    addOutdoor(r.sketch!, "town", { x: 80, y: 40, w: 50, h: 50 });
    addOutdoor(r.sketch!, "town", { x: 220, y: 40, w: 50, h: 50 });
    addOutdoor(r.sketch!, "town", { x: 150, y: 150, w: 40, h: 40 });
    buildRegion(r);
    expect(r.maps.map((m) => m.params.townLayout)).toEqual(["riverside", "waterfront", "square"]);
    r.maps[0].params = { ...r.maps[0].params, townLayout: "grid" };
    buildRegion(r);
    expect(r.maps[0].params.townLayout).toBe("grid");
  });

  it("the generated river is the sketch's, with natural banks, and exact at the map's edges", () => {
    const r = region();
    addOutdoor(r.sketch!, "town", { x: 80, y: 40, w: 50, h: 50 });
    buildRegion(r);
    const m = r.maps[0];
    m.params = { ...m.params, outskirts: 0 }; // no ponds: this is about the river
    const mask = m.layers.zones.find((z) => z.data.water === "river")!.mask.data;
    let uneven = 0;
    for (let seed = 1; seed <= 6; seed++) {
      m.seed = seed;
      const res = generateRoute(m);
      expect(res.ok, `seed ${seed}: ${res.issues.filter((i) => i.severity === "error").map((i) => i.message)}`).toBe(true);
      // The river is where the sketch has it (x = 100 is 20 in from the map's west edge)…
      for (let y = 0; y < 50; y++) for (let x = 0; x < 50; x++) if (wet(res.terrain[y * 50 + x])) expect(Math.abs(x - 20), `seed ${seed} (${x}, ${y})`).toBeLessThanOrEqual(6);
      // …exactly as drawn on the top and bottom rows, where it meets the next map…
      for (const y of [0, 49]) for (let x = 0; x < 50; x++) expect(wet(res.terrain[y * 50 + x]), `seed ${seed} edge (${x}, ${y})`).toBe(mask[y * 50 + x] === 1);
      // …and not ruler-straight in between.
      for (let y = 10; y < 40; y++) for (let x = 0; x < 50; x++) if (wet(res.terrain[y * 50 + x]) !== (mask[y * 50 + x] === 1)) uneven++;
    }
    expect(uneven).toBeGreaterThan(30);
  });

  it("a river meets itself across the join between two maps", () => {
    const r = region();
    addOutdoor(r.sketch!, "town", { x: 80, y: 40, w: 50, h: 50 });
    addOutdoor(r.sketch!, "town", { x: 80, y: 90, w: 50, h: 50 });
    buildRegion(r);
    const [north, south] = r.maps;
    const a = generateRoute(north);
    const b = generateRoute(south);
    for (let x = 0; x < 50; x++) expect(wet(a.terrain[49 * 50 + x]), `x ${x}`).toBe(wet(b.terrain[x]));
  });
});
