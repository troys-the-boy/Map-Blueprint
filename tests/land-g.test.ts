// Land and settlements, part G: fields and outskirts round a town.

import { describe, expect, it } from "vitest";
import { generateRoute } from "../src/core/generate";
import { readTownParams } from "../src/core/generators/townParams";
import { IS_WALKABLE, T, distanceField } from "../src/core/grid";
import { addNewMap, newRegion } from "../src/core/model";
import type { MapBlueprint } from "../src/core/model";
import { MoveGraph, openingCells } from "../src/core/reach";

function town(w: number, h: number, seed: number, params: Record<string, string | number | boolean> = {}): MapBlueprint {
  const m = addNewMap(newRegion("r", 1), { name: "Town", mapType: "town", width: w, height: h, seed });
  m.params = { ...m.params, houses: 5, ...params };
  return m;
}
type Res = ReturnType<typeof generateRoute>;
const count = (r: Res, t: number) => r.terrain.reduce((n, v) => n + (v === t ? 1 : 0), 0);

describe("fields and outskirts", () => {
  it("the setting defaults to 50, and 0 means none", () => {
    expect(readTownParams({}).outskirts).toBe(0.5);
    expect(readTownParams({ outskirts: 7 }).outskirts).toBe(1);
    for (let seed = 1; seed <= 5; seed++) {
      const res = generateRoute(town(60, 60, seed, { outskirts: 0 }));
      expect(count(res, T.mud)).toBe(0);
      expect(count(res, T.waterShallow)).toBe(0);
      expect(res.entities.filter((e) => e.kind === "berry_tree")).toEqual([]);
    }
  });

  it("a town on a big map gets fields, a pond and berry trees; more with a higher setting", () => {
    let low = 0;
    let high = 0;
    let ponds = 0;
    let berries = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const some = generateRoute(town(60, 60, seed, { outskirts: 0.3 }));
      const lots = generateRoute(town(60, 60, seed, { outskirts: 1 }));
      for (const res of [some, lots]) expect(res.ok, `seed ${seed}: ${res.issues.filter((i) => i.severity === "error").map((i) => i.message)}`).toBe(true);
      low += count(some, T.mud) + count(some, T.fence);
      high += count(lots, T.mud) + count(lots, T.fence);
      ponds += count(lots, T.waterShallow);
      berries += lots.entities.filter((e) => e.kind === "berry_tree").length;
      expect(count(some, T.mud), `seed ${seed}`).toBeGreaterThan(5);
    }
    expect(high).toBeGreaterThan(low * 1.3);
    expect(ponds).toBeGreaterThan(40);
    expect(berries).toBeGreaterThanOrEqual(8);
  });

  it("nothing is shut in: every walkable cell inside a fence can be reached, and so can every berry tree", () => {
    for (let seed = 1; seed <= 8; seed++) {
      const m = town(60, 60, seed, { outskirts: 1 });
      const res = generateRoute(m);
      const starts = res.openings.flatMap((o) => openingCells(o, 60, 60));
      const reach = new MoveGraph({ width: 60, height: 60, terrain: res.terrain, entities: res.entities, elevation: res.elevation }, new Set()).forward(starts);
      // Tilled rows are only ever inside a fenced field.
      for (let i = 0; i < res.terrain.length; i++) if (res.terrain[i] === T.mud && !res.entities.some((e) => e.x === i % 60 && e.y === Math.floor(i / 60))) expect(reach[i], `seed ${seed} soil at (${i % 60}, ${Math.floor(i / 60)})`).toBe(1);
      for (const e of res.entities.filter((k) => k.kind === "berry_tree")) {
        // On soft soil, with reachable ground right in front (south).
        expect(res.terrain[e.y * 60 + e.x]).toBe(T.mud);
        expect(reach[(e.y + 1) * 60 + e.x], `seed ${seed} berry ${e.id}`).toBe(1);
        expect(e.fields.trainer_sight_or_berry_tree_id).toMatch(/^BERRY_TREE_TOWN_\d+$/);
      }
      // Berry trees have their own ids.
      const ids = res.entities.map((e) => e.id);
      expect(new Set(ids).size).toBe(ids.length);
      // No warnings about items or doors that can't be reached.
      expect(res.issues.filter((i) => i.code === "unreachable-item" || i.code === "unreachable-warp")).toEqual([]);
    }
  });

  it("keeps off the streets, the buildings' yards and anything locked", () => {
    for (let seed = 1; seed <= 6; seed++) {
      const m = town(50, 50, seed, { outskirts: 0 });
      const plain = generateRoute(m);
      // Lock a patch of ground where fields would like to go.
      const withLock = town(50, 50, seed, { outskirts: 1 });
      for (let y = 30; y < 40; y++)
        for (let x = 5; x < 20; x++) {
          withLock.layers.locks.data[y * 50 + x] = 1;
          withLock.layers.terrain.data[y * 50 + x] = T.ground;
        }
      const res = generateRoute(withLock);
      expect(res.ok).toBe(true);
      for (let y = 30; y < 40; y++) for (let x = 5; x < 20; x++) expect(res.terrain[y * 50 + x]).toBe(T.ground);
      const full = generateRoute(town(50, 50, seed, { outskirts: 1 }));
      // Same streets and buildings with and without outskirts.
      for (let i = 0; i < plain.terrain.length; i++) if (plain.terrain[i] === T.road || plain.terrain[i] === T.building) expect(full.terrain[i]).toBe(plain.terrain[i]);
      expect(full.warps).toEqual(plain.warps);
      // Fields stand off from the buildings: no tilled soil within 2 cells of a wall.
      const built: number[] = [];
      for (let i = 0; i < full.terrain.length; i++) if (full.terrain[i] === T.building) built.push(i);
      const d = distanceField(50, 50, built);
      for (let i = 0; i < full.terrain.length; i++) if (full.terrain[i] === T.mud) expect(d[i]).toBeGreaterThanOrEqual(3);
    }
  });

  it("orchard trees stand apart, so the player can walk between them", () => {
    let orchards = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const res = generateRoute(town(60, 60, seed, { outskirts: 1, treeDensity: 0 }));
      // A 3×3 block with a tree at each corner and ground between: the orchard's pattern.
      for (let y = 3; y < 55; y++)
        for (let x = 3; x < 55; x++) {
          const t = (dx: number, dy: number) => res.terrain[(y + dy) * 60 + x + dx];
          if (t(0, 0) === T.tree && t(2, 0) === T.tree && t(0, 2) === T.tree && t(2, 2) === T.tree && IS_WALKABLE[t(1, 0)] && IS_WALKABLE[t(0, 1)] && IS_WALKABLE[t(1, 1)]) orchards++;
        }
    }
    expect(orchards).toBeGreaterThan(10);
  });

  it("the land gets wilder away from the town", () => {
    let near = 0;
    let nearCells = 0;
    let far = 0;
    let farCells = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const res = generateRoute(town(70, 70, seed, { outskirts: 0.5 }));
      const built: number[] = [];
      for (let i = 0; i < res.terrain.length; i++) if (res.terrain[i] === T.building) built.push(i);
      const d = distanceField(70, 70, built);
      for (let i = 0; i < res.terrain.length; i++) {
        const x = i % 70;
        const y = Math.floor(i / 70);
        if (Math.min(x, y, 69 - x, 69 - y) < 6) continue; // not the border woods
        if (d[i] >= 1 && d[i] < 6) (nearCells++, res.terrain[i] === T.tree && near++);
        else if (d[i] >= 16) (farCells++, res.terrain[i] === T.tree && far++);
      }
    }
    expect(far / farCells).toBeGreaterThan((near / nearCells) * 1.5);
  });
});
