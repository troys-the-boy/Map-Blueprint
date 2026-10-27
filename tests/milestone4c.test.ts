// Milestone 4, part C: the species list and the encounter draft.

import { describe, expect, it } from "vitest";
import {
  EXAMPLE_SPECIES,
  SLOT_CHANCES,
  draftEncounters,
  neededTables,
  parseSpeciesList,
  speciesListText,
  wildEncountersEntry,
} from "../src/core/encounters";
import { applyResult, generateRoute } from "../src/core/generate";
import { addNewMap, newRegion } from "../src/core/model";
import { CURRENT_SCHEMA_VERSION, parseProject, serializeProject } from "../src/core/project";
import { newThing } from "../src/core/things";
import { validateMap } from "../src/core/validate";

function route(seed = 3, params: Record<string, number | string> = {}) {
  const region = newRegion("r", 1);
  const map = addNewMap(region, { name: "Route 7", mapType: "route", width: 30, height: 60, seed, biome: "meadow" });
  map.params = params;
  applyResult(map, generateRoute(map));
  return { region, map };
}

const pool = parseSpeciesList(EXAMPLE_SPECIES).entries;

describe("the species list", () => {
  it("reads lines in any order, CSV too, and reports what it can't read", () => {
    const { entries, problems } = parseSpeciesList("species,min,max,where\nZIGZAGOON 2-5 land meadow\nSPECIES_MAGIKARP,5,10,fish,rare\nwhat is this\n# a comment\nGEODUDE 7 rock alpine uncommon");
    expect(entries).toEqual([
      { species: "SPECIES_ZIGZAGOON", minLevel: 2, maxLevel: 5, habitats: ["land"], biomes: ["meadow"], rarity: "common" },
      { species: "SPECIES_MAGIKARP", minLevel: 5, maxLevel: 10, habitats: ["fish"], biomes: [], rarity: "rare" },
      { species: "SPECIES_GEODUDE", minLevel: 7, maxLevel: 7, habitats: ["rock"], biomes: ["alpine"], rarity: "uncommon" },
    ]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/Line 4/);
  });

  it("writes back to text that reads the same", () => {
    expect(parseSpeciesList(speciesListText(pool)).entries).toEqual(pool);
  });
});

describe("the encounter draft", () => {
  it("drafts only the tables the map needs, with vanilla slot counts and rates", () => {
    const { map } = route();
    const plan = draftEncounters(map, pool);
    const needed = neededTables(map);
    expect(needed).toContain("land");
    for (const kind of needed) {
      expect(plan[kind]?.slots).toHaveLength(SLOT_CHANCES[kind].length);
    }
    expect(plan.land!.rate).toBe(20);
    // No surfing table without deep water, no rock table without Rock Smash rocks.
    if (!needed.includes("surf")) expect(plan.surf).toBeUndefined();
    if (!needed.includes("rock")) expect(plan.rock).toBeUndefined();
  });

  it("keeps levels inside the band and each species' own range", () => {
    const { map } = route(5, { levelMin: 4, levelMax: 7 });
    const plan = draftEncounters(map, pool);
    for (const slot of plan.land!.slots) {
      const sp = pool.find((e) => e.species === slot.species)!;
      expect(sp.habitats).toContain("land");
      expect(slot.min).toBeGreaterThanOrEqual(Math.max(4, sp.minLevel));
      expect(slot.max).toBeLessThanOrEqual(Math.min(7, sp.maxLevel));
      expect(slot.max).toBeGreaterThanOrEqual(slot.min);
    }
  });

  it("puts common species in the likely slots and rare ones in the unlikely slots", () => {
    let rareInTop = 0;
    let rareInBottom = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const { map } = route(seed);
      const slots = draftEncounters(map, pool).land!.slots;
      const rare = (k: number) => pool.find((e) => e.species === slots[k].species)!.rarity === "rare";
      if (rare(0) || rare(1)) rareInTop++;
      if (rare(10) || rare(11)) rareInBottom++;
    }
    expect(rareInTop).toBe(0);
    expect(rareInBottom).toBeGreaterThan(0);
  });

  it("drafts surfing, fishing and rock smash where the map has water and rocks", () => {
    const { map } = route(2, { layout: "coastal" });
    map.entities.push(newThing(map, "smash_rock", 5, 5));
    const plan = draftEncounters(map, pool);
    expect(plan.surf?.rate).toBe(4);
    expect(plan.fish?.rate).toBe(30);
    expect(plan.rock?.rate).toBe(20);
    expect(plan.fish!.slots).toHaveLength(10);
  });

  it("is the same for the same seed, and different when redrafted", () => {
    const { map } = route();
    expect(draftEncounters(map, pool)).toEqual(draftEncounters(map, pool));
    const again = [1, 2, 3, 4].map((salt) => JSON.stringify(draftEncounters(map, pool, salt)));
    expect(new Set(again).size).toBeGreaterThan(1);
  });

  it("is written in wild_encounters.json's shape", () => {
    const { map } = route();
    const entry = wildEncountersEntry(map, draftEncounters(map, pool)) as Record<string, { encounter_rate: number; mons: unknown[] }> & { map: string; base_label: string };
    expect(entry.map).toBe("MAP_ROUTE7");
    expect(entry.base_label).toBe("gRoute7");
    expect(entry.land_mons.encounter_rate).toBe(20);
    expect(entry.land_mons.mons[0]).toEqual({ min_level: expect.any(Number), max_level: expect.any(Number), species: expect.stringMatching(/^SPECIES_/) });
  });
});

describe("checks and saving", () => {
  it("warns when there's no draft, or a needed table is missing", () => {
    const { map } = route(2, { layout: "coastal" });
    expect(validateMap(map).map((i) => i.code)).toContain("no-encounters");
    map.encounterPlan = { land: draftEncounters(map, pool).land };
    expect(validateMap(map).map((i) => i.code)).toContain("missing-encounter-table");
    map.encounterPlan = draftEncounters(map, pool);
    expect(validateMap(map).map((i) => i.code)).not.toContain("missing-encounter-table");
  });

  it("saves and opens the species list and the draft (file format 8 and later)", () => {
    const { region, map } = route();
    region.speciesPool = pool;
    map.encounterPlan = { ...draftEncounters(map, pool), locked: true };
    expect(CURRENT_SCHEMA_VERSION).toBeGreaterThanOrEqual(8);
    const loaded = parseProject(serializeProject(region, "test"));
    expect(loaded.speciesPool).toEqual(pool);
    expect(loaded.maps[0].encounterPlan).toEqual(map.encounterPlan);
  });

  it("opens a format 7 file (no species list yet)", () => {
    const { region } = route();
    const file = JSON.parse(serializeProject(region, "test"));
    file.schemaVersion = 7;
    delete file.region.speciesPool;
    expect(parseProject(JSON.stringify(file)).speciesPool).toEqual([]);
  });

  it("saves and opens a connection to another map in the project", () => {
    const region = newRegion("r", 1);
    const a = addNewMap(region, { name: "Route 7", mapType: "route", width: 20, height: 20, seed: 1, biome: "meadow" });
    const b = addNewMap(region, { name: "Route 8", mapType: "route", width: 20, height: 20, seed: 1, biome: "meadow" });
    a.connections.push({ direction: "up", map: b.id, offset: 3 });
    expect(parseProject(serializeProject(region, "test")).maps[0].connections).toEqual([{ direction: "up", map: b.id, offset: 3 }]);
  });
});
