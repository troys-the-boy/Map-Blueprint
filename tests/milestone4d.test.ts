// Milestone 4, part D: the rebuild packet.

import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { draftEncounters, parseSpeciesList, EXAMPLE_SPECIES } from "../src/core/encounters";
import { EXPORTERS, rebuildPacket } from "../src/core/exporters";
import { checklistSteps, mapJson } from "../src/core/exporters/rebuild";
import { applyResult, generateRoute } from "../src/core/generate";
import { addNewMap, newRegion } from "../src/core/model";
import { newThing, newWarp } from "../src/core/things";
import { validateMap } from "../src/core/validate";

/** A finished route: generated with a travel direction, a cave mouth, a berry tree, a trigger and an encounter draft. */
function finishedRoute() {
  const region = newRegion("Cascadia", 1);
  const map = addNewMap(region, { name: "Route 7", mapType: "route", width: 30, height: 60, seed: 11, biome: "temperate_rainforest" });
  const town = addNewMap(region, { name: "Fir Town", mapType: "town", width: 30, height: 20, seed: 1, biome: "temperate_rainforest" });
  map.params = { travel: "south_north" };
  map.warps.push({ ...newWarp(map, 20, 30), kind: "cave_mouth", destMap: "MAP_MOSS_CAVE", destWarpId: 0 });
  applyResult(map, generateRoute(map));
  map.connections.push({ direction: "up", map: town.id, offset: 0 });
  region.speciesPool = parseSpeciesList(EXAMPLE_SPECIES).entries;
  map.encounterPlan = draftEncounters(map, region.speciesPool);
  return { region, map, ctx: { paletteId: "pnw", regionName: region.name, appVersion: "test", maps: region.maps } };
}

describe("Milestone 4 goal: a full rebuild packet exports for one route", () => {
  it("has every sheet, and the index links only to files in the packet", () => {
    const { map, ctx } = finishedRoute();
    expect(validateMap(map, { otherMaps: ctx.maps }).filter((i) => i.severity === "error")).toEqual([]);
    const file = rebuildPacket.run(map, ctx);
    expect(file.name).toBe("Route-7-rebuild.zip");
    const files = unzipSync(file.data as Uint8Array);
    const names = Object.keys(files).map((n) => n.replace(/^Route-7-rebuild\//, ""));
    for (const want of [
      "index.html",
      "checklist.html",
      "checklist.md",
      "blueprint.png",
      "elevation.png",
      "screens/A1.png",
      "screens/B6.png",
      "screens/elevation/A1.png",
      "screens/index.txt",
      "placements.html",
      "placements.csv",
      "header-sheet.html",
      "map.json",
      "encounters.html",
      "wild_encounters-entry.json",
      "grid.json",
    ])
      expect(names, want).toContain(want);
    const index = strFromU8(files["Route-7-rebuild/index.html"]);
    for (const [, href] of index.matchAll(/href="([^"]+)"/g)) expect(names, href).toContain(href);
    // PNGs are real PNGs.
    expect(Array.from(files["Route-7-rebuild/blueprint.png"].subarray(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
    // The JSON files parse.
    for (const n of ["map.json", "wild_encounters-entry.json", "grid.json"]) expect(() => JSON.parse(strFromU8(files[`Route-7-rebuild/${n}`]))).not.toThrow();
  });

  it("map.json has vanilla's keys in vanilla's order, and the events numbered as in the placement table", () => {
    const { map, ctx } = finishedRoute();
    const json = mapJson(map, ctx.maps);
    expect(Object.keys(json)).toEqual([
      "id",
      "name",
      "layout",
      "music",
      "region_map_section",
      "requires_flash",
      "weather",
      "map_type",
      "allow_cycling",
      "allow_escaping",
      "allow_running",
      "show_map_name",
      "battle_scene",
      "connections",
      "object_events",
      "warp_events",
      "coord_events",
      "bg_events",
    ]);
    expect(json.layout).toBe("LAYOUT_ROUTE7");
    expect(json.connections).toEqual([{ map: "MAP_FIR_TOWN", offset: 0, direction: "up" }]);
    expect(json.warp_events).toEqual([{ x: 20, y: 30, elevation: 3, dest_map: "MAP_MOSS_CAVE", dest_warp_id: "0" }]);
    const objects = json.object_events as Array<Record<string, unknown>>;
    expect(objects.length).toBe(map.entities.filter((e) => ["trainer", "npc", "item_ball", "cut_tree", "smash_rock", "strength_boulder", "berry_tree"].includes(e.kind)).length);
    // Every object event has exactly vanilla's fields (as on Route101).
    for (const o of objects)
      expect(Object.keys(o)).toEqual(["graphics_id", "x", "y", "elevation", "movement_type", "movement_range_x", "movement_range_y", "trainer_type", "trainer_sight_or_berry_tree_id", "script", "flag"]);
    const bg = json.bg_events as Array<Record<string, unknown>>;
    expect(bg.some((b) => b.type === "sign")).toBe(true);
  });

  it("a map without connections writes connections: null, like vanilla interiors", () => {
    const region = newRegion("r", 1);
    const map = addNewMap(region, { name: "House", mapType: "interior_stub", width: 10, height: 10, seed: 1, biome: "meadow" });
    expect(mapJson(map).connections).toBeNull();
  });

  it("triggers, weather triggers, hidden items and secret bases become the right event types", () => {
    const { map } = finishedRoute();
    // Each is added before the next is made, so they get different IDs (X1, X2).
    map.entities.push(newThing(map, "trigger", 3, 3));
    const w = newThing(map, "trigger", 4, 3);
    w.fields.type = "weather";
    w.fields.weather = "COORD_EVENT_WEATHER_RAIN";
    map.entities.push(w);
    map.entities.push(newThing(map, "secret_base", 5, 3));
    map.entities.push(newThing(map, "berry_tree", 6, 3));
    const json = mapJson(map);
    const coords = json.coord_events as Array<Record<string, unknown>>;
    expect(coords.find((c) => c.type === "trigger")).toMatchObject({ var: expect.stringMatching(/^VAR_/), var_value: "0" });
    expect(coords.find((c) => c.type === "weather")).toEqual({ type: "weather", x: 4, y: 3, elevation: expect.any(Number), weather: "COORD_EVENT_WEATHER_RAIN" });
    expect((json.bg_events as Array<Record<string, unknown>>).find((b) => b.type === "secret_base")).toMatchObject({ secret_base_id: expect.stringMatching(/^SECRET_BASE_/) });
    expect((json.object_events as Array<Record<string, unknown>>).find((o) => o.graphics_id === "OBJ_EVENT_GFX_BERRY_TREE")).toMatchObject({ movement_type: "MOVEMENT_TYPE_BERRY_TREE_GROWTH" });
  });

  it("the checklist has the six Porymap steps, ending with walking every exit", () => {
    const { map, ctx } = finishedRoute();
    const steps = checklistSteps(map, ctx);
    expect(steps.map((s) => s.title)).toEqual([
      "Create the map with these settings",
      "Set the size and border",
      "Paint by screen tile",
      "Place events",
      "Set connections",
      "Paste encounters",
      "Run the game and walk every exit",
    ]);
    expect(steps[4].items.join(" ")).toContain("MAP_FIR_TOWN, offset 0");
    expect(steps[3].items.join(" ")).toContain("Warp W0 at (20, 30) → MAP_MOSS_CAVE");
  });

  it("every exporter runs, and names from the project can't inject HTML", () => {
    const { map, ctx } = finishedRoute();
    map.header.music = "<script>alert(1)</script>";
    for (const e of EXPORTERS) {
      const out = e.run(map, ctx);
      if (typeof out.data === "string" && out.mime === "text/html") expect(out.data, e.id).not.toContain("<script>");
    }
  });
});
