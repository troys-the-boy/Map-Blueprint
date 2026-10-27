// Milestone 5, part B: forests.

import { describe, expect, it } from "vitest";
import { generateRoute } from "../src/core/generate";
import { readForestParams } from "../src/core/generators/forestParams";
import { IS_WALKABLE, T } from "../src/core/grid";
import { BIOMES, addNewMap, newRegion } from "../src/core/model";
import type { Biome } from "../src/core/model";

function forest(seed: number, params: Record<string, string | number | boolean> = {}, size = 50, biome: Biome = "temperate_rainforest") {
  const region = newRegion("r", 1);
  const map = addNewMap(region, { name: "Misty Woods", mapType: "forest", width: size, height: size, seed, biome });
  map.params = params;
  return map;
}

const count = (terrain: Uint8Array, t: number) => terrain.reduce((n, v) => n + (v === t ? 1 : 0), 0);

describe("Milestone 5 goal: forests generate valid maps over 100 seeds", () => {
  it("across sizes, biomes and maze densities", () => {
    for (let seed = 1; seed <= 100; seed++) {
      const size = [40, 50, 60][seed % 3];
      const map = forest(seed, { mazeDensity: (seed % 5) / 4, clearings: seed % 6 }, size, BIOMES[seed % BIOMES.length]);
      const r = generateRoute(map);
      expect(r.ok, `seed ${seed}: ${r.issues.filter((i) => i.severity === "error").map((i) => i.code)}`).toBe(true);
    }
  }, 180_000);
});

describe("forests", () => {
  it("are mostly forest, with paths through it", () => {
    const r = generateRoute(forest(4));
    const walls = count(r.terrain, T.tree) + count(r.terrain, T.denseForest);
    const walk = r.terrain.reduce((n, v) => n + (IS_WALKABLE[v] ? 1 : 0), 0);
    expect(walls).toBeGreaterThan(walk * 0.5);
    expect(walk).toBeGreaterThan(50 * 50 * 0.25);
  });

  it("places the guaranteed hidden items and caps item balls", () => {
    for (let seed = 1; seed <= 10; seed++) {
      const r = generateRoute(forest(seed, { guaranteedHidden: 4, items: 1, hiddenItems: 0 }));
      expect(r.entities.filter((e) => e.kind === "hidden_item").length, `seed ${seed}`).toBeGreaterThanOrEqual(4);
      expect(r.entities.filter((e) => e.kind === "item_ball").length, `seed ${seed}`).toBeLessThanOrEqual(3);
    }
  });

  it("the biome sets the look: long grass in rainforest, tall grass in meadow, pools in wetland clearings", () => {
    const rain = generateRoute(forest(2, { grass: 1 }));
    expect(count(rain.terrain, T.longGrass)).toBeGreaterThan(0);
    expect(count(rain.terrain, T.tallGrass)).toBe(0);
    const meadow = generateRoute(forest(2, { grass: 1 }, 50, "meadow"));
    expect(count(meadow.terrain, T.tallGrass)).toBeGreaterThan(0);
    let pools = 0;
    for (let seed = 1; seed <= 5; seed++) pools += count(generateRoute(forest(seed, { clearings: 4 }, 50, "wetland")).terrain, T.waterShallow);
    expect(pools).toBeGreaterThan(0);
  });

  it("trainers watch the main path; there's a sign at the entrance", () => {
    const r = generateRoute(forest(7, { trainers: 3 }));
    expect(r.entities.filter((e) => e.kind === "trainer").length).toBeGreaterThan(0);
    expect(r.entities.some((e) => e.kind === "sign")).toBe(true);
  });

  it("settings are read with defaults and clamped", () => {
    expect(readForestParams({})).toEqual({ mazeDensity: 0.6, clearings: 3, guaranteedHidden: 2 });
    expect(readForestParams({ mazeDensity: 3, clearings: -1 })).toMatchObject({ mazeDensity: 1, clearings: 0 });
  });
});
