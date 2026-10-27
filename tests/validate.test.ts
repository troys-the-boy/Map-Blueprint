import { describe, expect, it } from "vitest";
import { T } from "../src/core/grid";
import { addNewMap, newRegion } from "../src/core/model";
import type { MapBlueprint } from "../src/core/model";
import { validateMap } from "../src/core/validate";

/**
 * Build a small test map from a picture. Each character is one cell:
 *   # tree   . path   ~ deep water   v ledge (south)   > ledge (east)   , ground
 */
function mapFrom(rows: string[], openings: MapBlueprint["openings"]): MapBlueprint {
  const height = rows.length;
  const width = rows[0].length;
  const map = addNewMap(newRegion("t", 1), { name: "Test", mapType: "route", width, height, seed: 1 });
  const key: Record<string, number> = { "#": T.tree, ".": T.path, "~": T.waterDeep, v: T.ledgeS, ">": T.ledgeE, ",": T.ground };
  rows.forEach((row, y) => [...row].forEach((ch, x) => (map.layers.terrain.data[y * width + x] = key[ch])));
  map.openings = openings;
  return map;
}

const NS = [
  { id: "n", edge: "north" as const, start: 2, width: 1 },
  { id: "s", edge: "south" as const, start: 2, width: 1 },
];
const codes = (map: MapBlueprint, hms: Parameters<typeof validateMap>[1] = {}) => validateMap(map, hms).map((i) => i.code);

describe("validation", () => {
  it("passes a simple straight route", () => {
    const map = mapFrom(["##.##", "##.##", "##.##", "##.##"], NS);
    expect(codes(map).filter((c) => c !== "narrow-path")).toEqual([]);
  });

  it("lets you jump down a south ledge but not climb back up", () => {
    // Walking north→south works; south→north is blocked by the ledge.
    const map = mapFrom(["##.##", "##v##", "##.##", "##.##"], NS);
    const issues = validateMap(map);
    const unreachable = issues.filter((i) => i.code === "unreachable-exit");
    expect(unreachable).toHaveLength(1);
    expect(unreachable[0].message).toMatch(/from the south entrance .* to the north entrance/);
  });

  it("finds a ledge trap: a pit you can drop into but never leave", () => {
    const map = mapFrom(["#.....#", "#.###.#", "#.#,#.#", "#.#v#.#", "#.#,#.#", "#.###.#", "#.....#"], [
      { id: "n", edge: "north", start: 1, width: 1 },
      { id: "s", edge: "south", start: 1, width: 1 },
    ]);
    // Open the pit's top so the player can walk in from the north loop.
    map.layers.terrain.data[1 * 7 + 3] = T.ground;
    expect(codes(map)).toContain("soft-lock");
  });

  it("needs Surf to cross deep water, and passes when Surf is available", () => {
    const map = mapFrom(["##.##", "##~##", "##.##"], NS);
    expect(codes(map)).toContain("unreachable-exit");
    expect(codes(map, { availableHms: ["surf"] })).not.toContain("unreachable-exit");
  });

  it("needs Cut to pass a Cut tree", () => {
    const map = mapFrom(["##.##", "##.##", "##.##"], NS);
    map.entities.push({ id: "C1", kind: "cut_tree", x: 2, y: 1, elevation: "ground", fields: {} });
    expect(codes(map)).toContain("unreachable-exit");
    expect(codes(map, { availableHms: ["cut"] })).not.toContain("unreachable-exit");
  });

  it("reports a blocked entrance", () => {
    const map = mapFrom(["#####", "##.##", "##.##"], NS);
    expect(codes(map)).toContain("blocked-entrance");
  });

  it("reports a map that's too big for the game", () => {
    const map = addNewMap(newRegion("t", 1), { name: "Huge", mapType: "route", width: 90, height: 90, seed: 1 });
    expect(codes(map)).toContain("map-too-big");
  });

  it("warns about a trainer the player can't avoid", () => {
    const map = mapFrom(["##.##", "##.##", "#,.##", "##.##", "##.##"], NS);
    map.entities.push({
      id: "T1",
      kind: "trainer",
      x: 1,
      y: 2,
      elevation: "ground",
      fields: { movement_type: "MOVEMENT_TYPE_FACE_RIGHT", trainer_sight_or_berry_tree_id: "3" },
    });
    expect(codes(map)).toContain("unavoidable-trainer");
  });

  it("warns about small grass patches and diagonal trees", () => {
    const map = mapFrom([",,,,,", ",#,,,", ",,#,,", ",,,,,"], []);
    map.layers.terrain.data[0] = T.tallGrass;
    const c = codes(map);
    expect(c).toContain("small-grass");
    expect(c).toContain("diagonal-trees");
  });
});
