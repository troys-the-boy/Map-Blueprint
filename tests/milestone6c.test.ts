// Milestone 6, part C: the draft in-game region map, kept up to date from the sketch.

import { describe, expect, it } from "vitest";
import { newRegion } from "../src/core/model";
import { parseProject, serializeProject } from "../src/core/project";
import { draftRegionMap, layoutHeader, sectionAt, sectionCells, sectionId, sectionsJson } from "../src/core/regionMap";
import { addInside, addOutdoor, newSketch } from "../src/core/sketch";

/** A town at the top, a long route south from it that bends east, and a city at the end. */
function region() {
  const s = newSketch();
  const town = addOutdoor(s, "town", { x: 100, y: 0, w: 30, h: 30 });
  const route = addOutdoor(s, "route", { x: 100, y: 30, w: 30, h: 180 });
  addOutdoor(s, "route", { x: 130, y: 180, w: 180, h: 30 }, route);
  const city = addOutdoor(s, "town", { x: 310, y: 170, w: 50, h: 50 });
  city.name = "Cedar City";
  return { s, town, route, city };
}

const squaresOf = (d: ReturnType<typeof draftRegionMap>, placeId: string) => {
  let n = 0;
  for (let gy = 0; gy < d.height; gy++) for (let gx = 0; gx < d.width; gx++) if (sectionAt(d, gx, gy)?.placeId === placeId) n++;
  return n;
};

describe("the draft region map", () => {
  it("is vanilla's 28 × 15 grid, with one section per town and route", () => {
    const { s, town, route, city } = region();
    const d = draftRegionMap(s);
    expect([d.width, d.height, d.layout.length]).toEqual([28, 15, 420]);
    expect(d.sections.map((x) => x.id)).toEqual(["MAPSEC_TOWN_1", "MAPSEC_ROUTE_1", "MAPSEC_CEDAR_CITY"]);
    expect(d.sections.map((x) => x.name)).toEqual(["TOWN 1", "ROUTE 1", "CEDAR CITY"]);
    for (const p of [town, route, city]) expect(squaresOf(d, p.id), p.name).toBeGreaterThan(0);
    // The route, much bigger than the towns, gets the most squares.
    expect(squaresOf(d, route.id)).toBeGreaterThan(squaresOf(d, town.id));
    expect(d.problems).toEqual([]);
  });

  it("keeps the sketch's layout: the town is above the route, the city to the east", () => {
    const { s } = region();
    const d = draftRegionMap(s);
    const [t, r, c] = d.sections;
    expect(t.y).toBeLessThan(r.y + r.h);
    expect(c.x).toBeGreaterThan(t.x);
    // Each entry is the rectangle around its squares, and inside the grid.
    for (const sec of d.sections) {
      expect(sec.x + sec.w).toBeLessThanOrEqual(28);
      expect(sec.y + sec.h).toBeLessThanOrEqual(15);
      for (let gy = 0; gy < 15; gy++)
        for (let gx = 0; gx < 28; gx++) if (sectionAt(d, gx, gy) === sec) expect(gx >= sec.x && gx < sec.x + sec.w && gy >= sec.y && gy < sec.y + sec.h).toBe(true);
    }
  });

  it("updates as the sketch changes", () => {
    const { s, city } = region();
    const before = draftRegionMap(s).sections[2].x;
    city.rects[0].x -= 150;
    expect(draftRegionMap(s).sections[2].x).toBeLessThan(before);
  });

  it("a small town next to a big route still gets its own square", () => {
    const s = newSketch();
    addOutdoor(s, "route", { x: 0, y: 0, w: 30, h: 400 });
    const town = addOutdoor(s, "town", { x: 30, y: 200, w: 10, h: 10 });
    expect(squaresOf(draftRegionMap(s), town.id)).toBeGreaterThan(0);
  });

  it("a section moved by hand stays where it's put, taking those squares", () => {
    const { s, city, route } = region();
    s.regionMap.overrides[city.id] = { x: 0, y: 0, w: 2, h: 2 };
    const d = draftRegionMap(s);
    const sec = d.sections.find((x) => x.placeId === city.id)!;
    expect(sec).toMatchObject({ x: 0, y: 0, w: 2, h: 2, manual: true });
    expect(sectionAt(d, 1, 1)).toBe(sec);
    expect(squaresOf(d, city.id)).toBe(4);
    // A sketch change doesn't move it.
    route.rects[0].h += 20;
    expect(draftRegionMap(s).sections.find((x) => x.placeId === city.id)).toMatchObject({ x: 0, y: 0, w: 2, h: 2 });
  });

  it("an L-shaped route moved by hand keeps its shape; resizing makes it a rectangle", () => {
    const { s, route } = region();
    const d = draftRegionMap(s);
    const sec = d.sections.find((x) => x.placeId === route.id)!;
    const cells = sectionCells(d, sec);
    expect(cells).toContain(0);
    const squares = squaresOf(d, route.id);
    s.regionMap.overrides[route.id] = { x: 0, y: 0, w: sec.w, h: sec.h, cells };
    expect(squaresOf(draftRegionMap(s), route.id)).toBe(squares);
    s.regionMap.overrides[route.id] = { x: 0, y: 0, w: 2, h: 3 };
    expect(squaresOf(draftRegionMap(s), route.id)).toBe(6);
  });

  it("a forest or cave with its own section gets an entry on its route's square; the square keeps the route's name", () => {
    const { s, route } = region();
    const cave = addInside(s, "cave", { x: 110, y: 100 });
    cave.name = "Moss Cave";
    expect(draftRegionMap(s).sections.some((x) => x.placeId === cave.id)).toBe(false);
    cave.ownSection = true;
    const d = draftRegionMap(s);
    const sec = d.sections.find((x) => x.placeId === cave.id)!;
    expect(sec).toMatchObject({ id: "MAPSEC_MOSS_CAVE", w: 1, h: 1, inside: true });
    expect(sectionAt(d, sec.x, sec.y)?.placeId).toBe(route.id);
  });

  it("flags names too long for the game, and two places that would share a section", () => {
    const { s, town, city } = region();
    city.name = "The Great Big Cedar City";
    town.name = "Route-1";
    const problems = draftRegionMap(s).problems.join("\n");
    expect(problems).toMatch(/16/);
    expect(problems).toMatch(/MAPSEC_ROUTE_1/);
    expect(sectionId("Mt. Moss")).toBe("MAPSEC_MT_MOSS");
  });

  it("writes region_map_sections.json and the layout table as pokeemerald has them", () => {
    const { s } = region();
    const d = draftRegionMap(s);
    const json = JSON.parse(sectionsJson(d));
    expect(Object.keys(json.map_sections[0])).toEqual(["id", "name", "x", "y", "width", "height"]);
    const header = layoutHeader(d);
    expect(header).toMatch(/^static const mapsec_u8_t sRegionMap_MapSectionLayout\[MAP_HEIGHT\]\[MAP_WIDTH\] = \{/);
    const rows = header.split("\n").filter((l) => l.startsWith("    {"));
    expect(rows).toHaveLength(15);
    expect(rows.every((r) => r.split(",").filter((x) => x.includes("MAPSEC_")).length === 28)).toBe(true);
  });
});

describe("saving the region map", () => {
  it("keeps sections placed by hand", () => {
    const r = newRegion("r", 1);
    const { s, city } = region();
    s.regionMap.overrides[city.id] = { x: 3, y: 4, w: 1, h: 2 };
    s.regionMap.overrides.p2 = { x: 0, y: 0, w: 2, h: 2, cells: [1, 0, 1, 1] };
    r.sketch = s;
    expect(parseProject(serializeProject(r, "test")).sketch!.regionMap).toEqual({ width: 28, height: 15, overrides: { [city.id]: { x: 3, y: 4, w: 1, h: 2 }, p2: { x: 0, y: 0, w: 2, h: 2, cells: [1, 0, 1, 1] } } });
  });

  it("an older sketch (format 11) gets vanilla's grid", () => {
    const r = newRegion("r", 1);
    r.sketch = region().s;
    const file = JSON.parse(serializeProject(r, "test"));
    file.schemaVersion = 11;
    delete file.region.sketch.regionMap;
    expect(parseProject(JSON.stringify(file)).sketch!.regionMap).toEqual({ width: 28, height: 15, overrides: {} });
  });
});
