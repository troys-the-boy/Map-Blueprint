// Milestone 5, part D: multi-floor caves, ladders, and the Strength boulder puzzle.

import { describe, expect, it } from "vitest";
import { caveFloors, floorName, ladderCounts, pairLadders } from "../src/core/caves";
import { applyResult, generateRoute } from "../src/core/generate";
import { T } from "../src/core/grid";
import { addNewMap, newRegion } from "../src/core/model";
import type { MapBlueprint, Region } from "../src/core/model";
import { newThing } from "../src/core/things";
import { validateMap } from "../src/core/validate";

/** What the editor does: the first floor, then each other floor, each with its ladder counts, then pairing. */
function buildCave(region: Region, seed: number, floors: number, ladders: number, size = 40, extra: Record<string, number> = {}): MapBlueprint[] {
  const first = addNewMap(region, { name: "Moss Cave", mapType: "cave", width: size, height: size, seed, biome: "alpine" });
  first.params = { floors, ladders, ...extra };
  for (let k = 1; k < floors; k++) {
    const m = addNewMap(region, { name: `Moss Cave ${floorName(k)}`, mapType: "cave", width: size, height: size, seed: seed * 31 + k, biome: "alpine" });
    m.params = { caveGroup: first.id, floor: k, exits: 0, ...extra };
  }
  const all = caveFloors(region.maps, first);
  for (const m of all) {
    const { up, down } = ladderCounts(region.maps, m);
    m.params = { ...m.params, laddersUp: up, laddersDown: down };
    applyResult(m, generateRoute(m));
  }
  pairLadders(all);
  return all;
}

describe("Milestone 5 goal: cave floors' warps pair correctly", () => {
  it("over many seeds, every ladder leads to a ladder on the next floor that leads back", () => {
    for (let seed = 1; seed <= 25; seed++) {
      const region = newRegion("r", 1);
      const floors = 2 + (seed % 3);
      const ladders = 1 + (seed % 2);
      const all = buildCave(region, seed, floors, ladders);
      expect(all).toHaveLength(floors);
      for (const m of all) {
        // Every floor is valid, including the pairing check between maps.
        const errors = validateMap(m, { otherMaps: region.maps }).filter((i) => i.severity === "error");
        expect(errors.map((e) => e.code), `seed ${seed} ${m.name}`).toEqual([]);
        for (const w of m.warps.filter((x) => x.kind === "ladder")) {
          const dest = all.find((o) => o.header.id === w.destMap)!;
          expect(dest, `seed ${seed} ${m.name}: ladder leads to ${w.destMap}`).toBeDefined();
          const back = dest.warps[w.destWarpId!];
          expect(back.kind).toBe("ladder");
          expect(back.destMap).toBe(m.header.id);
          expect(m.warps[back.destWarpId!]).toBe(w);
        }
      }
      // The right number of ladders on each floor: up from all but the first, down from all but the last.
      all.forEach((m, k) => expect(m.warps.filter((x) => x.kind === "ladder").length).toBe((k > 0 ? ladders : 0) + (k < floors - 1 ? ladders : 0)));
      // Only the first floor has cave mouths out.
      expect(all.slice(1).every((m) => m.warps.every((w) => w.kind === "ladder"))).toBe(true);
    }
  }, 240_000);
});

describe("caves with floors", () => {
  it("floor helpers: names and ladder counts", () => {
    expect([0, 1, 2].map(floorName)).toEqual(["1F", "B1F", "B2F"]);
    const region = newRegion("r", 1);
    const all = buildCave(region, 3, 3, 2, 30);
    expect(all.map((m) => ladderCounts(region.maps, m))).toEqual([
      { up: 0, down: 2 },
      { up: 2, down: 2 },
      { up: 2, down: 0 },
    ]);
  });

  it("ladders sit on open floor, reachable from the floor's other ways in", () => {
    const region = newRegion("r", 1);
    for (const m of buildCave(region, 5, 2, 2)) {
      for (const w of m.warps.filter((x) => x.kind === "ladder")) expect(m.layers.terrain.data[w.y * m.width + w.x]).toBe(T.caveFloor);
      expect(validateMap(m, { otherMaps: region.maps }).some((i) => i.code === "unreachable-exit")).toBe(false);
    }
  });
});

describe("the Strength boulder puzzle", () => {
  it("generated boulders guard side areas, and no push can block the way through", () => {
    let boulders = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const region = newRegion("r", 1);
      const map = addNewMap(region, { name: "Moss Cave", mapType: "cave", width: 40, height: 40, seed, biome: "alpine" });
      map.params = { boulders: 2, rockSmash: 0 };
      const r = generateRoute(map);
      expect(r.ok, `seed ${seed}: ${r.issues.filter((i) => i.severity === "error").map((i) => i.code)}`).toBe(true);
      boulders += r.entities.filter((e) => e.kind === "strength_boulder").length;
    }
    // A boulder needs a narrow side passage, so not every cave gets the full number.
    expect(boulders).toBeGreaterThan(5);
  });

  it("a boulder that can be pushed into the only corridor for good is an error", () => {
    const region = newRegion("r", 1);
    const map = addNewMap(region, { name: "Test", mapType: "route", width: 9, height: 12, seed: 1, biome: "meadow" });
    // A one-cell corridor down the middle, opening into a room in the middle with a dead end to the east.
    map.layers.terrain.data.fill(T.tree);
    for (let y = 0; y < 12; y++) map.layers.terrain.data[y * 9 + 4] = T.ground;
    for (let y = 4; y <= 6; y++) for (let x = 3; x <= 7; x++) map.layers.terrain.data[y * 9 + x] = T.ground;
    map.openings = [
      { id: "o1", edge: "north", start: 4, width: 1, kind: "walk" },
      { id: "o2", edge: "south", start: 4, width: 1, kind: "walk" },
    ];
    // In the room, beside the corridor: pushed west it lands in the corridor's way? No: west of
    // (5,5) is (4,5), the corridor's middle; from there it can be pushed south down the corridor to the end.
    map.entities.push({ ...newThing(map, "strength_boulder", 5, 5), id: "B1" });
    expect(validateMap(map).map((i) => i.code)).toContain("boulder-can-block");
    // A boulder tucked in the dead end of the room can only be pushed further in: fine.
    map.entities = [{ ...newThing(map, "strength_boulder", 7, 5), id: "B1" }];
    expect(validateMap(map).map((i) => i.code)).not.toContain("boulder-can-block");
  });
});
