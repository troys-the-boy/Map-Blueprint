// Milestone 4, part B: every kind of thing, warps, properties and the new checks.

import { describe, expect, it } from "vitest";
import { applyResult, generateRoute } from "../src/core/generate";
import { T } from "../src/core/grid";
import { addNewMap, newRegion } from "../src/core/model";
import type { MapBlueprint } from "../src/core/model";
import { CURRENT_SCHEMA_VERSION, parseProject, serializeProject } from "../src/core/project";
import { PLACEABLE_KINDS, findThing, isWarp, newThing, newWarp, removeThing, thingAt, thingTag } from "../src/core/things";
import { validateMap } from "../src/core/validate";

function blank(name = "Route 9", w = 30, h = 60, seed = 2) {
  const region = newRegion("r", 1);
  return { region, map: addNewMap(region, { name, mapType: "route", width: w, height: h, seed, biome: "meadow" }) };
}

describe("every kind of thing", () => {
  it("can be placed by hand, with vanilla Porymap fields", () => {
    const { map } = blank();
    const kinds = PLACEABLE_KINDS.filter((k) => k !== "warp");
    expect(kinds).toEqual(expect.arrayContaining(["berry_tree", "trigger", "secret_base", "heal_location"]));
    const berry = newThing(map, "berry_tree", 3, 3);
    // As on Route 119 in pokeemerald's data/maps/Route119/map.json.
    expect(berry.fields).toMatchObject({ graphics_id: "OBJ_EVENT_GFX_BERRY_TREE", movement_type: "MOVEMENT_TYPE_BERRY_TREE_GROWTH", script: "BerryTreeScript", trainer_type: "TRAINER_TYPE_NONE" });
    expect(String(berry.fields.trainer_sight_or_berry_tree_id)).toMatch(/^BERRY_TREE_ROUTE9_1$/);
    expect(newThing(map, "trigger", 4, 4).fields).toMatchObject({ type: "trigger", var_value: "0" });
    expect(newThing(map, "secret_base", 5, 5).fields.secret_base_id).toMatch(/^SECRET_BASE_/);
    expect(newThing(map, "heal_location", 6, 6).fields).toMatchObject({ id: "HEAL_LOCATION_ROUTE9", map: map.header.id });
  });

  it("warps are placed, found, numbered and removed like other things", () => {
    const { map } = blank();
    const a = newWarp(map, 4, 5);
    map.warps.push(a);
    const b = newWarp(map, 8, 9);
    map.warps.push(b);
    expect(a.id).not.toBe(b.id);
    expect(isWarp(thingAt(map, 8, 9)!)).toBe(true);
    expect(findThing(map, b.id)).toBe(b);
    expect(thingTag(map, b)).toBe("W1");
    removeThing(map, a);
    expect(thingTag(map, b)).toBe("W0");
  });

  it("save and open with warps and warnings marked OK (file format 7 and later)", () => {
    const { region, map } = blank();
    const t = newThing(map, "trainer", 3, 3);
    t.accepted = ["unavoidable-trainer"];
    map.entities.push(t, newThing(map, "berry_tree", 4, 4));
    map.warps.push({ ...newWarp(map, 5, 5), kind: "cave_mouth", destMap: "MAP_GRANITE_CAVE_1F", destWarpId: 0 });
    map.edits.push({ type: "entity", action: "place", id: "w1", kind: "warp", x: 5, y: 5 });
    expect(CURRENT_SCHEMA_VERSION).toBeGreaterThanOrEqual(7);
    const loaded = parseProject(serializeProject(region, "test")).maps[0];
    expect(loaded.entities[0].accepted).toEqual(["unavoidable-trainer"]);
    expect(loaded.warps[0]).toMatchObject({ kind: "cave_mouth", destMap: "MAP_GRANITE_CAVE_1F" });
  });

  it("an older (format 6) file still opens", () => {
    const { region } = blank();
    const file = JSON.parse(serializeProject(region, "test"));
    file.schemaVersion = 6;
    expect(() => parseProject(JSON.stringify(file))).not.toThrow();
  });
});

describe("warps and Generate", () => {
  /** A building with a door warp, off to the side of the route, locked as if placed by hand. */
  function withDoor(map: MapBlueprint, x: number, y: number) {
    for (let dy = -2; dy <= 0; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const i = (y + dy) * map.width + x + dx;
        map.layers.terrain.data[i] = T.building;
        map.layers.locks.data[i] = 1;
      }
    map.warps.push({ ...newWarp(map, x, y), destMap: "MAP_ROUTE9_HOUSE", destWarpId: 0 });
  }

  it("leads a path to a door placed by hand", () => {
    expect(T.building).toBeGreaterThan(0);
    for (let seed = 1; seed <= 20; seed++) {
      const { map } = blank("Route 9", 30, 60, seed);
      withDoor(map, 7, 30);
      const r = generateRoute(map);
      expect(r.ok, `seed ${seed}: ${r.issues.filter((i) => i.severity === "error").map((i) => i.code)}`).toBe(true);
      expect(r.issues.some((i) => i.code === "unreachable-warp")).toBe(false);
      // The building and its door cell are kept as drawn.
      expect(r.terrain[29 * 30 + 7]).toBe(T.building);
      expect(r.terrain[30 * 30 + 7]).toBe(T.building);
    }
  });

  it("a warp dropped anywhere (not locked) is reached, even on hilly routes", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const { map } = blank("Route 9", 30, 60, seed);
      map.params = { elevation: 0.8 };
      map.warps.push({ ...newWarp(map, 4 + (seed % 20), 12 + seed), destMap: "MAP_ROUTE9_CAVE", destWarpId: 0, kind: "cave_mouth" });
      const r = generateRoute(map);
      expect(r.ok, `seed ${seed}: ${r.issues.filter((i) => i.severity === "error").map((i) => i.code)}`).toBe(true);
    }
  });

  it("a cave mouth warp in whole-map mode becomes a cave entrance", () => {
    const { map } = blank();
    map.warps.push({ ...newWarp(map, 20, 20), kind: "cave_mouth", destMap: "MAP_CAVE", destWarpId: 0 });
    const r = generateRoute(map);
    expect(r.terrain[20 * 30 + 20]).toBe(T.caveEntrance);
    expect(r.ok).toBe(true);
  });
});

describe("new checks", () => {
  it("a warp with no destination is a warning; one walled in is an error", () => {
    const { map } = blank();
    applyResult(map, generateRoute(map));
    map.warps.push(newWarp(map, 0, 0));
    const codes = validateMap(map).map((i) => i.code);
    expect(codes).toContain("warp-no-destination");
    expect(codes).toContain("unreachable-warp");
  });

  it("warps between two maps must lead to each other", () => {
    const region = newRegion("r", 1);
    const a = addNewMap(region, { name: "Route 9", mapType: "route", width: 20, height: 20, seed: 1, biome: "meadow" });
    const b = addNewMap(region, { name: "Cave 1", mapType: "cave", width: 20, height: 20, seed: 1, biome: "meadow" });
    a.warps.push({ ...newWarp(a, 5, 5), destMap: b.header.id, destWarpId: 0 });
    // No warp 0 on the cave yet.
    expect(validateMap(a, { otherMaps: region.maps }).map((i) => i.code)).toContain("warp-pair");
    b.warps.push({ ...newWarp(b, 3, 3), destMap: "MAP_SOMEWHERE_ELSE", destWarpId: 0 });
    expect(validateMap(a, { otherMaps: region.maps }).map((i) => i.code)).toContain("warp-pair");
    b.warps[0].destMap = a.header.id;
    expect(validateMap(a, { otherMaps: region.maps }).map((i) => i.code)).not.toContain("warp-pair");
  });

  it("an unavoidable trainer marked OK is no longer warned about", () => {
    const { map } = blank("Route 9", 20, 30);
    // A straight corridor from north to south, with a trainer looking across it.
    map.layers.terrain.data.fill(T.tree);
    for (let y = 0; y < 30; y++) for (let x = 8; x <= 10; x++) map.layers.terrain.data[y * 20 + x] = T.path;
    map.layers.terrain.data[15 * 20 + 7] = T.ground;
    map.openings = [
      { id: "o1", edge: "north", start: 8, width: 3, kind: "walk" },
      { id: "o2", edge: "south", start: 8, width: 3, kind: "walk" },
    ];
    const t = newThing(map, "trainer", 7, 15);
    t.fields.movement_type = "MOVEMENT_TYPE_FACE_RIGHT";
    map.entities.push(t);
    const issue = validateMap(map).find((i) => i.code === "unavoidable-trainer");
    expect(issue?.entityId).toBe(t.id);
    t.accepted = ["unavoidable-trainer"];
    expect(validateMap(map).some((i) => i.code === "unavoidable-trainer")).toBe(false);
  });
});
