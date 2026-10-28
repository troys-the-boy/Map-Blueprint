// Milestone 6, part E: building the region's maps from the sketch.

import { describe, expect, it } from "vitest";
import { buildRegion, pairRegionWarps } from "../src/core/buildRegion";
import { applyResult, generateRoute } from "../src/core/generate";
import { IS_WATER, T } from "../src/core/grid";
import type { MapBlueprint, Region } from "../src/core/model";
import { newRegion } from "../src/core/model";
import { addInside, addOutdoor, newSketch } from "../src/core/sketch";
import { validateMap } from "../src/core/validate";

/**
 * Three towns in a ring of four routes, a cave on Route 1, and a river across Route 2
 * (over the seam between its two maps).
 *
 *   Fir Town ── Route 4 ──────────┐
 *      │                       Route 3
 *   Route 1 (cave)                │
 *      │                          │
 *   Birch Town ── Route 2 ── Cedar City
 */
function ring(seed = 1) {
  const r = newRegion("Test", seed);
  const s = newSketch(400, 260);
  r.sketch = s;
  const fir = addOutdoor(s, "town", { x: 100, y: 0, w: 30, h: 30 });
  fir.name = "Fir Town";
  const r1 = addOutdoor(s, "route", { x: 100, y: 30, w: 30, h: 120 });
  const birch = addOutdoor(s, "town", { x: 95, y: 150, w: 40, h: 30 });
  birch.name = "Birch Town";
  const r2 = addOutdoor(s, "route", { x: 135, y: 150, w: 150, h: 30 });
  const cedar = addOutdoor(s, "town", { x: 285, y: 140, w: 40, h: 40 });
  cedar.name = "Cedar City";
  const r3 = addOutdoor(s, "route", { x: 290, y: 30, w: 30, h: 110 });
  const r4 = addOutdoor(s, "route", { x: 130, y: 0, w: 170, h: 30 });
  const cave = addInside(s, "cave", { x: 112, y: 80 });
  cave.name = "Moss Cave";
  s.rivers.push({ id: "r1", points: [195, 140, 225, 195], width: 3 });
  s.journey.stops = [fir.id, r1.id, birch.id, r2.id, cedar.id, r3.id, r4.id, fir.id];
  r.progression = [
    { id: "s1", name: "Start", badges: 0, hms: [] },
    { id: "s2", name: "Badge 1", badges: 1, hms: ["cut"] },
  ];
  s.journey.stepStarts = { s1: 0, s2: 4 };
  return { r, s, fir, r1, birch, r2, cedar, r3, r4, cave };
}

const byId = (r: Region, id: string) => r.maps.find((m) => m.id === id)!;
const OPP: Record<string, string> = { up: "down", down: "up", left: "right", right: "left" };
const EDGE_OF: Record<string, string> = { up: "north", down: "south", left: "west", right: "east" };

function generateAll(r: Region, ids: string[]) {
  for (const id of ids) {
    const m = byId(r, id);
    applyResult(m, generateRoute(m, { otherMaps: r.maps }));
  }
  pairRegionWarps(r);
}

describe("Milestone 6 goal: a sketch with 3 towns, 4 routes and a cave generates", () => {
  it("every map passes its checks, every connection lines up, and the river flows on across the seam", () => {
    const { r, s, r1, r2, cave } = ring();
    const report = buildRegion(r);
    expect(report.blocked).toEqual([]);
    // 3 towns, routes split into segments (120 → 2, 150 → 2, 110 → 2, 170 → 2), and the cave.
    expect(r.maps).toHaveLength(12);
    expect(report.created).toHaveLength(12);
    generateAll(r, report.needsGenerate);

    for (const m of r.maps) {
      const errors = validateMap(m, { otherMaps: r.maps }).filter((i) => i.severity === "error");
      expect(errors.map((e) => `${m.name}: ${e.code} ${e.message}`)).toEqual([]);
    }

    // Connections: each one has its mirror on the neighbour, with the opposite offset,
    // and the entrances on the shared edge sit at the same place on both maps.
    for (const a of r.maps.filter((m) => m.mapType !== "cave")) {
      for (const c of a.connections) {
        const b = byId(r, c.map);
        const back = b.connections.find((x) => x.map === a.id);
        expect(back, `${a.name} → ${b.name}`).toBeDefined();
        expect(back!.direction).toBe(OPP[c.direction]);
        expect(back!.offset + c.offset).toBe(0);
        const edgeA = EDGE_OF[c.direction];
        const edgeB = EDGE_OF[back!.direction];
        const oa = a.openings.filter((o) => o.edge === edgeA);
        const ob = b.openings.filter((o) => o.edge === edgeB);
        expect(oa.some((o) => ob.some((p) => p.start === o.start - c.offset && p.width === o.width)), `${a.name}/${b.name} entrances`).toBe(true);
      }
    }

    // The river: where Route 2's two maps meet, water (or a bridge over it) on both sides of the seam.
    const [west, east] = r2.mapIds.map((id) => byId(r, id));
    const wet = (m: MapBlueprint, x: number) => {
      const rows: number[] = [];
      for (let y = 0; y < m.height; y++) {
        const t = m.layers.terrain.data[y * m.width + x];
        if (IS_WATER[t] || t === T.bridge) rows.push(y);
      }
      return rows;
    };
    const left = wet(west, west.width - 1);
    const right = wet(east, 0);
    // It runs on a slant, so the columns either side of the seam are a row or two apart, but
    // the river (3 wide) carries on: at least 2 rows are water (or bridge) on both sides.
    expect(left.filter((y) => right.includes(y)).length).toBeGreaterThanOrEqual(2);

    // The cave: one mouth on Route 1, paired with the cave's own mouth both ways.
    const caveMap = byId(r, cave.mapIds[0]);
    const host = r1.mapIds.map((id) => byId(r, id)).find((m) => m.warps.some((w) => w.destMap === caveMap.header.id))!;
    const w = host.warps.find((x) => x.destMap === caveMap.header.id)!;
    expect(w.kind).toBe("cave_mouth");
    expect(caveMap.warps[w.destWarpId!].destMap).toBe(host.header.id);
    expect(s.places.every((p) => p.mapIds.length > 0)).toBe(true);
  }, 240_000);
});

describe("building from the sketch", () => {
  it("names, sizes, sections, levels, steps and Start/Finish come from the sketch and journey", () => {
    const { r, r1, cedar, r3 } = ring();
    buildRegion(r);
    const seg = r1.mapIds.map((id) => byId(r, id));
    expect(seg.map((m) => [m.name, m.width, m.height])).toEqual([
      ["Route 1 (1)", 30, 60],
      ["Route 1 (2)", 30, 60],
    ]);
    expect(seg.every((m) => m.header.region_map_section === "MAPSEC_ROUTE_1" && m.routeId === "route_" + r1.id)).toBe(true);
    expect(r.routes.find((x) => x.id === "route_" + r1.id)!.segmentMapIds).toEqual(r1.mapIds);
    // Route 1 is walked south: in at the north edge, out at the south.
    expect(seg[0].openings.find((o) => o.role === "start")!.edge).toBe("north");
    expect(seg[1].openings.find((o) => o.role === "finish")!.edge).toBe("south");
    // Route 3 is walked north, from Cedar City.
    const r3maps = r3.mapIds.map((id) => byId(r, id));
    expect(r3maps[r3maps.length - 1].openings.find((o) => o.role === "start")!.edge).toBe("south");
    // Levels and the step from the journey; the cave (off the line) takes Route 1's.
    const c = byId(r, cedar.mapIds[0]);
    expect(c.progressionStep).toBe("s2");
    expect(c.params.availableHms).toBe("cut");
    expect(seg[0].params.levelMin).toBeLessThan(c.params.levelMin as number);
  });

  it("refuses to build while the sketch has errors", () => {
    const { r, s } = ring();
    addOutdoor(s, "town", { x: 105, y: 5, w: 30, h: 30 });
    const report = buildRegion(r);
    expect(report.blocked.join(" ")).toMatch(/overlap/);
    expect(r.maps).toHaveLength(0);
  });

  it("building again keeps what's been drawn, resizes on the side that changed, and reports maps no longer in the sketch", () => {
    const { r, s, r1, r4, fir } = ring();
    buildRegion(r);
    const first = byId(r, r1.mapIds[0]);
    first.layers.terrain.data[10 * first.width + 5] = T.flowers;
    const firTown = byId(r, fir.mapIds[0]);
    firTown.layers.terrain.data[3] = T.sand;

    // Fir Town grows 10 to the west (and Route 1 moves with it so they still meet).
    fir.rects[0] = { x: 90, y: 0, w: 40, h: 30 };
    const again = buildRegion(r);
    expect(again.blocked).toEqual([]);
    expect(again.created).toEqual([]);
    expect(byId(r, r1.mapIds[0])).toBe(first);
    expect(first.layers.terrain.data[10 * first.width + 5]).toBe(T.flowers);
    // Grown on the west: what was at x 3 is now at x 13.
    expect(firTown.width).toBe(40);
    expect(firTown.layers.terrain.data[13]).toBe(T.sand);
    expect(again.needsGenerate).toContain(firTown.id);

    // Route 4 is deleted from the sketch: its maps stay, reported.
    const gone = [...r4.mapIds];
    s.places = s.places.filter((p) => p !== r4);
    s.journey.stops = s.journey.stops.filter((id) => id !== r4.id);
    const third = buildRegion(r);
    expect(third.orphans.sort()).toEqual(gone.sort());
    expect(r.maps.filter((m) => gone.includes(m.id))).toHaveLength(2);
  });

  it("a forest that splits a route gets an entrance with a warp at each end", () => {
    const r = newRegion("r", 2);
    const s = newSketch(200, 300);
    r.sketch = s;
    const south = addOutdoor(s, "route", { x: 0, y: 200, w: 30, h: 90 });
    const north = addOutdoor(s, "route", { x: 0, y: 0, w: 30, h: 90 });
    const forest = addInside(s, "forest", { x: 15, y: 205 });
    forest.pins.push({ x: 15, y: 80 });
    s.journey.stops = [south.id, forest.id, north.id];
    const report = buildRegion(r);
    generateAll(r, report.needsGenerate);
    const f = byId(r, forest.mapIds[0]);
    expect(f.openings.map((o) => [o.edge, o.role])).toEqual([
      ["south", "start"],
      ["north", "finish"],
    ]);
    for (const m of r.maps) {
      const errors = validateMap(m, { otherMaps: r.maps }).filter((i) => i.severity === "error");
      expect(errors.map((e) => `${m.name}: ${e.code} ${e.message}`)).toEqual([]);
    }
    // Both forest gates lead to a route, and back.
    for (const w of f.warps.filter((x) => x.locked && x.kind === "other")) {
      const route = r.maps.find((m) => m.header.id === w.destMap)!;
      expect(route.warps[w.destWarpId!].destMap).toBe(f.header.id);
    }
  }, 120_000);
});
