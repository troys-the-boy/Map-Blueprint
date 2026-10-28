// Milestone 6, part A: the Start and Finish entrances (replacing the travel direction setting).

import { describe, expect, it } from "vitest";
import { applyResult, generateRoute } from "../src/core/generate";
import type { GenerateResult } from "../src/core/generate";
import { T } from "../src/core/grid";
import { addNewMap, newRegion } from "../src/core/model";
import type { Edge, MapBlueprint, Opening } from "../src/core/model";
import { CURRENT_SCHEMA_VERSION, parseProject, serializeProject } from "../src/core/project";
import { ledgeDir, markTravel, progress, travelFromOpenings, travelProblem } from "../src/core/generators/travel";

const gap = (id: string, edge: Edge, start: number, role?: "start" | "finish"): Opening => ({ id, edge, start, width: 3, kind: "walk", ...(role ? { role } : {}) });

function route(openings: Opening[], seed: number, size: [number, number], extra: Record<string, number> = {}, mapType: "route" | "forest" | "town" = "route") {
  const region = newRegion("r", 1);
  const map = addNewMap(region, { name: "Route 5", mapType, width: size[0], height: size[1], seed, biome: "meadow" });
  map.params = { ...extra };
  map.openings = openings;
  return { region, map };
}

const ledges = (r: GenerateResult, t: number) => Array.from(r.terrain).filter((x) => x === t).length;
const errors = (r: GenerateResult) => r.issues.filter((i) => i.severity === "error").map((i) => i.code);

describe("Start and Finish", () => {
  it("give the travel direction; none, one, or both on one edge give none", () => {
    expect(travelFromOpenings([gap("o1", "south", 5, "start"), gap("o2", "north", 5, "finish")])).toEqual({ from: "south", to: "north" });
    expect(travelFromOpenings([gap("o1", "south", 5, "start"), gap("o2", "east", 5, "finish")])).toEqual({ from: "south", to: "east" });
    expect(travelFromOpenings([gap("o1", "south", 5), gap("o2", "north", 5)])).toBeNull();
    expect(travelFromOpenings([gap("o1", "south", 5, "start"), gap("o2", "north", 5)])).toBeNull();
    expect(travelFromOpenings([gap("o1", "south", 5, "start"), gap("o2", "south", 15, "finish")])).toBeNull();
    expect(travelProblem([gap("o1", "south", 5, "start")])).toMatch(/Finish/);
    expect(travelProblem([gap("o1", "south", 5, "start"), gap("o2", "south", 15, "finish")])).toMatch(/same edge/);
    expect(travelProblem([gap("o1", "south", 5)])).toBeNull();
  });

  it("ledges jump back toward the start, or forward when that would be north", () => {
    expect(ledgeDir({ from: "south", to: "north" })).toBe("s");
    expect(ledgeDir({ from: "west", to: "north" })).toBe("w");
    expect(ledgeDir({ from: "north", to: "south" })).toBe("s");
    expect(ledgeDir({ from: "north", to: "east" })).toBe("e");
  });

  it("progress runs from 0 at the start's edge to 1 at the finish's, on straight routes and bends", () => {
    expect(progress({ from: "south", to: "north" }, 5, 69, 30, 70)).toBe(0);
    expect(progress({ from: "south", to: "north" }, 5, 0, 30, 70)).toBe(1);
    expect(progress({ from: "south", to: "north" }, 5, 35, 30, 70)).toBeCloseTo(34 / 69);
    // A bend from the south edge to the east edge: the south-west corner is the start, the north-east the finish.
    expect(progress({ from: "south", to: "east" }, 0, 49, 50, 50)).toBe(0);
    expect(progress({ from: "south", to: "east" }, 49, 0, 50, 50)).toBe(1);
    expect(progress({ from: "south", to: "east" }, 25, 25, 50, 50)).toBeCloseTo(0.5, 1);
  });

  it("marked on hand-placed entrances, a straight route behaves as with the old setting", () => {
    for (let seed = 1; seed <= 15; seed++) {
      const { map } = route([gap("o1", "west", 13, "start"), gap("o2", "east", 13, "finish")], seed, [70, 30], { elevation: 0.6, ledges: 2 });
      const r = generateRoute(map);
      expect(r.ok, `seed ${seed}: ${errors(r)}`).toBe(true);
      // Going west to east, no ledge jumps forward (east).
      expect(ledges(r, T.ledgeE), `seed ${seed}`).toBe(0);
      const sign = r.entities.find((e) => e.kind === "sign");
      if (sign) expect(sign.x, `seed ${seed} sign`).toBeLessThan(12);
    }
  });

  it("routes that bend pass the checks, with ledge rows jumping back toward the start", () => {
    const bends: Array<[Edge, Edge]> = [
      ["south", "east"],
      ["west", "north"],
      ["east", "south"],
      ["north", "west"],
    ];
    const at = (edge: Edge, size: number) => (edge === "north" || edge === "south" ? Math.floor(size / 2) : Math.floor(size / 2) - 1);
    for (const [from, to] of bends) {
      let back = 0;
      for (let seed = 1; seed <= 25; seed++) {
        const { map } = route([gap("o1", from, at(from, 50), "start"), gap("o2", to, at(to, 50), "finish")], seed, [50, 50], { ledges: 2, elevation: 0 });
        const r = generateRoute(map);
        expect(r.ok, `${from}→${to} seed ${seed}: ${errors(r)}`).toBe(true);
        const t = { from, to };
        const dir = ledgeDir(t);
        back += ledges(r, dir === "s" ? T.ledgeS : dir === "e" ? T.ledgeE : T.ledgeW);
      }
      expect(back, `${from}→${to}`).toBeGreaterThan(0);
    }
  }, 120_000);

  it("a forest with a Start and Finish gets ledge shortcuts", () => {
    let n = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const { map } = route([gap("o1", "south", 24, "start"), gap("o2", "north", 24, "finish")], seed, [50, 50], { ledges: 2 }, "forest");
      const r = generateRoute(map);
      expect(r.ok, `seed ${seed}: ${errors(r)}`).toBe(true);
      n += ledges(r, T.ledgeS);
    }
    expect(n).toBeGreaterThan(0);
  });

  it("towns ignore Start and Finish", () => {
    const { map } = route([gap("o1", "south", 14, "start"), gap("o2", "north", 14, "finish")], 1, [30, 30], {}, "town");
    const plain = route([gap("o1", "south", 14), gap("o2", "north", 14)], 1, [30, 30], {}, "town").map;
    expect(Array.from(generateRoute(map).terrain)).toEqual(Array.from(generateRoute(plain).terrain));
  });
});

describe("older maps with the travel direction setting", () => {
  it("markTravel marks the first walk entrance on each end's edge", () => {
    const marked = markTravel([gap("o1", "north", 5), { ...gap("o2", "south", 1), kind: "surf" }, gap("o3", "south", 9)], "north_south");
    expect(marked.map((o) => o.role)).toEqual(["start", undefined, "finish"]);
    expect(markTravel([gap("o1", "north", 5, "start")], "auto")[0].role).toBeUndefined();
  });

  it("automatic entrances: the next Generate marks them and drops the old setting", () => {
    const { map } = route([], 2, [30, 70], { travel: "south_north" } as unknown as Record<string, number>);
    applyResult(map, generateRoute(map));
    expect(travelFromOpenings(map.openings)).toEqual({ from: "south", to: "north" });
    expect("travel" in map.params).toBe(false);
  });

  it("file format 9 → 10 marks Start and Finish on entrances, and moves segment length 80 to 90", () => {
    const { region, map } = route([gap("o1", "north", 5), gap("o2", "south", 5)], 1, [30, 70]);
    region.settings.targetSegmentLength = 80;
    const file = JSON.parse(serializeProject(region, "test"));
    file.schemaVersion = 9;
    file.region.maps[0].params = { travel: "north_south", grass: 0.4 };
    expect(CURRENT_SCHEMA_VERSION).toBeGreaterThanOrEqual(10);
    const loaded = parseProject(JSON.stringify(file));
    const m = loaded.maps[0] as MapBlueprint;
    expect(m.openings.map((o) => o.role)).toEqual(["start", "finish"]);
    expect(m.params).toEqual({ grass: 0.4 });
    expect(loaded.settings.targetSegmentLength).toBe(90);
    expect(map.openings[0].role).toBeUndefined();
  });

  it("new regions aim for segments of 90", () => {
    expect(newRegion("r", 1).settings.targetSegmentLength).toBe(90);
  });
});
