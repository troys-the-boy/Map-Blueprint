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

// --- Revision after the first look: natural forests, bridges, zones, town hills and side streets ---

import { applyResult } from "../src/core/generate";
import { edgeBand, newZone } from "../src/core/zones";
import type { MapBlueprint } from "../src/core/model";

/** A stream of deep water painted (locked) right across the map, `rows` deep. */
function paintStream(map: MapBlueprint, y0: number, rows = 2) {
  for (let y = y0; y < y0 + rows; y++)
    for (let x = 0; x < map.width; x++) {
      map.layers.terrain.data[y * map.width + x] = T.waterDeep;
      map.layers.locks.data[y * map.width + x] = 1;
    }
}

describe("bridges over water you painted", () => {
  for (const mapType of ["route", "town", "forest"] as const)
    it(`${mapType}: the way through crosses a locked stream on a bridge`, () => {
      for (let seed = 1; seed <= 6; seed++) {
        const region = newRegion("r", 1);
        const map = addNewMap(region, { name: "Fir Town", mapType, width: 40, height: 50, seed, biome: "meadow" });
        paintStream(map, 24);
        const r = generateRoute(map);
        expect(r.ok, `seed ${seed}: ${r.issues.filter((i) => i.severity === "error").map((i) => i.code)}`).toBe(true);
        const row = [24, 25].flatMap((y) => Array.from({ length: 40 }, (_, x) => r.terrain[y * 40 + x]));
        expect(row.filter((t) => t === T.bridge).length, `seed ${seed}`).toBeGreaterThan(0);
        // The rest of the stream is still water.
        expect(row.filter((t) => t === T.waterDeep).length).toBeGreaterThan(60);
      }
    });

  it("bridges can move: the last Generate's bridge goes back to water first", () => {
    const region = newRegion("r", 1);
    const map = addNewMap(region, { name: "Route 3", mapType: "route", width: 30, height: 50, seed: 1, biome: "meadow" });
    paintStream(map, 24);
    applyResult(map, generateRoute(map));
    expect(map.layers.zones.some((z) => z.id === "generated_bridges")).toBe(true);
    for (let seed = 2; seed <= 6; seed++) {
      map.seed = seed;
      applyResult(map, generateRoute(map));
      const bridges = [24, 25].flatMap((y) => Array.from({ length: 30 }, (_, x) => map.layers.terrain.data[y * 30 + x])).filter((t) => t === T.bridge).length;
      // One crossing at a time (the path is up to 3 wide, crossing a 2-deep stream), not one per Generate.
      expect(bridges, `seed ${seed}`).toBeLessThanOrEqual(6);
    }
  });
});

describe("natural forests", () => {
  it("have thick woods between the paths: few trees stand alone in a wall one cell thick", () => {
    const r = generateRoute(forest(3, {}, 50));
    let thin = 0;
    let walls = 0;
    for (let y = 1; y < 49; y++)
      for (let x = 1; x < 49; x++) {
        const t = r.terrain[y * 50 + x];
        if (t !== T.tree && t !== T.denseForest) continue;
        walls++;
        const w = (xx: number, yy: number) => IS_WALKABLE[r.terrain[yy * 50 + xx]];
        if ((w(x - 1, y) && w(x + 1, y)) || (w(x, y - 1) && w(x, y + 1))) thin++;
      }
    expect(thin / walls).toBeLessThan(0.05);
  });

  it("with a travel direction, get ledges jumping back toward the start (none going north to south)", () => {
    let ledges = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const r = generateRoute(forest(seed, { travel: "south_north", ledges: 2 }, 50));
      ledges += count(r.terrain, T.ledgeS);
      expect(count(r.terrain, T.ledgeE) + count(r.terrain, T.ledgeW)).toBe(0);
      expect(r.ok).toBe(true);
    }
    expect(ledges).toBeGreaterThan(5);
    const down = generateRoute(forest(1, { travel: "north_south", ledges: 2 }, 50));
    expect(count(down.terrain, T.ledgeS)).toBe(0);
  });

  it("follow a lake zone, going round it", () => {
    const map = forest(2, {}, 50);
    const lake = newZone(map, "water", { water: "lake", depth: "deep" });
    lake.hard = true;
    for (let y = 18; y < 28; y++) for (let x = 15; x < 30; x++) lake.mask.data[y * 50 + x] = 1;
    map.layers.zones.push(lake);
    const r = generateRoute(map);
    expect(r.ok).toBe(true);
    expect(r.terrain[22 * 50 + 22]).toBe(T.waterDeep);
  });
});

describe("towns: zones, hills, side streets, drawn streets", () => {
  const townMap = (seed: number, params: Record<string, string | number | boolean> = {}, size = 40) => {
    const region = newRegion("r", 1);
    const map = addNewMap(region, { name: "Fir Town", mapType: "town", width: size, height: size, seed, biome: "meadow" });
    map.params = params;
    return map;
  };

  it("stay flat by default; the Elevation setting adds hillsides with stairs", () => {
    expect(count(generateRoute(townMap(1)).terrain, T.stairs)).toBe(0);
    let stairs = 0;
    for (let seed = 1; seed <= 5; seed++) {
      const r = generateRoute(townMap(seed, { elevation: 0.7 }));
      expect(r.ok, `seed ${seed}`).toBe(true);
      stairs += count(r.terrain, T.stairs);
    }
    expect(stairs).toBeGreaterThan(0);
  });

  it("side streets end in dead ends with an item", () => {
    const r = generateRoute(townMap(3, { branches: 3 }));
    expect(r.ok).toBe(true);
    expect(r.entities.filter((e) => e.kind === "item_ball").length).toBeGreaterThan(0);
  });

  it("keep buildings off keep-clear ground, and follow an edge zone", () => {
    const map = townMap(4);
    const plaza = newZone(map, "keep_clear", {});
    plaza.hard = true;
    for (let y = 14; y < 24; y++) for (let x = 14; x < 26; x++) plaza.mask.data[y * 40 + x] = 1;
    const cliff = newZone(map, "edge", { boundary: "cliff" });
    cliff.hard = true;
    for (const i of edgeBand(map, "east", 5, 34, 4)) cliff.mask.data[i] = 1;
    map.layers.zones.push(plaza, cliff);
    const r = generateRoute(map);
    expect(r.ok).toBe(true);
    for (let y = 14; y < 24; y++) for (let x = 14; x < 26; x++) expect(r.terrain[y * 40 + x], `${x},${y}`).not.toBe(T.building);
    expect(r.terrain[20 * 40 + 38]).toBe(T.rockWall);
  });

  it("use streets you drew: buildings line them, and no street grid is added", () => {
    const map = townMap(5);
    for (let x = 4; x < 36; x++)
      for (const y of [20, 21]) {
        map.layers.terrain.data[y * 40 + x] = T.road;
        map.layers.locks.data[y * 40 + x] = 1;
      }
    const r = generateRoute(map);
    expect(r.ok).toBe(true);
    // Doors whose front step is on the drawn street, or a short walk from it.
    const onDrawn = r.warps.filter((w) => Math.abs(w.y + 1 - 20) <= 6).length;
    expect(onDrawn).toBeGreaterThanOrEqual(3);
    // Apart from the drawn street, only short joins to the entrances and door walks: no grid of new roads.
    const newRoad = r.terrain.reduce((n, t, i) => n + (t === T.road && !map.layers.locks.data[i] ? 1 : 0), 0);
    expect(newRoad).toBeLessThan(120);
  });
});

describe("meadows are full of flowers", () => {
  it("on routes, in towns and in forests", () => {
    const flowers = (mapType: "route" | "town" | "forest", biome: Biome) => {
      const region = newRegion("r", 1);
      const map = addNewMap(region, { name: "M", mapType, width: 30, height: 50, seed: 3, biome });
      return count(generateRoute(map).terrain, T.flowers);
    };
    for (const t of ["route", "town", "forest"] as const) expect(flowers(t, "meadow"), t).toBeGreaterThan(flowers(t, "temperate_rainforest") + 10);
  });
});
