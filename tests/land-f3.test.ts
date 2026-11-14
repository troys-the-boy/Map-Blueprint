// Map water ties into the region's water: a map's own stream runs into the river (or sea,
// or lake) that's already there, layouts follow the sketch's water, and entrances keep off it.

import { describe, expect, it } from "vitest";
import { buildRegion } from "../src/core/buildRegion";
import { generateRoute } from "../src/core/generate";
import { IS_WATER, T } from "../src/core/grid";
import { addNewMap, newRegion } from "../src/core/model";
import type { MapBlueprint, Region } from "../src/core/model";
import { openingCells } from "../src/core/reach";
import { SKETCH_AREAS, addOutdoor, newSketch, sketchCols } from "../src/core/sketch";
import { OPEN_WATER_SHARE, layoutOver, newZone, seaShare } from "../src/core/zones";

const SEA = 1 + SKETCH_AREAS.indexOf("sea");
const LAKE = 1 + SKETCH_AREAS.indexOf("lake");
const wet = (t: number) => IS_WATER[t] || t === T.bridge;
type Res = ReturnType<typeof generateRoute>;

/** The cells of water joined to the cells that pass `seed`. */
function joinedTo(res: Res, w: number, h: number, seed: (x: number, y: number) => boolean): Uint8Array {
  const seen = new Uint8Array(w * h);
  const queue: number[] = [];
  for (let i = 0; i < w * h; i++) if (wet(res.terrain[i]) && seed(i % w, Math.floor(i / w))) (seen[i] = 1, queue.push(i));
  for (let k = 0; k < queue.length; k++) {
    const x = queue[k] % w;
    const y = Math.floor(queue[k] / w);
    // (Corner to corner counts: a soft-edged lake or a stream's bend can touch that way.)
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const X = x + dx;
      const Y = y + dy;
      if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
      const j = Y * w + X;
      if (!seen[j] && wet(res.terrain[j])) (seen[j] = 1, queue.push(j));
    }
  }
  return seen;
}

/** A sketch with a river running west to east at y = 150. */
function riverRegion(): Region {
  const r = newRegion("r", 9);
  r.sketch = newSketch(300, 300);
  r.sketch.rivers.push({ id: "r1", points: [0, 150, 300, 150], width: 4 });
  return r;
}

describe("a map's own water ties into the region's", () => {
  it("River layout on a route the sketch's river crosses: that river, and no other", () => {
    const r = riverRegion();
    addOutdoor(r.sketch!, "route", { x: 100, y: 110, w: 40, h: 80 });
    buildRegion(r);
    const m = r.maps[0];
    for (let seed = 1; seed <= 8; seed++) {
      m.seed = seed;
      m.params = { ...m.params, layout: "river", water: 0, stream: "no", hmPockets: 0 };
      const res = generateRoute(m);
      expect(res.ok, `seed ${seed}: ${res.issues.filter((i) => i.severity === "error").map((i) => i.message)}`).toBe(true);
      // The river is where the sketch has it (y = 150 is row 40 of the map), right across the map…
      for (let x = 2; x < 38; x++) {
        let found = false;
        for (let y = 35; y <= 45; y++) if (wet(res.terrain[y * 40 + x])) found = true;
        expect(found, `seed ${seed} x ${x}`).toBe(true);
      }
      // …and there's no second river along the route.
      let elsewhere = 0;
      for (let y = 0; y < 80; y++) for (let x = 0; x < 40; x++) if (wet(res.terrain[y * 40 + x]) && Math.abs(y - 40) > 8) elsewhere++;
      expect(elsewhere, `seed ${seed}`).toBe(0);
    }
  });

  it("a stream is a tributary: it runs into the sketch's river and stops there", () => {
    const r = riverRegion();
    addOutdoor(r.sketch!, "route", { x: 100, y: 110, w: 40, h: 80 });
    buildRegion(r);
    const m = r.maps[0];
    let streams = 0;
    for (let seed = 1; seed <= 12; seed++) {
      m.seed = seed;
      m.params = { ...m.params, water: 0.1, stream: "yes", hmPockets: 0 };
      const res = generateRoute(m);
      expect(res.ok, `seed ${seed}: ${res.issues.filter((i) => i.severity === "error").map((i) => i.message)}`).toBe(true);
      const river = joinedTo(res, 40, 80, (_x, y) => Math.abs(y - 40) <= 2);
      let north = 0;
      let south = 0;
      for (let i = 0; i < res.terrain.length; i++) {
        if (!wet(res.terrain[i])) continue;
        // Every bit of water on the map is joined to the river: no stream off on its own.
        expect(river[i], `seed ${seed}: water at (${i % 40}, ${Math.floor(i / 40)}) isn't joined to the river`).toBe(1);
        const y = Math.floor(i / 40);
        if (y < 32) north++;
        if (y > 48) south++;
      }
      if (north + south > 6) streams++;
      // It comes in from one side and ends at the river: it doesn't carry on out the other side.
      expect(Math.min(north, south), `seed ${seed}`).toBe(0);
    }
    expect(streams).toBeGreaterThanOrEqual(8);
  });

  it("a stream runs into a lake or the sea the same way", () => {
    let streams = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const m = addNewMap(newRegion("r", 1), { name: "Route 1", mapType: "route", width: 40, height: 80, seed });
      m.params = { water: 0.1, stream: "yes", hmPockets: 0 };
      const z = newZone(m, "water", { water: "lake", depth: "deep" });
      for (let y = 30; y < 42; y++) for (let x = 24; x < 36; x++) z.mask.data[y * 40 + x] = 1;
      m.layers.zones.push(z);
      const res = generateRoute(m);
      expect(res.ok, `seed ${seed}`).toBe(true);
      const lake = joinedTo(res, 40, 80, (x, y) => x >= 27 && x < 33 && y >= 33 && y < 39);
      let outside = 0;
      for (let i = 0; i < res.terrain.length; i++)
        if (wet(res.terrain[i])) {
          expect(lake[i], `seed ${seed}: water at (${i % 40}, ${Math.floor(i / 40)})`).toBe(1);
          if (i % 40 < 20) outside++;
        }
      if (outside > 4) streams++;
    }
    expect(streams).toBeGreaterThanOrEqual(6);
  });

  it("with no water on the map, a stream crosses it as before", () => {
    const m = addNewMap(newRegion("r", 1), { name: "Route 1", mapType: "route", width: 40, height: 80, seed: 3 });
    m.params = { water: 0.1, stream: "yes", elevation: 0 };
    const res = generateRoute(m);
    const xs = new Set<number>();
    for (let i = 0; i < res.terrain.length; i++) if (wet(res.terrain[i])) xs.add(i % 40);
    expect(xs.size).toBeGreaterThan(30);
  });
});

describe("Open water follows the sketch's sea", () => {
  /** Sea over the east of the sketch (x ≥ 150). */
  function seaRegion(): Region {
    const r = newRegion("r", 4);
    const s = (r.sketch = newSketch(300, 300));
    const cols = sketchCols(s);
    for (let i = 0; i < s.areas.length; i++) if (i % cols >= 30) s.areas[i] = SEA;
    return r;
  }

  it("a map that's half land isn't flooded: the sea is where the sketch has it", () => {
    const r = seaRegion();
    addOutdoor(r.sketch!, "route", { x: 130, y: 50, w: 40, h: 80 }); // west half land, east half sea
    buildRegion(r);
    const m = r.maps[0];
    expect(seaShare(m)).toBeCloseTo(0.5, 1);
    expect(layoutOver(m, "water")).toBe("land");
    for (let seed = 1; seed <= 6; seed++) {
      m.seed = seed;
      m.params = { ...m.params, layout: "water", water: 0, stream: "no", hmPockets: 0 };
      const res = generateRoute(m);
      expect(res.ok, `seed ${seed}: ${res.issues.filter((i) => i.severity === "error").map((i) => i.message)}`).toBe(true);
      for (let y = 0; y < 80; y++) for (let x = 0; x < 13; x++) expect(IS_WATER[res.terrain[y * 40 + x]], `seed ${seed} (${x}, ${y})`).toBe(false);
      let east = 0;
      for (let y = 10; y < 70; y++) for (let x = 28; x < 38; x++) if (IS_WATER[res.terrain[y * 40 + x]]) east++;
      expect(east).toBeGreaterThan(500);
    }
  });

  it("a new route that's all sea is an open-water route, joined to the next by a surf entrance", () => {
    const r = seaRegion();
    r.settings.targetSegmentLength = 90;
    addOutdoor(r.sketch!, "route", { x: 200, y: 20, w: 40, h: 160 });
    buildRegion(r);
    const [north, south] = r.maps;
    expect(seaShare(north)).toBeGreaterThanOrEqual(OPEN_WATER_SHARE);
    expect([north.params.layout, south.params.layout]).toEqual(["water", "water"]);
    expect(north.openings.find((o) => o.edge === "south")!.kind).toBe("surf");
    expect(south.openings.find((o) => o.edge === "north")!.kind).toBe("surf");
    // A route on land keeps the usual layout and walking entrances.
    addOutdoor(r.sketch!, "route", { x: 40, y: 20, w: 40, h: 160 });
    buildRegion(r);
    const land = r.maps.slice(2);
    expect(land.map((m) => m.params.layout)).toEqual([undefined, undefined]);
    expect(land[0].openings[0].kind).toBe("walk");
  });
});

describe("entrances keep off the sketch's water", () => {
  function meet(region: Region): [MapBlueprint, MapBlueprint] {
    addOutdoor(region.sketch!, "town", { x: 100, y: 60, w: 50, h: 50 });
    addOutdoor(region.sketch!, "town", { x: 100, y: 110, w: 50, h: 50 });
    buildRegion(region);
    return [region.maps[0], region.maps[1]];
  }

  it("moves an entrance off a river that runs through the middle of the shared edge", () => {
    const r = newRegion("r", 2);
    r.sketch = newSketch(300, 300);
    // A river running north to south through x = 125: right where the entrance would be.
    r.sketch.rivers.push({ id: "r1", points: [125, 0, 125, 300], width: 4 });
    const [north, south] = meet(r);
    const a = north.openings.find((o) => o.edge === "south")!;
    const b = south.openings.find((o) => o.edge === "north")!;
    expect(a.kind).toBe("walk");
    expect(a.start).toBe(b.start);
    // Clear of the river (x = 25 on the maps) by at least its width.
    expect(Math.abs(a.start + 1 - 25)).toBeGreaterThanOrEqual(5);
    for (const m of [north, south]) {
      const res = generateRoute(m);
      expect(res.ok, `${m.name}: ${res.issues.filter((i) => i.severity === "error").map((i) => i.message)}`).toBe(true);
      for (const o of res.openings) for (const c of openingCells(o, 50, 50)) expect(wet(res.terrain[c])).toBe(false);
    }
  });

  it("moves an entrance off a lake, and leaves it in the middle when the middle is dry", () => {
    const r = newRegion("r", 2);
    const s = (r.sketch = newSketch(300, 300));
    const cols = sketchCols(s);
    // A lake over the middle of the shared edge (x 115–135, y 100–120).
    for (let cy = 20; cy < 24; cy++) for (let cx = 23; cx < 27; cx++) s.areas[cy * cols + cx] = LAKE;
    const [north] = meet(r);
    const a = north.openings.find((o) => o.edge === "south")!;
    expect(a.start + 1 < 15 || a.start + 1 >= 35).toBe(true);
    const dry = newRegion("r", 2);
    dry.sketch = newSketch(300, 300);
    const [plain] = meet(dry);
    expect(plain.openings.find((o) => o.edge === "south")!.start).toBe(24);
  });
});
