// Milestone 6, part B: the region sketch (data, geometry, checks, saving).

import { describe, expect, it } from "vitest";
import { newRegion } from "../src/core/model";
import { CURRENT_SCHEMA_VERSION, parseProject, serializeProject } from "../src/core/project";
import {
  SKETCH_AREAS,
  addInside,
  addOutdoor,
  areaAt,
  cloneSketch,
  newSketch,
  paintAreas,
  parentOf,
  placePieces,
  rectBetween,
  resizeSketch,
  sketchIssues,
  touching,
} from "../src/core/sketch";

const codes = (s: ReturnType<typeof newSketch>) => sketchIssues(s, 90).map((i) => i.code);

describe("sketch geometry", () => {
  it("rectangles snap to the 5-metatile grid, at least one cell each way", () => {
    expect(rectBetween(12, 3, 43, 98)).toEqual({ x: 10, y: 5, w: 35, h: 95 });
    expect(rectBetween(40, 40, 41, 41)).toEqual({ x: 40, y: 40, w: 5, h: 5 });
    expect(rectBetween(50, 60, 20, 10)).toEqual({ x: 20, y: 10, w: 30, h: 50 });
  });

  it("knows when two rectangles sit edge to edge", () => {
    const a = { x: 0, y: 0, w: 30, h: 90 };
    expect(touching(a, { x: 0, y: 90, w: 30, h: 60 })).toBe(true); // straight on
    expect(touching(a, { x: 30, y: 60, w: 90, h: 30 })).toBe(true); // a bend off the side
    expect(touching(a, { x: 30, y: 90, w: 30, h: 30 })).toBe(false); // corner to corner only
    expect(touching(a, { x: 35, y: 0, w: 30, h: 90 })).toBe(false); // a gap
  });

  it("splits a long route stretch into near-equal segments of whole cells, at most the target", () => {
    const s = newSketch();
    const route = addOutdoor(s, "route", { x: 100, y: 0, w: 30, h: 200 });
    expect(placePieces(route, 90).map((p) => [p.y, p.h])).toEqual([
      [0, 65],
      [65, 70],
      [135, 65],
    ]);
    // A horizontal stretch splits along its width; a short one stays whole.
    addOutdoor(s, "route", { x: 130, y: 170, w: 180, h: 30 }, route);
    expect(placePieces(route, 90).slice(3).map((p) => [p.x, p.w, p.h])).toEqual([
      [130, 90, 30],
      [220, 90, 30],
    ]);
    // A town is always one map.
    const town = addOutdoor(s, "town", { x: 0, y: 0, w: 100, h: 95 });
    expect(placePieces(town, 90)).toHaveLength(1);
  });

  it("names new places with the next free number", () => {
    const s = newSketch();
    expect(addOutdoor(s, "route", { x: 0, y: 0, w: 30, h: 90 }).name).toBe("Route 1");
    expect(addOutdoor(s, "route", { x: 100, y: 0, w: 30, h: 90 }).name).toBe("Route 2");
    expect(addOutdoor(s, "town", { x: 200, y: 0, w: 30, h: 30 }).name).toBe("Town 1");
  });

  it("forests and caves are pins on a route or town, which is their parent", () => {
    const s = newSketch();
    const route = addOutdoor(s, "route", { x: 0, y: 0, w: 30, h: 90 });
    const cave = addInside(s, "cave", { x: 10, y: 40 });
    expect(parentOf(s, cave)).toBe(route);
    expect(cave.size).toEqual({ w: 40, h: 40 });
    expect(codes(s)).toEqual([]);
    cave.pins.push({ x: 300, y: 300 });
    expect(codes(s)).toContain("pin-outside");
    cave.pins = [];
    expect(codes(s)).toContain("no-entrance");
  });

  it("paints areas by sketch cell", () => {
    const s = newSketch();
    expect(paintAreas(s, 52, 52, 3, 1 + SKETCH_AREAS.indexOf("lake"))).toBe(true);
    expect(areaAt(s, 45, 45)).toBe("lake");
    expect(areaAt(s, 59, 59)).toBe("lake");
    expect(areaAt(s, 60, 60)).toBeNull();
    expect(paintAreas(s, 52, 52, 1, 1 + SKETCH_AREAS.indexOf("lake"))).toBe(false);
  });

  it("resizing keeps the painting that still fits", () => {
    const s = newSketch(100, 100);
    paintAreas(s, 92, 2, 1, 1);
    paintAreas(s, 2, 2, 1, 2);
    resizeSketch(s, 52, 200);
    expect([s.width, s.height]).toEqual([50, 200]);
    expect(areaAt(s, 2, 2)).toBe(SKETCH_AREAS[1]);
    expect(s.areas.filter((v) => v).length).toBe(1);
  });
});

describe("sketch checks", () => {
  it("a good sketch has no issues", () => {
    const s = newSketch();
    const town = addOutdoor(s, "town", { x: 0, y: 0, w: 30, h: 30 });
    const route = addOutdoor(s, "route", { x: 0, y: 30, w: 30, h: 150 });
    addOutdoor(s, "route", { x: 30, y: 150, w: 90, h: 30 }, route);
    expect(town.name).toBe("Town 1");
    expect(sketchIssues(s, 90)).toEqual([]);
  });

  it("finds gaps in a route, overlaps, maps too big for the game, and repeated names", () => {
    const s = newSketch();
    const route = addOutdoor(s, "route", { x: 0, y: 0, w: 30, h: 90 });
    addOutdoor(s, "route", { x: 40, y: 0, w: 30, h: 90 }, route);
    expect(codes(s)).toContain("route-gap");
    route.rects[1] = { x: 0, y: 90, w: 30, h: 90 };
    expect(codes(s)).toEqual([]);
    const town = addOutdoor(s, "town", { x: 10, y: 10, w: 40, h: 40 });
    expect(codes(s)).toContain("overlap");
    town.rects[0] = { x: 30, y: 0, w: 40, h: 40 };
    expect(codes(s)).toEqual([]);
    // A 100×100 town: (100 + 15) × (100 + 14) is over 10,240.
    const wide = addOutdoor(s, "town", { x: 200, y: 0, w: 100, h: 100 });
    expect(codes(s)).toContain("too-big");
    wide.rects[0] = { x: 200, y: 0, w: 30, h: 30 };
    wide.name = "route 1";
    expect(codes(s)).toEqual(["same-name"]);
  });

  it("warns about narrow routes and places off the sketch", () => {
    const s = newSketch(200, 200);
    addOutdoor(s, "route", { x: 0, y: 0, w: 10, h: 60 });
    addOutdoor(s, "town", { x: 180, y: 180, w: 30, h: 30 });
    expect(codes(s)).toEqual(["narrow", "outside-sketch"]);
  });
});

describe("saving the sketch", () => {
  it("round-trips through a project file", () => {
    const region = newRegion("r", 1);
    const s = newSketch(300, 200);
    const route = addOutdoor(s, "route", { x: 0, y: 0, w: 30, h: 90 });
    addOutdoor(s, "route", { x: 30, y: 60, w: 90, h: 30 }, route);
    const forest = addInside(s, "forest", { x: 10, y: 10 });
    forest.ownSection = true;
    paintAreas(s, 150, 100, 4, 1 + SKETCH_AREAS.indexOf("sea"));
    s.rivers.push({ id: "r1", points: [0, 0, 50, 60, 120, 60], width: 3 });
    s.underlay = { kind: "image", name: "plan.png", data: "data:image/png;base64,iVBORw0KGgo=", page: 1, x: -10, y: 5, scale: 0.5, rotation: 90, opacity: 0.4, visible: true, locked: false, save: true };
    region.sketch = s;
    expect(CURRENT_SCHEMA_VERSION).toBeGreaterThanOrEqual(11);
    const loaded = parseProject(serializeProject(region, "test")).sketch!;
    expect(loaded.areas).toEqual(s.areas);
    expect({ ...loaded, areas: null }).toEqual({ ...cloneSketch(s), areas: null });
  });

  it("an older file (format 10) opens with no sketch", () => {
    const file = JSON.parse(serializeProject(newRegion("r", 1), "test"));
    file.schemaVersion = 10;
    expect(parseProject(JSON.stringify(file)).sketch).toBeNull();
  });

  it("rejects an underlay that isn't a PDF or image", () => {
    const region = newRegion("r", 1);
    region.sketch = newSketch(100, 100);
    region.sketch.underlay = { kind: "image", name: "x", data: "data:text/html;base64,PHA+", page: 1, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, visible: true, locked: false, save: true };
    expect(() => parseProject(serializeProject(region, "test"))).toThrow(/underlay\.data/);
  });
});
