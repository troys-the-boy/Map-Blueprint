// Third revision: the Elevation setting works on narrow routes, more elevation
// means more levels, stairs and ledges, and ledge rows on flat ground make the
// path wind one way and give a jump-down shortcut the other way.

import { describe, expect, it } from "vitest";
import { generateRoute } from "../src/core/generate";
import { T, distanceField } from "../src/core/grid";
import { addNewMap, newRegion } from "../src/core/model";
import { MoveGraph } from "../src/core/reach";
import { ELEVATION_LEVELS } from "../src/core/terrain";

const GROUND = ELEVATION_LEVELS.indexOf("ground");
const RAISED = ["raised1", "raised2", "raised3", "raised4"].map((l) => ELEVATION_LEVELS.indexOf(l as (typeof ELEVATION_LEVELS)[number]));

function route(seed: number, params: Record<string, number>, width = 20, height = 40, biome: "meadow" | "alpine" = "meadow") {
  const map = addNewMap(newRegion("r", 1), { name: "m", mapType: "route", width, height, seed, biome });
  map.params = params;
  return { map, result: generateRoute(map) };
}

function stats(elevation: Uint8Array, terrain: Uint8Array) {
  let raised = 0;
  let top = 0;
  let stairs = 0;
  for (let i = 0; i < elevation.length; i++) {
    const k = RAISED.indexOf(elevation[i]);
    if (k >= 0) {
      raised++;
      top = Math.max(top, k + 1);
    }
    if (terrain[i] === T.stairs) stairs++;
  }
  return { raised, top, stairs };
}

describe("Elevation setting", () => {
  it("raises ground on the smallest route size (20×40)", () => {
    let withHills = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const { result } = route(seed, { elevation: 0.7 });
      expect(result.ok).toBe(true);
      if (stats(result.elevation, result.terrain).raised > 0) withHills++;
    }
    expect(withHills).toBeGreaterThanOrEqual(6);
  });

  it("more elevation gives more raised ground, higher levels and more stairs", () => {
    const total = (e: number) => {
      const sum = { raised: 0, top: 0, stairs: 0 };
      for (let seed = 1; seed <= 6; seed++) {
        const { result } = route(seed, { elevation: e }, 30, 60);
        const s = stats(result.elevation, result.terrain);
        sum.raised += s.raised;
        sum.top = Math.max(sum.top, s.top);
        sum.stairs += s.stairs;
      }
      return sum;
    };
    const [low, mid, high] = [0.2, 0.6, 1].map(total);
    expect(mid.raised).toBeGreaterThan(low.raised);
    expect(high.raised).toBeGreaterThan(mid.raised);
    expect(high.stairs).toBeGreaterThan(low.stairs);
    expect(high.top).toBeGreaterThanOrEqual(3);
  });

  it("0 keeps the route flat", () => {
    const { result } = route(3, { elevation: 0 }, 30, 60);
    expect(stats(result.elevation, result.terrain).raised).toBe(0);
  });
});

describe("ledge rows", () => {
  it("lie on flat ground and are a shortcut one way, a walk round the other", () => {
    let rows = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const { map, result } = route(seed, { elevation: 0, ledges: 2 });
      expect(result.ok).toBe(true);
      const { width } = map;
      const graph = new MoveGraph({ width, height: map.height, terrain: result.terrain, entities: result.entities, elevation: result.elevation }, new Set());
      // The longest walk round, over the ledges of the route on flat ground.
      let longest = -1;
      for (let i = 0; i < result.terrain.length; i++) {
        if (result.terrain[i] !== T.ledgeS) continue;
        const above = i - width;
        const below = i + width;
        if (result.elevation[above] !== GROUND || result.elevation[below] !== GROUND) continue;
        if (!graph.canStand[above] || !graph.canStand[below]) continue;
        // Jumping down takes one step; walking back up has to go round through the gap.
        expect(graph.forward([below])[above]).toBe(1);
        const walk = distanceField(width, map.height, [below], (c) => graph.canStand[c] === 1 && result.terrain[c] !== T.ledgeS);
        longest = Math.max(longest, walk[above]);
      }
      if (longest >= 0) {
        expect(longest).toBeGreaterThanOrEqual(8);
        expect(longest).toBeLessThan(Infinity);
        rows++;
      }
    }
    expect(rows).toBeGreaterThanOrEqual(5);
  });

  it("the Ledges setting adds rows", () => {
    const count = (ledges: number) => {
      let n = 0;
      for (let seed = 1; seed <= 4; seed++) n += Array.from(route(seed, { elevation: 0, ledges }, 30, 60).result.terrain).filter((t) => t === T.ledgeS).length;
      return n;
    };
    expect(count(0)).toBe(0);
    expect(count(3)).toBeGreaterThan(count(1));
  });

  it("never leave the player stuck, even on very hilly routes", () => {
    for (let seed = 1; seed <= 6; seed++) {
      const { result } = route(seed, { elevation: 1, ledges: 4 }, 30, 60, seed % 2 ? "alpine" : "meadow");
      expect(result.issues.filter((i) => i.code === "soft-lock")).toEqual([]);
    }
  });
});
