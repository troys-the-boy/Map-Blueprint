// Milestone 6, part D: the journey line (order, levels, progression steps, Start and Finish).

import { describe, expect, it } from "vitest";
import { facingSide, journeyLine, levelBand, planJourney } from "../src/core/journey";
import { newRegion } from "../src/core/model";
import { parseProject, serializeProject } from "../src/core/project";
import { addInside, addOutdoor, newSketch, sketchIssues } from "../src/core/sketch";

/**
 * Fir Town (top) → Route 1 south (200 long, 3 segments), bending east → Cedar City,
 * with Moss Cave on Route 1 and a side Town off the line.
 */
function region() {
  const r = newRegion("r", 1);
  const s = newSketch();
  r.sketch = s;
  const fir = addOutdoor(s, "town", { x: 100, y: 0, w: 30, h: 30 });
  fir.name = "Fir Town";
  const route = addOutdoor(s, "route", { x: 100, y: 30, w: 30, h: 200 });
  addOutdoor(s, "route", { x: 130, y: 200, w: 90, h: 30 }, route);
  const cedar = addOutdoor(s, "town", { x: 220, y: 190, w: 50, h: 50 });
  cedar.name = "Cedar City";
  const cave = addInside(s, "cave", { x: 110, y: 120 });
  return { r, s, fir, route, cedar, cave };
}

describe("journey basics", () => {
  it("knows which side two rectangles meet on", () => {
    const a = { x: 0, y: 0, w: 30, h: 90 };
    expect(facingSide(a, { x: 0, y: 90, w: 30, h: 30 })).toBe("south");
    expect(facingSide(a, { x: 0, y: -30, w: 30, h: 30 })).toBe("north");
    expect(facingSide(a, { x: 30, y: 40, w: 30, h: 30 })).toBe("east");
    expect(facingSide(a, { x: -30, y: 40, w: 30, h: 30 })).toBe("west");
    expect(facingSide(a, { x: 30, y: 90, w: 30, h: 30 })).toBeNull();
  });

  it("spreads the level curve evenly along the journey", () => {
    const curve = { start: 3, end: 60 };
    expect(levelBand(0, 3, curve)).toEqual({ min: 3, max: 22 });
    expect(levelBand(2, 3, curve)).toEqual({ min: 41, max: 60 });
  });
});

describe("planning the journey", () => {
  it("gives each stop its order and levels; places off the line take their route's", () => {
    const { r, s, fir, route, cedar, cave } = region();
    s.journey.stops = [fir.id, route.id, cedar.id];
    const plan = planJourney(s, r);
    expect([fir, route, cedar].map((p) => plan.places.get(p.id)!.stop)).toEqual([0, 1, 2]);
    expect(plan.places.get(route.id)!.levels).toEqual({ min: 22, max: 41 });
    // The cave is off the line, on Route 1: it gets Route 1's order and levels.
    expect(plan.places.get(cave.id)).toMatchObject({ stop: null, order: 1, levels: { min: 22, max: 41 } });
    expect(plan.problems).toEqual([]);
  });

  it("sets each route segment's Start and Finish the way the player walks", () => {
    const { r, s, fir, route, cedar } = region();
    s.journey.stops = [fir.id, route.id, cedar.id];
    const pieces = planJourney(s, r).places.get(route.id)!.pieces;
    // 3 segments going south (the last one left by its east side, where the route bends),
    // then the stretch east (90 long: one map).
    expect(pieces.map((p) => [p.rect, p.from, p.to])).toEqual([
      [0, "north", "south"],
      [0, "north", "south"],
      [0, "north", "east"],
      [1, "west", "east"],
    ]);
    expect(pieces.map((p) => p.y)).toEqual([30, 95, 165, 200]);
  });

  it("walked the other way, the order and edges flip", () => {
    const { r, s, fir, route, cedar } = region();
    s.journey.stops = [cedar.id, route.id, fir.id];
    const pieces = planJourney(s, r).places.get(route.id)!.pieces;
    expect(pieces.map((p) => [p.rect, p.from, p.to])).toEqual([
      [1, "east", "west"],
      [0, "east", "north"],
      [0, "south", "north"],
      [0, "south", "north"],
    ]);
    expect(pieces.map((p) => p.y)).toEqual([200, 165, 95, 30]);
  });

  it("a forest that splits a route: in by one pin, out by the other", () => {
    const r = newRegion("r", 1);
    const s = newSketch();
    r.sketch = s;
    const south = addOutdoor(s, "route", { x: 0, y: 200, w: 30, h: 90 });
    const north = addOutdoor(s, "route", { x: 0, y: 0, w: 30, h: 90 });
    const forest = addInside(s, "forest", { x: 10, y: 205 });
    forest.pins.push({ x: 10, y: 80 });
    s.journey.stops = [south.id, forest.id, north.id];
    const plan = planJourney(s, r);
    expect(plan.places.get(forest.id)).toMatchObject({ entryPin: 0, exitPin: 1 });
    // South half: walked north into the forest; north half: walked north out of it.
    expect(plan.places.get(south.id)!.pieces.map((p) => [p.from, p.to])).toEqual([["south", "north"]]);
    expect(plan.places.get(north.id)!.pieces.map((p) => [p.from, p.to])).toEqual([["south", "north"]]);
    expect(plan.problems).toEqual([]);
  });

  it("finds stops that don't meet, and places left off", () => {
    const { r, s, fir, cedar, route } = region();
    s.journey.stops = [fir.id, cedar.id];
    const problems = planJourney(s, r).problems;
    expect(problems.some((p) => p.severity === "error" && /don't meet/.test(p.message))).toBe(true);
    expect(problems.some((p) => p.placeId === route.id && /isn't on the journey/.test(p.message))).toBe(true);
  });

  it("a progression step lasts from where it starts to the next step", () => {
    const { r, s, fir, route, cedar } = region();
    r.progression = [
      { id: "s1", name: "Start", badges: 0, hms: [] },
      { id: "s2", name: "After badge 1", badges: 1, hms: ["cut"] },
    ];
    s.journey.stops = [fir.id, route.id, cedar.id];
    s.journey.stepStarts = { s1: 0, s2: 2 };
    const plan = planJourney(s, r);
    expect([fir, route, cedar].map((p) => plan.places.get(p.id)!.stepId)).toEqual(["s1", "s1", "s2"]);
    // Out of order with the list: a warning.
    s.journey.stepStarts = { s1: 2, s2: 0 };
    expect(planJourney(s, r).problems.some((p) => /comes before it/.test(p.message))).toBe(true);
  });

  it("draws a line through the towns, the route's maps and forest or cave entrances", () => {
    const { r, s, fir, route, cedar, cave } = region();
    s.journey.stops = [fir.id, route.id, cave.id, cedar.id];
    const line = journeyLine(s, planJourney(s, r));
    expect(line.slice(0, 2)).toEqual([115, 15]);
    expect(line.slice(-2)).toEqual([245, 215]);
    expect(line).toContain(110.5);
  });
});

describe("saving the journey", () => {
  it("round-trips, and older sketches (format 12) get an empty one", () => {
    const { r, s, fir, route } = region();
    r.progression = [{ id: "s1", name: "Start", badges: 0, hms: [] }];
    s.journey = { stops: [fir.id, route.id, fir.id], stepStarts: { s1: 2 } };
    const loaded = parseProject(serializeProject(r, "test"));
    expect(loaded.sketch!.journey).toEqual(s.journey);
    const file = JSON.parse(serializeProject(r, "test"));
    file.schemaVersion = 12;
    delete file.region.sketch.journey;
    expect(parseProject(JSON.stringify(file)).sketch!.journey).toEqual({ stops: [], stepStarts: {} });
  });

  it("rejects a journey naming a place that isn't there, or a step at a stop that isn't there", () => {
    const { r, s, fir } = region();
    s.journey.stops = ["p99"];
    expect(() => parseProject(serializeProject(r, "test"))).toThrow(/journey\.stops\[0\]/);
    s.journey = { stops: [fir.id], stepStarts: { s1: 1 } };
    expect(() => parseProject(serializeProject(r, "test"))).toThrow(/stepStarts/);
  });

  it("format 13 steps (started at a place) become that place's stop", () => {
    const { r, s, fir, route, cedar } = region();
    s.journey.stops = [fir.id, route.id, cedar.id];
    const file = JSON.parse(serializeProject(r, "test"));
    file.schemaVersion = 13;
    file.region.sketch.journey.stepStarts = { s1: fir.id, s2: cedar.id, s3: "p99" };
    expect(parseProject(JSON.stringify(file)).sketch!.journey.stepStarts).toEqual({ s1: 0, s2: 2 });
  });
});

describe("going back through a place", () => {
  it("keeps the levels, step and Start/Finish of its first visit", () => {
    const { r, s, fir, route, cedar } = region();
    r.progression = [
      { id: "s1", name: "Start", badges: 0, hms: [] },
      { id: "s2", name: "Surf", badges: 4, hms: ["surf"] },
    ];
    // Fir Town → Route 1 → Cedar City, then back through Route 1 to Fir Town with Surf.
    s.journey.stops = [fir.id, route.id, cedar.id, route.id, fir.id];
    s.journey.stepStarts = { s1: 0, s2: 3 };
    const plan = planJourney(s, r);
    const rp = plan.places.get(route.id)!;
    expect(rp).toMatchObject({ stop: 1, visits: [1, 3], order: 1, stepId: "s1" });
    expect(plan.places.get(fir.id)).toMatchObject({ stop: 0, visits: [0, 4], stepId: "s1" });
    // Levels are spread over the 3 places, not the 5 stops.
    expect(plan.places.get(cedar.id)!.levels).toEqual({ min: 41, max: 60 });
    // The route's maps keep their first trip's direction (south, then east)…
    expect(rp.pieces[0].from).toBe("north");
    // …while the line follows the way back too.
    expect(plan.stops[3]).toMatchObject({ placeId: route.id, first: false });
    expect(plan.stops[3].pieces[0].from).toBe("east");
    expect(plan.problems).toEqual([]);
  });

  it("a route entered from its long side starts at the segment that place touches", () => {
    const r = newRegion("r", 1);
    const s = newSketch();
    r.sketch = s;
    // A long east–west route (2 segments) with a city sitting on top of its east end, and a town at its west end.
    const route = addOutdoor(s, "route", { x: 100, y: 100, w: 150, h: 30 });
    const city = addOutdoor(s, "town", { x: 200, y: 60, w: 40, h: 40 });
    const town = addOutdoor(s, "town", { x: 70, y: 100, w: 30, h: 30 });
    s.journey.stops = [city.id, route.id, town.id];
    const pieces = planJourney(s, r).places.get(route.id)!.pieces;
    expect(pieces.map((p) => [p.x, p.from, p.to])).toEqual([
      [175, "north", "west"],
      [100, "east", "west"],
    ]);
  });
});

describe("Start and Finish over many routes", () => {
  it("each map is left by the edge facing the next one, which is entered by the opposite edge", () => {
    const OPP: Record<string, string> = { north: "south", south: "north", east: "west", west: "east" };
    let checked = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const r = newRegion("r", 1);
      const s = newSketch(4000, 4000);
      r.sketch = s;
      // A random chain of 2–4 stretches turning left or right, between two towns. Each stretch
      // starts beside the 30×30 end square of the one before.
      const beside = (end: { x: number; y: number }, d: number, len: number) =>
        d === 0 ? { x: end.x, y: end.y - len, w: 30, h: len } : d === 1 ? { x: end.x + 30, y: end.y, w: len, h: 30 } : d === 2 ? { x: end.x, y: end.y + 30, w: 30, h: len } : { x: end.x - len, y: end.y, w: len, h: 30 };
      const endOf = (r: { x: number; y: number; w: number; h: number }, d: number) => ({ x: d === 1 ? r.x + r.w - 30 : r.x, y: d === 2 ? r.y + r.h - 30 : r.y });
      const startTown = addOutdoor(s, "town", { x: 2000, y: 2000, w: 30, h: 30 });
      let dir = 2;
      let last = beside(startTown.rects[0], dir, 120 + (seed % 5) * 30);
      const route = addOutdoor(s, "route", last);
      const turns = 1 + (seed % 3);
      for (let t = 0; t < turns; t++) {
        const end = endOf(last, dir);
        dir = (dir + ((seed >> t) % 2 ? 1 : 3)) % 4;
        last = beside(end, dir, 60 + ((seed * (t + 3)) % 4) * 40);
        addOutdoor(s, "route", last, route);
      }
      const end = endOf(last, dir);
      const endTown = addOutdoor(s, "town", beside(end, dir, 30));
      // Three turns the same way can curl back over the route: skip those.
      if (sketchIssues(s, 90).some((i) => i.severity === "error")) continue;
      checked++;
      for (const stops of [
        [startTown.id, route.id, endTown.id],
        [endTown.id, route.id, startTown.id],
      ]) {
        s.journey.stops = stops;
        const plan = planJourney(s, r);
        const pieces = plan.places.get(route.id)!.pieces;
        expect(pieces.length, `seed ${seed}`).toBeGreaterThan(1);
        for (let k = 0; k + 1 < pieces.length; k++) {
          expect(pieces[k].to, `seed ${seed} piece ${k}`).toBe(facingSide(pieces[k], pieces[k + 1]));
          expect(pieces[k + 1].from, `seed ${seed} piece ${k + 1}`).toBe(OPP[pieces[k].to!]);
        }
        for (const p of pieces) expect(p.from && p.to && p.from !== p.to, `seed ${seed}`).toBe(true);
      }
    }
    expect(checked).toBeGreaterThan(40);
  });
});
