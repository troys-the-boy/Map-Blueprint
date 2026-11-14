// Land and settlements, part B: paths to buildings painted by hand, and hill towns
// that build on their slopes.

import { describe, expect, it } from "vitest";
import { applyResult, generateRoute } from "../src/core/generate";
import { IS_WALKABLE, T } from "../src/core/grid";
import { addNewMap, newRegion } from "../src/core/model";
import type { LandStyle, MapBlueprint, MapType, Opening } from "../src/core/model";
import { MoveGraph, openingCells } from "../src/core/reach";
import { ELEVATION_LEVELS } from "../src/core/terrain";

function make(mapType: MapType, style: LandStyle, seed: number, w = 40, h = 40): MapBlueprint {
  const m = addNewMap(newRegion("r", 1), { name: "Place", mapType, width: w, height: h, seed, biome: "temperate_rainforest" });
  m.style = style;
  m.settlement = "none";
  if (style === "cave") m.openings = edgeOpenings(w);
  return m;
}

const edgeOpenings = (w: number): Opening[] => [
  { id: "o1", edge: "south", start: Math.floor(w / 2) - 1, width: 3, kind: "walk" },
  { id: "o2", edge: "north", start: Math.floor(w / 2) - 1, width: 3, kind: "walk" },
];

/** Paint a locked building, as the pencil does. */
function paintBuilding(m: MapBlueprint, x: number, y: number, w: number, h: number) {
  for (let yy = y; yy < y + h; yy++)
    for (let xx = x; xx < x + w; xx++) {
      const i = yy * m.width + xx;
      m.layers.terrain.data[i] = T.building;
      m.layers.locks.data[i] = 1;
    }
}

/** Can the player walk from an entrance to this cell? */
function reachable(m: MapBlueprint, res: ReturnType<typeof generateRoute>, cell: number): boolean {
  const starts = res.openings.filter((o) => o.kind === "walk").flatMap((o) => openingCells(o, m.width, m.height));
  const reach = new MoveGraph({ width: m.width, height: m.height, terrain: res.terrain, entities: res.entities, elevation: res.elevation }, new Set()).forward(starts);
  return reach[cell] === 1;
}

describe("paths to buildings you paint", () => {
  const styles: Array<[MapType, LandStyle]> = [
    ["town", "town"],
    ["route", "route"],
    ["forest", "forest"],
    ["town", "cave"],
  ];
  for (const [mapType, style] of styles)
    it(`${style}: a painted building gets a door in the middle of its south face and a way to it`, () => {
      for (let seed = 1; seed <= 6; seed++) {
        const m = make(mapType, style, seed);
        // Tucked in a corner, well away from where streets and paths usually run.
        paintBuilding(m, 6, 6, 5, 3);
        const res = generateRoute(m);
        expect(res.ok, `seed ${seed}: ${res.issues.filter((i) => i.severity === "error").map((i) => i.message)}`).toBe(true);
        expect(res.notes ?? []).toEqual([]);
        // The building is untouched.
        for (let y = 6; y < 9; y++) for (let x = 6; x < 11; x++) expect(res.terrain[y * 40 + x]).toBe(T.building);
        // Its door: the middle of the bottom row, leading to its own interior.
        const door = res.warps.find((w) => w.kind === "door" && w.x === 8 && w.y === 8);
        expect(door, `seed ${seed}`).toBeTruthy();
        expect(door!.destMap).toBe("MAP_PLACE_BUILDING1");
        // The step in front is walkable, and the player can get there from an entrance.
        const step = 9 * 40 + 8;
        expect(IS_WALKABLE[res.terrain[step]]).toBe(true);
        expect(reachable(m, res, step), `seed ${seed}`).toBe(true);
        // Nothing stands on the step.
        expect(res.entities.some((e) => e.x === 8 && e.y === 9)).toBe(false);
      }
    });

  it("uses the door you placed, and makes no second one", () => {
    const m = make("town", "town", 2);
    paintBuilding(m, 6, 6, 5, 3);
    m.warps = [{ id: "w1", kind: "door", x: 6, y: 8, elevation: "ground", destMap: "MAP_MY_HOUSE", destWarpId: 0, locked: true }];
    const res = generateRoute(m);
    expect(res.ok).toBe(true);
    const doors = res.warps.filter((w) => w.kind === "door" && w.y === 8 && w.x >= 6 && w.x <= 10);
    expect(doors.map((w) => [w.x, w.destMap])).toEqual([[6, "MAP_MY_HOUSE"]]);
    expect(reachable(m, res, 9 * 40 + 6)).toBe(true);
  });

  it("an odd-shaped building gets its door on its lowest face", () => {
    const m = make("town", "town", 3);
    // An L: a tall part on the left, a wing on the right that stops a row higher.
    paintBuilding(m, 6, 6, 3, 4);
    paintBuilding(m, 9, 6, 3, 3);
    const res = generateRoute(m);
    expect(res.ok).toBe(true);
    const door = res.warps.find((w) => w.kind === "door" && w.y === 9);
    expect(door && [door.x, door.y]).toEqual([7, 9]);
  });

  it("says so when no path can reach a building", () => {
    const m = make("town", "town", 4);
    paintBuilding(m, 6, 6, 5, 3);
    // Locked trees right round it.
    for (let y = 5; y <= 10; y++)
      for (let x = 5; x <= 11; x++) {
        const i = y * 40 + x;
        if (m.layers.locks.data[i]) continue;
        m.layers.terrain.data[i] = T.tree;
        m.layers.locks.data[i] = 1;
      }
    const res = generateRoute(m);
    expect((res.notes ?? []).join(" ")).toMatch(/No path could be drawn to the building you painted at \(8, 8\)/);
  });

  it("generated buildings keep clear of a painted one and its walk", () => {
    const m = make("town", "town", 5);
    m.settlement = "town";
    m.params = { houses: 6 };
    paintBuilding(m, 16, 10, 5, 3);
    const res = generateRoute(m);
    expect(res.ok).toBe(true);
    for (let y = 10; y < 13; y++) for (let x = 16; x < 21; x++) expect(res.terrain[y * 40 + x]).toBe(T.building);
    expect(reachable(m, res, 13 * 40 + 18)).toBe(true);
    // Every door (painted and generated) can be reached.
    for (const w of res.warps.filter((x) => x.kind === "door")) expect(reachable(m, res, (w.y + 1) * 40 + w.x)).toBe(true);
  });
});

describe("hill towns build on their slopes", () => {
  it("about as many buildings stand on the hillsides as in the valley", () => {
    let low = 0;
    let high = 0;
    let fit = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const m = make("town", "town", seed);
      m.settlement = "town";
      m.params = { elevation: 0.8, gym: true, houses: 6 };
      const res = generateRoute(m);
      expect(res.ok, `seed ${seed}`).toBe(true);
      const doors = res.warps.filter((w) => w.kind === "door");
      fit += doors.length;
      for (const d of doors) {
        if (ELEVATION_LEVELS[res.elevation[d.y * 40 + d.x]] === "ground") low++;
        else high++;
        // Up a flight of stairs or not, every door can be reached.
        expect(reachable(m, res, (d.y + 1) * 40 + d.x), `seed ${seed} door (${d.x}, ${d.y})`).toBe(true);
      }
    }
    // Before, every building was in the valley.
    expect(high).toBeGreaterThan(low * 0.5);
    expect(low).toBeGreaterThan(high * 0.3);
    // And nearly all nine buildings fit each time.
    expect(fit).toBeGreaterThanOrEqual(12 * 9 - 6);
  });

  it("a building painted on a hillside stands at the hillside's level, with a way to its door", () => {
    for (const [mapType, style] of [["town", "town"], ["route", "route"]] as const) {
      let raised = 0;
      for (let seed = 1; seed <= 10; seed++) {
        const m = make(mapType, style, seed, 50, 40);
        m.params = { elevation: 0.8 };
        // Near the top edge, where the hills are.
        paintBuilding(m, 20, 5, 5, 3);
        const res = generateRoute(m);
        expect(res.ok, `${style} seed ${seed}: ${res.issues.filter((i) => i.severity === "error").map((i) => i.message)}`).toBe(true);
        expect(res.notes ?? []).toEqual([]);
        const step = 8 * 50 + 22;
        expect(reachable(m, res, step), `${style} seed ${seed}`).toBe(true);
        // The whole building is at the level of the ground in front of its door.
        for (let y = 5; y < 8; y++) for (let x = 20; x < 25; x++) expect(res.elevation[y * 50 + x]).toBe(res.elevation[step]);
        if (ELEVATION_LEVELS[res.elevation[step]] !== "ground") raised++;
        // No cliff touches the building's front.
        for (let x = 20; x < 25; x++) expect(res.terrain[8 * 50 + x]).not.toBe(T.rockWall);
        // Generating again gives the same map: the building doesn't sink or climb.
        applyResult(m, res);
        const again = generateRoute(m);
        expect(Array.from(again.elevation)).toEqual(Array.from(res.elevation));
        expect(Array.from(again.terrain)).toEqual(Array.from(res.terrain));
      }
      // It isn't kept on low ground: on most of these maps it's up on the hill.
      expect(raised, style).toBeGreaterThanOrEqual(5);
    }
  });

  it("a building painted in the valley stays on the valley floor", () => {
    const m = make("town", "town", 3, 50, 40);
    m.params = { elevation: 0.8 };
    paintBuilding(m, 22, 18, 5, 3);
    const res = generateRoute(m);
    expect(res.ok).toBe(true);
    expect(ELEVATION_LEVELS[res.elevation[18 * 50 + 22]]).toBe("ground");
    expect(reachable(m, res, 21 * 50 + 24)).toBe(true);
  });

  it("a flat town is unchanged: every building on the ground", () => {
    const m = make("town", "town", 1);
    m.settlement = "town";
    const res = generateRoute(m);
    for (const d of res.warps.filter((w) => w.kind === "door")) expect(ELEVATION_LEVELS[res.elevation[d.y * 40 + d.x]]).toBe("ground");
  });
});
