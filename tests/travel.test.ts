// Milestone 4, part A: travel direction.

import { describe, expect, it } from "vitest";
import { generateRoute } from "../src/core/generate";
import type { GenerateResult } from "../src/core/generate";
import { T } from "../src/core/grid";
import { addNewMap, newRegion } from "../src/core/model";
import type { MapBlueprint } from "../src/core/model";
import { MoveGraph, openingCells } from "../src/core/reach";
import { readRouteParams } from "../src/core/generators/params";
import { TRAVEL_SETTINGS } from "../src/core/generators/travel";
import type { TravelSetting } from "../src/core/generators/travel";

function route(travel: TravelSetting, seed: number, extra: Record<string, number> = {}) {
  const vertical = travel === "auto" || travel.includes("north");
  const region = newRegion("r", 1);
  const map = addNewMap(region, { name: "Route 5", mapType: "route", width: vertical ? 30 : 70, height: vertical ? 70 : 30, seed, biome: "meadow" });
  map.params = { travel, ...extra };
  return map;
}

const LEDGES = [T.ledgeS, T.ledgeE, T.ledgeW];

function ledgeKinds(r: GenerateResult): Set<number> {
  return new Set(Array.from(r.terrain).filter((t) => LEDGES.includes(t)));
}

/** Cells from the start edge. */
function fromStart(map: MapBlueprint, travel: TravelSetting, x: number, y: number) {
  return travel.startsWith("north") ? y : travel.startsWith("south") ? map.height - 1 - y : travel.startsWith("west") ? x : map.width - 1 - x;
}

describe("travel direction", () => {
  it("is saved as a plain setting and defaults to no direction", () => {
    expect(readRouteParams({}).travel).toBe("auto");
    expect(readRouteParams({ travel: "west_east" }).travel).toBe("west_east");
    expect(readRouteParams({ travel: "sideways" }).travel).toBe("auto");
  });

  for (const travel of TRAVEL_SETTINGS.filter((t) => t !== "auto")) {
    it(`${travel}: every seed passes the checks`, () => {
      for (let seed = 1; seed <= 40; seed++) {
        const r = generateRoute(route(travel, seed));
        expect(r.ok, `seed ${seed}: ${r.issues.filter((i) => i.severity === "error").map((i) => i.code)}`).toBe(true);
      }
    });
  }

  it("east–west routes have no ledge jumping forward", () => {
    const forward: Record<string, number> = { west_east: T.ledgeE, east_west: T.ledgeW };
    for (const [travel, ledge] of Object.entries(forward))
      for (let seed = 1; seed <= 15; seed++) {
        const kinds = ledgeKinds(generateRoute(route(travel as TravelSetting, seed, { elevation: 0.6, ledges: 2 })));
        expect(kinds.has(ledge), `${travel} seed ${seed}`).toBe(false);
      }
  });

  it("north–south routes get fewer ledges than south–north ones", () => {
    let down = 0;
    let up = 0;
    for (let seed = 1; seed <= 15; seed++) {
      down += Array.from(generateRoute(route("north_south", seed, { elevation: 0, ledges: 4 })).terrain).filter((t) => t === T.ledgeS).length;
      up += Array.from(generateRoute(route("south_north", seed, { elevation: 0, ledges: 4 })).terrain).filter((t) => t === T.ledgeS).length;
    }
    expect(down).toBeLessThan(up);
  });

  it("puts the route sign at the start, and no trainer right by it", () => {
    for (const travel of ["south_north", "east_west"] as TravelSetting[])
      for (let seed = 1; seed <= 10; seed++) {
        const map = route(travel, seed);
        const r = generateRoute(map);
        const sign = r.entities.find((e) => e.kind === "sign");
        if (sign) expect(fromStart(map, travel, sign.x, sign.y), `${travel} seed ${seed} sign`).toBeLessThan(12);
        for (const t of r.entities.filter((e) => e.kind === "trainer" && !e.locked)) expect(fromStart(map, travel, t.x, t.y)).toBeGreaterThanOrEqual(10);
      }
  });

  it("trainers mostly face the oncoming player rather than away", () => {
    let toward = 0;
    let away = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const r = generateRoute(route("west_east", seed, { trainers: 5 }));
      for (const t of r.entities.filter((e) => e.kind === "trainer")) {
        if (t.fields.movement_type === "MOVEMENT_TYPE_FACE_LEFT") toward++;
        if (t.fields.movement_type === "MOVEMENT_TYPE_FACE_RIGHT") away++;
      }
    }
    expect(toward).toBeGreaterThan(away);
  });

  it("ledge pockets hold an item the player can reach", () => {
    let pockets = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const map = route("south_north", seed, { elevation: 0.2 });
      const r = generateRoute(map);
      const starts = r.openings.filter((o) => o.kind === "walk").flatMap((o) => openingCells(o, map.width, map.height));
      const reach = new MoveGraph({ width: map.width, height: map.height, terrain: r.terrain, entities: r.entities, elevation: r.elevation }, new Set()).forward(starts);
      for (const item of r.entities.filter((e) => e.kind === "item_ball")) {
        const i = item.y * map.width + item.x;
        // A pocket item sits beside the landing cell, which has a south ledge above and below.
        const beside = [i - 1, i + 1].some((m) => r.terrain[m - map.width] === T.ledgeS && r.terrain[m + map.width] === T.ledgeS);
        if (beside) {
          pockets++;
          expect(reach[i], `seed ${seed}`).toBe(1);
        }
      }
    }
    expect(pockets).toBeGreaterThan(5);
  });

  it("hillsides rise toward the end", () => {
    let start = 0;
    let end = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const map = route("south_north", seed, { elevation: 0.7 });
      const r = generateRoute(map);
      for (let y = 0; y < map.height; y++)
        for (let x = 0; x < map.width; x++) {
          const level = r.elevation[y * map.width + x];
          if (level < 2 || level > 5) continue;
          if (y < map.height / 3) end += level - 1;
          if (y >= (2 * map.height) / 3) start += level - 1;
        }
    }
    expect(end).toBeGreaterThan(start);
  });

  it("a direction across the map makes the route run that way", () => {
    const region = newRegion("r", 1);
    const map = addNewMap(region, { name: "Route 6", mapType: "route", width: 40, height: 60, seed: 3, biome: "meadow" });
    map.params = { travel: "west_east" };
    const r = generateRoute(map);
    expect(r.ok).toBe(true);
    expect(new Set(r.openings.map((o) => o.edge))).toEqual(new Set(["west", "east"]));
  });
});
