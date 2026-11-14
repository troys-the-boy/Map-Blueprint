// Land and settlements, part C: the lie of the land on the region sketch, and the
// rivers and lakes it suggests.

import { describe, expect, it } from "vitest";
import { newRegion } from "../src/core/model";
import { CURRENT_SCHEMA_VERSION, migrate, parseProject, serializeProject } from "../src/core/project";
import { HEIGHT_BANDS, TERRAIN_SHAPES, acceptLake, acceptRiver, generateTerrain, levelAt, paintHeights, suggestWater } from "../src/core/regionTerrain";
import { SKETCH_AREAS, cloneSketch, newSketch, resizeSketch, sketchCols, sketchRows } from "../src/core/sketch";
import type { Sketch } from "../src/core/sketch";

const SEA = 1 + SKETCH_AREAS.indexOf("sea");
const LAKE = 1 + SKETCH_AREAS.indexOf("lake");
const share = (s: Sketch, level: number) => {
  let n = 0;
  for (let i = 0; i < s.heights.length; i++) if (levelAt(s, i) === level) n++;
  return n / s.heights.length;
};
/** The level under a point (metatiles). */
const levelUnder = (s: Sketch, x: number, y: number) => levelAt(s, Math.min(sketchRows(s) - 1, Math.floor(y / 5)) * sketchCols(s) + Math.min(sketchCols(s) - 1, Math.floor(x / 5)));

describe("painting heights", () => {
  it("a new sketch is all lowland", () => {
    const s = newSketch(200, 100);
    expect(s.heights.length).toBe(40 * 20);
    expect(share(s, 0)).toBe(1);
  });

  it("paints a band with the brush; sea and land replace each other", () => {
    const s = newSketch(200, 100);
    expect(paintHeights(s, 52, 52, 3, 2)).toBe(true);
    expect(paintHeights(s, 52, 52, 3, 2)).toBe(false); // nothing left to change
    expect([s.heights[10 * 40 + 10], s.heights[9 * 40 + 9], s.heights[11 * 40 + 11], s.heights[12 * 40 + 12]]).toEqual([2, 2, 2, 0]);
    // Sea over the hills: the sea area, and no height.
    paintHeights(s, 52, 52, 1, "sea");
    expect([s.areas[10 * 40 + 10], s.heights[10 * 40 + 10], levelAt(s, 10 * 40 + 10)]).toEqual([SEA, 0, -1]);
    // Land over the sea: the sea goes.
    paintHeights(s, 52, 52, 1, 1);
    expect([s.areas[10 * 40 + 10], s.heights[10 * 40 + 10]]).toEqual([0, 1]);
  });

  it("a painted biome or lake keeps its place when its height is painted", () => {
    const s = newSketch(200, 100);
    s.areas[0] = LAKE;
    s.areas[1] = 1; // a biome
    paintHeights(s, 2, 2, 1, 3);
    paintHeights(s, 7, 2, 1, 3);
    expect([s.areas[0], s.areas[1], s.heights[0], s.heights[1]]).toEqual([LAKE, 1, 3, 3]);
  });

  it("resizing and copying the sketch keep the heights", () => {
    const s = newSketch(200, 100);
    paintHeights(s, 52, 52, 1, 3);
    const copy = cloneSketch(s);
    resizeSketch(s, 300, 150);
    expect(s.heights.length).toBe(60 * 30);
    expect(s.heights[10 * 60 + 10]).toBe(3);
    resizeSketch(s, 30, 30);
    expect(s.heights.length).toBe(36);
    // The copy (an undo step) is untouched.
    expect(copy.heights[10 * 40 + 10]).toBe(3);
    expect(copy.heights.length).toBe(800);
  });
});

describe("generating terrain", () => {
  it("the same seed and landform give the same land; another seed gives another", () => {
    const a = newSketch(600, 400);
    const b = newSketch(600, 400);
    const c = newSketch(600, 400);
    generateTerrain(a, 5, "island");
    generateTerrain(b, 5, "island");
    generateTerrain(c, 6, "island");
    expect(Array.from(a.heights)).toEqual(Array.from(b.heights));
    expect(Array.from(a.areas)).toEqual(Array.from(b.areas));
    expect(Array.from(a.heights)).not.toEqual(Array.from(c.heights));
  });

  it("every landform has all four bands, in sensible shares", () => {
    for (const shape of TERRAIN_SHAPES)
      for (const seed of [1, 2, 3]) {
        const s = newSketch(600, 400);
        generateTerrain(s, seed, shape);
        const land = 1 - share(s, -1);
        for (let band = 0; band < HEIGHT_BANDS.length; band++) expect(share(s, band), `${shape} ${seed} band ${band}`).toBeGreaterThan(0.02 * land);
        // More low ground than high.
        expect(share(s, 0)).toBeGreaterThan(share(s, 3));
      }
  });

  it("an island has sea all round and its high ground inland", () => {
    const s = newSketch(600, 400);
    generateTerrain(s, 4, "island");
    const cols = sketchCols(s);
    const rows = sketchRows(s);
    let edge = 0;
    let edgeSea = 0;
    for (let x = 0; x < cols; x++) for (const y of [0, rows - 1]) (edge++, levelAt(s, y * cols + x) < 0 && edgeSea++);
    for (let y = 0; y < rows; y++) for (const x of [0, cols - 1]) (edge++, levelAt(s, y * cols + x) < 0 && edgeSea++);
    expect(edgeSea / edge).toBeGreaterThan(0.9);
    expect(share(s, -1)).toBeGreaterThan(0.25);
    expect(share(s, -1)).toBeLessThan(0.5);
    for (let i = 0; i < s.heights.length; i++) if (levelAt(s, i) === 3) expect(Math.min(i % cols, cols - 1 - (i % cols))).toBeGreaterThan(5);
  });

  it("a coast has sea; a valley and a range have none", () => {
    for (const [shape, sea] of [["coast", true], ["valley", false], ["range", false]] as const) {
      const s = newSketch(600, 400);
      generateTerrain(s, 2, shape);
      expect(share(s, -1) > 0.15, shape).toBe(sea);
    }
  });

  it("keeps painted biomes and lakes on land, and replaces the old sea", () => {
    const s = newSketch(600, 400);
    const cols = sketchCols(s);
    const middle = 40 * cols + 60;
    s.areas[middle] = LAKE;
    s.areas[middle + 1] = 2;
    s.areas[middle + 2] = SEA; // old sea, inland
    generateTerrain(s, 4, "island");
    expect([s.areas[middle], s.areas[middle + 1], s.areas[middle + 2]]).toEqual([LAKE, 2, 0]);
  });
});

describe("suggested rivers and lakes", () => {
  it("rivers start on higher ground and end in the sea, never climbing", () => {
    for (const seed of [1, 2, 3, 4]) {
      const s = newSketch(600, 400);
      generateTerrain(s, seed, "island");
      const w = suggestWater(s, seed);
      expect(w.rivers.length, `seed ${seed}`).toBeGreaterThanOrEqual(2);
      expect(w.reason).toBe("");
      let toSea = 0;
      for (const r of w.rivers) {
        expect(r.points.length % 2).toBe(0);
        expect(r.points.length).toBeGreaterThanOrEqual(4);
        expect(r.width).toBeGreaterThanOrEqual(2);
        expect(r.width).toBeLessThanOrEqual(5);
        const first = levelUnder(s, r.points[0], r.points[1]);
        const last = levelUnder(s, r.points[r.points.length - 2], r.points[r.points.length - 1]);
        expect(first, `seed ${seed}`).toBeGreaterThanOrEqual(last);
        if (last < 0) toSea++;
        for (let k = 0; k < r.points.length; k += 2) {
          expect(r.points[k]).toBeGreaterThanOrEqual(0);
          expect(r.points[k]).toBeLessThanOrEqual(600);
          expect(r.points[k + 1]).toBeLessThanOrEqual(400);
        }
      }
      // The main rivers reach the sea (a tributary ends where it joins one).
      expect(toSea, `seed ${seed}`).toBeGreaterThanOrEqual(1);
    }
  });

  it("gives the same suggestions each time, and doesn't change the sketch", () => {
    const s = newSketch(600, 400);
    generateTerrain(s, 3, "coast");
    const before = cloneSketch(s);
    const a = suggestWater(s, 3);
    const b = suggestWater(s, 3);
    expect(a).toEqual(b);
    expect(Array.from(s.heights)).toEqual(Array.from(before.heights));
    expect(Array.from(s.areas)).toEqual(Array.from(before.areas));
    expect(s.rivers).toEqual([]);
  });

  it("with no sea, rivers run off the low edge of the sketch, not out through high ground", () => {
    const s = newSketch(600, 400);
    generateTerrain(s, 1, "valley");
    const w = suggestWater(s, 1);
    expect(w.rivers.length).toBeGreaterThanOrEqual(1);
    for (const r of w.rivers) {
      const first = levelUnder(s, r.points[0], r.points[1]);
      const last = levelUnder(s, r.points[r.points.length - 2], r.points[r.points.length - 1]);
      expect(last).toBeLessThanOrEqual(first);
    }
  });

  it("land shut in by higher ground becomes a lake", () => {
    const s = newSketch(300, 300);
    const cols = sketchCols(s);
    // Hills everywhere, sea down the west side, and a lowland basin in the middle.
    s.heights.fill(1);
    for (let y = 0; y < 60; y++) for (let x = 0; x < 5; x++) s.areas[y * cols + x] = SEA;
    for (let y = 25; y < 35; y++) for (let x = 25; x < 35; x++) s.heights[y * cols + x] = 0;
    const w = suggestWater(s, 1);
    expect(w.lakes.length).toBe(1);
    expect(w.lakes[0].length).toBeGreaterThan(60);
    for (const c of w.lakes[0]) expect(s.heights[c]).toBe(0);
    // Adding it paints the lake area.
    acceptLake(s, w.lakes[0]);
    expect(s.areas[30 * cols + 30]).toBe(LAKE);
    // With the lake painted, water now runs into it: no lake is suggested again.
    expect(suggestWater(s, 1).lakes).toEqual([]);
  });

  it("says why when there's nothing to suggest", () => {
    const flat = newSketch(200, 200);
    expect(suggestWater(flat, 1)).toMatchObject({ rivers: [], lakes: [] });
    expect(suggestWater(flat, 1).reason).toMatch(/all one height/);
    const sea = newSketch(200, 200);
    sea.areas.fill(SEA);
    expect(suggestWater(sea, 1).reason).toMatch(/all sea/);
  });

  it("an added river is an ordinary river", () => {
    const s = newSketch(600, 400);
    generateTerrain(s, 2, "island");
    const w = suggestWater(s, 2);
    acceptRiver(s, w.rivers[0]);
    expect(s.rivers).toHaveLength(1);
    expect(s.rivers[0]).toMatchObject({ id: "r1", width: w.rivers[0].width, points: w.rivers[0].points });
    // It's saved and loaded like one drawn by hand.
    const r = newRegion("r", 1);
    r.sketch = s;
    expect(parseProject(serializeProject(r, "test")).sketch!.rivers).toEqual(s.rivers);
  });

  it("is quick on a big sketch", () => {
    const s = newSketch(900, 600);
    generateTerrain(s, 1, "range");
    const t0 = Date.now();
    suggestWater(s, 1);
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});

describe("project format 17", () => {
  it("saves the heights", () => {
    const r = newRegion("r", 1);
    r.sketch = newSketch(600, 400);
    generateTerrain(r.sketch, 8, "coast");
    expect(CURRENT_SCHEMA_VERSION).toBeGreaterThanOrEqual(17);
    const back = parseProject(serializeProject(r, "test"));
    expect(Array.from(back.sketch!.heights)).toEqual(Array.from(r.sketch.heights));
    expect(Array.from(back.sketch!.areas)).toEqual(Array.from(r.sketch.areas));
  });

  it("an older sketch opens as all lowland", () => {
    const r = newRegion("r", 1);
    r.sketch = newSketch(200, 100);
    r.sketch.areas[3] = SEA;
    const file = JSON.parse(serializeProject(r, "test"));
    file.schemaVersion = 16;
    delete file.region.sketch.heights;
    const up = migrate(file) as { region: { sketch: { heights: { legend: string[]; rows: number[][] } } } };
    expect(up.region.sketch.heights.legend).toEqual(["lowland"]);
    expect(up.region.sketch.heights.rows.length).toBe(20);
    const back = parseProject(JSON.stringify(file));
    expect(back.sketch!.heights.length).toBe(800);
    expect(Array.from(back.sketch!.heights).every((h) => h === 0)).toBe(true);
    expect(back.sketch!.areas[3]).toBe(SEA);
  });

  it("a project with no sketch still opens", () => {
    const file = JSON.parse(serializeProject(newRegion("r", 1), "test"));
    file.schemaVersion = 16;
    expect(parseProject(JSON.stringify(file)).sketch).toBeNull();
  });

  it("rejects a height band that doesn't exist", () => {
    const r = newRegion("r", 1);
    r.sketch = newSketch(50, 50);
    const file = JSON.parse(serializeProject(r, "test"));
    file.region.sketch.heights.legend = ["cloud"];
    expect(() => parseProject(JSON.stringify(file))).toThrow(/height/);
  });
});
