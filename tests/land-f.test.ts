// Land and settlements, part F: town plans, and towns that grow from a core so their
// buildings stand close together whatever the size of the map.

import { describe, expect, it } from "vitest";
import { generateRoute } from "../src/core/generate";
import { TOWN_LAYOUTS, readTownParams, townWater } from "../src/core/generators/townParams";
import type { TownLayout } from "../src/core/generators/townParams";
import { IS_WATER, T } from "../src/core/grid";
import { addNewMap, newRegion } from "../src/core/model";
import type { MapBlueprint } from "../src/core/model";
import { parseProject, serializeProject } from "../src/core/project";

function town(layout: TownLayout, w: number, h: number, seed: number, params: Record<string, string | number | boolean> = {}): MapBlueprint {
  const m = addNewMap(newRegion("r", 1), { name: "Town", mapType: "town", width: w, height: h, seed });
  m.params = { townLayout: layout, ...params };
  return m;
}
type Res = ReturnType<typeof generateRoute>;
const doors = (r: Res) => r.warps.filter((x) => x.kind === "door");
/** How far the doors are from their own middle, on average (cells). */
function spread(r: Res): number {
  const d = doors(r);
  const cx = d.reduce((s, q) => s + q.x, 0) / d.length;
  const cy = d.reduce((s, q) => s + q.y, 0) / d.length;
  return d.reduce((s, q) => s + Math.abs(q.x - cx) + Math.abs(q.y - cy), 0) / d.length;
}
const count = (data: Uint8Array, test: (t: number) => boolean) => data.reduce((n, v) => n + (test(v) ? 1 : 0), 0);

describe("town plans", () => {
  it("a new town starts with the market square; an older one keeps its grid", () => {
    const m = addNewMap(newRegion("r", 1), { name: "Town", mapType: "town", width: 40, height: 40, seed: 1 });
    expect(m.params.townLayout).toBe("square");
    expect(readTownParams({}).townLayout).toBe("grid");
    expect(readTownParams({ townLayout: "nonsense" }).townLayout).toBe("grid");
  });

  for (const layout of TOWN_LAYOUTS)
    it(`${layout}: every seed passes the checks, and the buildings fit`, () => {
      let fit = 0;
      for (let seed = 1; seed <= 8; seed++) {
        const res = generateRoute(town(layout, 50, 50, seed, { houses: 6, gym: true }));
        expect(res.ok, `seed ${seed}: ${res.issues.filter((i) => i.severity === "error").map((i) => i.message)}`).toBe(true);
        fit += doors(res).length;
      }
      expect(fit).toBeGreaterThanOrEqual(8 * 9 - 3);
    });

  it("the market square has a square: a paved block at the core", () => {
    for (let seed = 1; seed <= 6; seed++) {
      const res = generateRoute(town("square", 40, 40, seed));
      // Somewhere there's a 6×4 block of road.
      let found = false;
      for (let y = 0; y + 4 <= 40 && !found; y++)
        for (let x = 0; x + 6 <= 40 && !found; x++) {
          let all = true;
          for (let dy = 0; dy < 4 && all; dy++) for (let dx = 0; dx < 6 && all; dx++) all = res.terrain[(y + dy) * 40 + x + dx] === T.road;
          found = all;
        }
      expect(found, `seed ${seed}`).toBe(true);
    }
  });

  it("the Pokémon Center and Mart stand at the core, by the square", () => {
    for (let seed = 1; seed <= 8; seed++) {
      const res = generateRoute(town("square", 60, 60, seed, { houses: 6 }));
      const d = doors(res);
      const cx = d.reduce((s, q) => s + q.x, 0) / d.length;
      const cy = d.reduce((s, q) => s + q.y, 0) / d.length;
      for (const kind of ["POKEMON_CENTER_1F", "MART"]) {
        const w = d.find((q) => q.destMap.endsWith(kind))!;
        expect(Math.abs(w.x - cx) + Math.abs(w.y - cy), `seed ${seed} ${kind}`).toBeLessThan(14);
      }
    }
  });

  it("the riverside has a river through it with a bridge, the harbour has the sea", () => {
    expect([townWater("riverside"), townWater("waterfront"), townWater("square")]).toEqual(["river", "coastal", "land"]);
    for (let seed = 1; seed <= 5; seed++) {
      const river = generateRoute(town("riverside", 50, 50, seed));
      expect(count(river.terrain, (t) => IS_WATER[t])).toBeGreaterThan(80);
      expect(count(river.terrain, (t) => t === T.bridge), `seed ${seed}`).toBeGreaterThanOrEqual(2);
      expect(count(generateRoute(town("waterfront", 50, 50, seed)).terrain, (t) => IS_WATER[t])).toBeGreaterThan(150);
    }
  });
});

describe("towns are compact", () => {
  it("buildings are as close together on a big map as on a small one", () => {
    for (const layout of ["square", "crossroads", "grid", "organic"] as const) {
      const at = (size: number) => {
        let total = 0;
        for (let seed = 1; seed <= 8; seed++) total += spread(generateRoute(town(layout, size, size, seed, { houses: 6, gym: true })));
        return total / 8;
      };
      const small = at(40);
      const big = at(70);
      // On the 70×70 map the town takes no more room than on the 40×40 one (it used to fill the map).
      expect(big, layout).toBeLessThan(small * 1.25);
      expect(big, layout).toBeLessThan(15);
    }
  });

  it("houses stand in rows: most have a neighbour two cells away", () => {
    let neighbours = 0;
    let houses = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const res = generateRoute(town("square", 60, 60, seed, { houses: 8 }));
      for (const d of doors(res)) {
        houses++;
        // Another building's wall within 4 cells along the door's row.
        let near = false;
        for (const dx of [-6, -5, -4, 4, 5, 6]) if (res.terrain[d.y * 60 + d.x + dx] === T.building) near = true;
        if (near) neighbours++;
      }
    }
    expect(neighbours / houses).toBeGreaterThan(0.5);
  });

  it("a hill town still shares its buildings between the valley and the slopes", () => {
    let high = 0;
    let all = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const res = generateRoute(town("grid", 40, 40, seed, { elevation: 0.8, houses: 6, gym: true }));
      expect(res.ok).toBe(true);
      for (const d of doors(res)) (all++, res.elevation[d.y * 40 + d.x] >= 2 && res.elevation[d.y * 40 + d.x] <= 5 && high++);
    }
    expect(high / all).toBeGreaterThan(0.2);
  });
});

describe("the town wall", () => {
  it("rings the buildings, with gaps where the streets pass, and nothing is cut off", () => {
    for (const layout of ["square", "crossroads", "grid"] as const)
      for (let seed = 1; seed <= 6; seed++) {
        const plain = generateRoute(town(layout, 50, 50, seed, { houses: 5 }));
        const res = generateRoute(town(layout, 50, 50, seed, { houses: 5, wall: true }));
        // Every door and entrance still reached (the checks would report one that wasn't).
        expect(res.ok, `${layout} seed ${seed}: ${res.issues.filter((i) => i.severity === "error").map((i) => i.message)}`).toBe(true);
        const fences = (r: Res) => count(r.terrain, (t) => t === T.fence);
        expect(fences(res) - fences(plain), `${layout} seed ${seed}`).toBeGreaterThan(40);
        // Same buildings, same streets: the wall is only added on open ground.
        expect(doors(res)).toEqual(doors(plain));
        for (let i = 0; i < res.terrain.length; i++) if (plain.terrain[i] === T.road || plain.terrain[i] === T.building) expect(res.terrain[i]).toBe(plain.terrain[i]);
        // Every building is inside the ring.
        const walls: number[] = [];
        for (let i = 0; i < res.terrain.length; i++) if (res.terrain[i] === T.fence && plain.terrain[i] !== T.fence) walls.push(i);
        const xs = walls.map((i) => i % 50);
        const ys = walls.map((i) => Math.floor(i / 50));
        for (const d of doors(res)) {
          expect(d.x).toBeGreaterThanOrEqual(Math.min(...xs));
          expect(d.x).toBeLessThanOrEqual(Math.max(...xs));
          expect(d.y).toBeGreaterThanOrEqual(Math.min(...ys));
          expect(d.y).toBeLessThanOrEqual(Math.max(...ys));
        }
      }
  });

  it("is saved with the town", () => {
    const r = newRegion("r", 1);
    const m = addNewMap(r, { name: "Town", mapType: "town", width: 40, height: 40, seed: 1 });
    m.params = { townLayout: "crossroads", wall: true };
    const back = parseProject(serializeProject(r, "test")).maps[0];
    expect(readTownParams(back.params)).toMatchObject({ townLayout: "crossroads", wall: true });
  });
});
