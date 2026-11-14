// Land and settlements, part E: roads that read the terrain. They cut their own
// stairs where they climb, cross water in a straight line, and follow roads already laid.

import { describe, expect, it } from "vitest";
import { generateRoute } from "../src/core/generate";
import { T, cheapestPath, cheapestRoad } from "../src/core/grid";
import { addNewMap, newRegion } from "../src/core/model";
import type { MapBlueprint, MapType } from "../src/core/model";
import { MoveGraph, openingCells } from "../src/core/reach";
import { newZone } from "../src/core/zones";

function map(type: MapType, w: number, h: number, seed: number): MapBlueprint {
  return addNewMap(newRegion("r", 1), { name: "Place", mapType: type, width: w, height: h, seed, biome: "temperate_rainforest" });
}
function zone(m: MapBlueprint, kind: "height" | "water", data: Record<string, string | number>, test: (x: number, y: number) => boolean) {
  const z = newZone(m, kind, data);
  z.hard = true;
  for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width; x++) if (test(x, y)) z.mask.data[y * m.width + x] = 1;
  m.layers.zones.push(z);
}
const count = (data: Uint8Array, t: number) => data.reduce((n, v) => n + (v === t ? 1 : 0), 0);

describe("the road search", () => {
  const W = 9;
  const H = 7;
  const at = (x: number, y: number) => y * W + x;

  it("on open ground it's as cheap as the plain search", () => {
    const cost = (i: number) => 1 + ((i * 7) % 5);
    const a = cheapestPath(W, H, at(0, 0), at(8, 6), cost)!;
    const b = cheapestRoad(W, H, at(0, 0), at(8, 6), cost)!;
    const total = (p: number[]) => p.slice(1).reduce((s, c) => s + cost(c), 0);
    expect(total(b)).toBe(total(a));
    expect([b[0], b[b.length - 1]]).toEqual([at(0, 0), at(8, 6)]);
  });

  it("goes straight through a gate, never along it or round a corner in it", () => {
    // A wall across the middle (row 3) with one gate at x = 6, crossed north–south only.
    const wall = (i: number) => Math.floor(i / W) === 3 && i % W !== 6;
    const cost = (i: number) => (wall(i) ? Infinity : 1);
    const gate = (i: number) => (i === at(6, 3) ? 2 : 0);
    const road = cheapestRoad(W, H, at(0, 0), at(0, 6), cost, { gate })!;
    const k = road.indexOf(at(6, 3));
    expect(k).toBeGreaterThan(0);
    expect([road[k - 1], road[k + 1]]).toEqual([at(6, 2), at(6, 4)]);
    // A gate crossed the wrong way is no way through: here it only runs east–west.
    expect(cheapestRoad(W, H, at(0, 0), at(0, 6), cost, { gate: (i) => (i === at(6, 3) ? 1 : 0) })).toBeNull();
  });

  it("doesn't turn on water", () => {
    // Water in rows 2 to 4; start and end are offset sideways, so a plain search cuts the corner on the water.
    const water = (i: number) => Math.floor(i / W) >= 2 && Math.floor(i / W) <= 4;
    const cost = (i: number) => (water(i) ? 3 : 1);
    const road = cheapestRoad(W, H, at(1, 0), at(7, 6), cost, { straight: water })!;
    const wet = road.filter(water);
    expect(wet).toHaveLength(3);
    expect(new Set(wet.map((c) => c % W)).size).toBe(1);
  });

  it("follows cheap cells (a road already there) when told the least cost", () => {
    // A road along row 6 costs 0.2 a cell: going down to it and along is cheaper than straight across.
    const cost = (i: number) => (Math.floor(i / W) === 6 ? 0.2 : 1);
    const road = cheapestRoad(W, H, at(0, 4), at(8, 4), cost, { least: 0.2 })!;
    expect(road.filter((c) => Math.floor(c / W) === 6).length).toBeGreaterThanOrEqual(7);
  });

  it("charges for turns when asked", () => {
    const turns = (p: number[]) => {
      let n = 0;
      for (let k = 2; k < p.length; k++) if (p[k] - p[k - 1] !== p[k - 1] - p[k - 2]) n++;
      return n;
    };
    const road = cheapestRoad(W, H, at(0, 0), at(8, 6), () => 1, { turn: 5 })!;
    expect(turns(road)).toBe(1);
  });
});

describe("routes over hills", () => {
  it("the path cuts its own stairs and runs straight over them", () => {
    let direct = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const m = map("route", 30, 60, seed);
      zone(m, "height", { level: 1 }, (_x, y) => y < 30);
      const res = generateRoute(m);
      expect(res.ok, `seed ${seed}: ${res.issues.filter((i) => i.severity === "error").map((i) => i.message)}`).toBe(true);
      const path = (x: number, y: number) => x >= 0 && y >= 0 && x < 30 && y < 60 && (res.terrain[y * 30 + x] === T.path || res.terrain[y * 30 + x] === T.ground);
      // A flight of stairs with path leading up to its foot and away from its top, in line.
      let over = false;
      for (let i = 0; i < res.terrain.length; i++) {
        if (res.terrain[i] !== T.stairs) continue;
        const x = i % 30;
        const y = (i - x) / 30;
        if ((res.terrain[(y - 2) * 30 + x] === T.path && res.terrain[(y + 2) * 30 + x] === T.path) || (res.terrain[y * 30 + x - 2] === T.path && res.terrain[y * 30 + x + 2] === T.path)) over = true;
        expect(path(x, y - 1) || path(x - 1, y)).toBe(true);
      }
      if (over) direct++;
      // Few flights: the path's own, not one in every stretch of cliff.
      expect(count(res.terrain, T.stairs)).toBeLessThanOrEqual(5);
    }
    expect(direct).toBeGreaterThanOrEqual(8);
  });

  it("the way through is short: it climbs near the straight line, not at the far side", () => {
    for (let seed = 1; seed <= 8; seed++) {
      const m = map("route", 40, 60, seed);
      // (No ledge rows: those make the path wind on purpose.)
      m.params = { winding: 0, branches: 0, ledges: 0 };
      zone(m, "height", { level: 1 }, (_x, y) => y < 30);
      const res = generateRoute(m);
      expect(res.ok).toBe(true);
      // Walking from the south entrance to the north one takes little more than the map's length.
      const starts = openingCells(res.openings.find((o) => o.edge === "south")!, 40, 60);
      const goal = openingCells(res.openings.find((o) => o.edge === "north")!, 40, 60);
      const graph = new MoveGraph({ width: 40, height: 60, terrain: res.terrain, entities: res.entities, elevation: res.elevation }, new Set());
      const dist = new Int32Array(40 * 60).fill(-1);
      const queue = [...starts];
      for (const s of starts) dist[s] = 0;
      for (let k = 0; k < queue.length; k++)
        for (let d = 0; d < 4; d++) {
          const j = graph.out[queue[k] * 4 + d];
          if (j >= 0 && dist[j] < 0) (dist[j] = dist[queue[k]] + 1, queue.push(j));
        }
      const steps = Math.min(...goal.map((c) => dist[c]).filter((d) => d >= 0));
      expect(steps, `seed ${seed}`).toBeLessThan(60 + 35);
    }
  });
});

describe("crossing water", () => {
  it("bridges run straight across a river, at right angles", () => {
    let bridges = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const m = map("route", 30, 60, seed);
      // A river right across the map, 4 wide.
      zone(m, "water", { water: "river", depth: "deep" }, (_x, y) => y >= 28 && y < 32);
      const res = generateRoute(m);
      expect(res.ok, `seed ${seed}: ${res.issues.filter((i) => i.severity === "error").map((i) => i.message)}`).toBe(true);
      const cells: number[] = [];
      for (let i = 0; i < res.terrain.length; i++) if (res.terrain[i] === T.bridge) cells.push(i);
      expect(cells.length, `seed ${seed}`).toBeGreaterThanOrEqual(4);
      // Every bridge is one straight line of cells, right across the river: no bridge bends or runs along it.
      // (Only the river itself, rows 28 to 31: a later stage may wet the bank beside it.)
      const left = new Set(cells.filter((c) => Math.floor(c / 30) >= 28 && Math.floor(c / 30) < 32));
      while (left.size) {
        const start = left.values().next().value as number;
        const group = [start];
        left.delete(start);
        for (let k = 0; k < group.length; k++)
          for (const d of [1, -1, 30, -30]) {
            const j = group[k] + d;
            if (left.has(j) && (Math.abs(d) === 30 || Math.floor(j / 30) === Math.floor(group[k] / 30))) (left.delete(j), group.push(j));
          }
        const xs = new Set(group.map((c) => c % 30));
        const ys = new Set(group.map((c) => Math.floor(c / 30)));
        expect(xs.size === 1 || ys.size === 1, `seed ${seed}: a bridge of ${group.length} cells bends`).toBe(true);
        // It crosses the river (4 wide, running east–west), so it runs north–south.
        expect(xs.size, `seed ${seed}`).toBe(1);
        expect(group.length).toBe(4);
      }
      bridges++;
    }
    expect(bridges).toBe(10);
  });
});

describe("towns", () => {
  it("winding lanes climb a hill across the town by stairs they cut", () => {
    for (let seed = 1; seed <= 8; seed++) {
      const m = map("town", 40, 40, seed);
      m.params = { townLayout: "organic", houses: 5 };
      zone(m, "height", { level: 1 }, (_x, y) => y < 20);
      const res = generateRoute(m);
      expect(res.ok, `seed ${seed}: ${res.issues.filter((i) => i.severity === "error").map((i) => i.message)}`).toBe(true);
      expect(count(res.terrain, T.stairs)).toBeGreaterThanOrEqual(1);
    }
  });

  it("a grid town across a hill is still joined up", () => {
    for (let seed = 1; seed <= 8; seed++) {
      const m = map("town", 40, 40, seed);
      m.params = { townLayout: "grid" };
      zone(m, "height", { level: 1 }, (_x, y) => y < 20);
      const res = generateRoute(m);
      expect(res.ok, `seed ${seed}`).toBe(true);
    }
  });
});
