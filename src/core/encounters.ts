// Wild encounters: the region's species list (pasted by the user) and each map's
// draft encounter tables, in the shape of pokeemerald's src/data/wild_encounters.json.
//
// The tool ships no Pokémon data: the user pastes a list of species with their
// levels and where they live. The draft is only a starting point to finish by hand.
//
// Facts from pokeemerald's src/data/wild_encounters.json ("fields" block, and the
// MAP_ROUTE101–103, MAP_ROUTE111 and MAP_GRANITE_CAVE entries):
//   • land_mons: 12 slots, chances 20 20 10 10 10 10 5 5 4 4 1 1 (%), rate 20 on routes, 10 in caves;
//   • water_mons (Surf): 5 slots, 60 30 5 4 1, rate 4;
//   • rock_smash_mons: 5 slots, 60 30 5 4 1, rate 20;
//   • fishing_mons: 10 slots, 70 30 | 60 20 20 | 40 40 15 4 1, groups old_rod [0,1],
//     good_rod [2,3,4], super_rod [5..9], rate 30.

import type { Biome, MapBlueprint } from "./model";
import { BIOMES } from "./model";
import { Rng, deriveSeed } from "./rng";
import { TERRAIN_TYPES } from "./terrain";

export const HABITATS = ["land", "surf", "fish", "rock"] as const;
export type Habitat = (typeof HABITATS)[number];
export const RARITIES = ["common", "uncommon", "rare"] as const;
export type Rarity = (typeof RARITIES)[number];

/** One line of the species list. */
export interface SpeciesEntry {
  /** SPECIES_* constant. */
  species: string;
  minLevel: number;
  maxLevel: number;
  /** Where it's found: land (grass, caves), surf, fish, rock (Rock Smash). */
  habitats: Habitat[];
  /** Biomes it's most at home in (more likely there). Empty = anywhere. */
  biomes: Biome[];
  rarity: Rarity;
}

export const TABLES = ["land", "surf", "rock", "fish"] as const;
export type TableKind = (typeof TABLES)[number];

export interface EncounterSlot {
  species: string;
  min: number;
  max: number;
}

export interface EncounterTable {
  /** Porymap/pokeemerald "encounter_rate": how often encounters happen. */
  rate: number;
  slots: EncounterSlot[];
}

/** A map's draft encounter tables. */
export interface EncounterPlan {
  land?: EncounterTable;
  surf?: EncounterTable;
  rock?: EncounterTable;
  fish?: EncounterTable;
  /** Edited by hand: Generate leaves the draft alone. */
  locked?: boolean;
}

export const SLOT_CHANCES: Record<TableKind, number[]> = {
  land: [20, 20, 10, 10, 10, 10, 5, 5, 4, 4, 1, 1],
  surf: [60, 30, 5, 4, 1],
  rock: [60, 30, 5, 4, 1],
  fish: [70, 30, 60, 20, 20, 40, 40, 15, 4, 1],
};

/** Fishing slots by rod (indices into the fishing table). */
export const ROD_SLOTS = { old_rod: [0, 1], good_rod: [2, 3, 4], super_rod: [5, 6, 7, 8, 9] } as const;

/** pokeemerald's names for each table. */
export const TABLE_FIELD: Record<TableKind, string> = { land: "land_mons", surf: "water_mons", rock: "rock_smash_mons", fish: "fishing_mons" };

export const TABLE_LABELS: Record<TableKind, string> = { land: "Grass (land)", surf: "Surfing", rock: "Rock Smash", fish: "Fishing" };

/** Suggested encounter_rate, as on vanilla routes (caves use 10 for land). */
export function defaultRate(kind: TableKind, cave: boolean): number {
  return kind === "land" ? (cave ? 10 : 20) : kind === "surf" ? 4 : kind === "rock" ? 20 : 30;
}

/** How many different species a drafted table uses (vanilla routes use about this many). */
const VARIETY: Record<TableKind, number> = { land: 4, surf: 3, rock: 2, fish: 4 };

const HABITAT_WORDS: Record<string, Habitat> = {
  land: "land",
  grass: "land",
  cave: "land",
  surf: "surf",
  water: "surf",
  fish: "fish",
  fishing: "fish",
  rod: "fish",
  rock: "rock",
  rock_smash: "rock",
  rocksmash: "rock",
  smash: "rock",
};

/**
 * Read a pasted species list. One species per line, words in any order, e.g.
 *
 *     ZIGZAGOON 2-5 land meadow common
 *     SPECIES_MAGIKARP,5,10,fish
 *
 * Commas, tabs and semicolons count as spaces (so a CSV copied from a
 * spreadsheet works). The name may leave out "SPECIES_". Levels are "5" or
 * "2-5" (or two numbers). Habitat words: land/grass/cave, surf/water,
 * fish/fishing, rock/smash. Biome words: any biome id. Rarity: common,
 * uncommon or rare. A line with no habitat counts as land. Header lines and
 * lines starting with # are skipped.
 */
export function parseSpeciesList(text: string): { entries: SpeciesEntry[]; problems: string[] } {
  const entries: SpeciesEntry[] = [];
  const problems: string[] = [];
  text.split(/\r?\n/).forEach((raw, k) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const words = line.split(/[\s,;\t]+/).filter(Boolean);
    let species = "";
    const levels: number[] = [];
    const habitats = new Set<Habitat>();
    const biomes = new Set<Biome>();
    let rarity: Rarity = "common";
    for (const w of words) {
      const lower = w.toLowerCase();
      const range = /^(\d{1,3})(?:-(\d{1,3}))?$/.exec(w);
      if (range) {
        levels.push(Number(range[1]));
        if (range[2]) levels.push(Number(range[2]));
      } else if (HABITAT_WORDS[lower]) habitats.add(HABITAT_WORDS[lower]);
      else if ((BIOMES as readonly string[]).includes(lower)) biomes.add(lower as Biome);
      else if ((RARITIES as readonly string[]).includes(lower)) rarity = lower as Rarity;
      else if (!species && /^[A-Za-z][A-Za-z0-9_]*$/.test(w)) species = w.toUpperCase().startsWith("SPECIES_") ? w.toUpperCase() : `SPECIES_${w.toUpperCase()}`;
    }
    // A header row ("species, min, max, …") has a name but no levels.
    if (!levels.length) {
      if (k > 0 || !/species|name|pokemon/i.test(line)) problems.push(`Line ${k + 1}: no level found in "${line.slice(0, 40)}".`);
      return;
    }
    if (!species) {
      problems.push(`Line ${k + 1}: no species name found in "${line.slice(0, 40)}".`);
      return;
    }
    const lo = Math.max(1, Math.min(100, Math.min(...levels)));
    const hi = Math.max(1, Math.min(100, Math.max(...levels)));
    entries.push({ species: species.slice(0, 64), minLevel: lo, maxLevel: hi, habitats: habitats.size ? [...habitats] : ["land"], biomes: [...biomes], rarity });
  });
  return { entries, problems };
}

/** The list written back as text, one line per species (the format parseSpeciesList reads). */
export function speciesListText(entries: readonly SpeciesEntry[]): string {
  return entries
    .map((e) => [e.species.replace(/^SPECIES_/, ""), e.minLevel === e.maxLevel ? `${e.minLevel}` : `${e.minLevel}-${e.maxLevel}`, ...e.habitats, ...e.biomes, ...(e.rarity === "common" ? [] : [e.rarity])].join(" "))
    .join("\n");
}

/** A short example list, so the draft can be tried out. Placeholders: replace with your own. */
export const EXAMPLE_SPECIES = `# Example list: replace with your own species. One per line:
# NAME  levels  where (land, surf, fish, rock)  [biomes]  [common/uncommon/rare]
ZIGZAGOON 2-5 land meadow urban_edge
POOCHYENA 2-5 land
WURMPLE 2-4 land temperate_rainforest
TAILLOW 3-6 land meadow uncommon
SEEDOT 3-6 land temperate_rainforest uncommon
RALTS 4-6 land rare
LOTAD 3-6 land wetland
MARILL 4-8 land surf wetland uncommon
WINGULL 5-10 land surf coastal
TENTACOOL 5-25 surf coastal
MAGIKARP 5-15 fish
GOLDEEN 10-20 fish uncommon
GEODUDE 6-10 rock alpine
NOSEPASS 8-12 rock rare`;

/** Which tables the map needs: grass or cave floor → land; deep water → surf and fishing; Rock Smash rocks → rock. */
export function neededTables(map: MapBlueprint): TableKind[] {
  let land = false;
  let water = false;
  for (const t of map.layers.terrain.data) {
    const e = TERRAIN_TYPES[t]?.encounters;
    if (e === "land" || e === "cave") land = true;
    if (e === "water") water = true;
  }
  const out: TableKind[] = [];
  if (land) out.push("land");
  if (water) out.push("surf");
  if (map.entities.some((e) => e.kind === "smash_rock")) out.push("rock");
  if (water) out.push("fish");
  return out;
}

const RARITY_WEIGHT: Record<Rarity, number> = { common: 4, uncommon: 2, rare: 1 };

/** Biomes on the map: its own, plus any biome zones. */
function mapBiomes(map: MapBlueprint): Set<Biome> {
  const out = new Set<Biome>([map.biome]);
  for (const z of map.layers.zones) if (z.kind === "biome" && typeof z.data.biome === "string") out.add(z.data.biome as Biome);
  return out;
}

/**
 * Draft one table: pick a few species that live there and fit the level band
 * (more likely if at home in the map's biome, less if rare), then share the
 * slots out so common species fill the likely slots and rare ones the 1% slots.
 * Returns null if nothing in the list fits.
 */
function draftTable(kind: TableKind, pool: readonly SpeciesEntry[], band: [number, number], biomes: Set<Biome>, cave: boolean, rng: Rng): EncounterTable | null {
  const habitat: Habitat = kind;
  const [lo, hi] = band;
  const fits = pool.filter((e) => e.habitats.includes(habitat) && e.minLevel <= hi && e.maxLevel >= lo);
  if (!fits.length) return null;
  const weight = (e: SpeciesEntry) => RARITY_WEIGHT[e.rarity] * (e.biomes.length === 0 ? 1 : e.biomes.some((b) => biomes.has(b)) ? 2.5 : 0.4);
  // Weighted pick of a few different species.
  const chosen: SpeciesEntry[] = [];
  const left = [...fits];
  while (chosen.length < VARIETY[kind] && left.length) {
    const total = left.reduce((s, e) => s + weight(e), 0);
    let r = rng.next() * total;
    let k = 0;
    while (k < left.length - 1 && (r -= weight(left[k])) > 0) k++;
    chosen.push(left.splice(k, 1)[0]);
  }
  chosen.sort((a, b) => weight(b) - weight(a));
  const chances = SLOT_CHANCES[kind];
  const totalWeight = chosen.reduce((s, e) => s + weight(e), 0);
  const share = new Map(chosen.map((e) => [e, 0]));
  // Fishing: each rod is its own little table, with levels rising Old → Good → Super.
  const rodOf = (slot: number) => (slot < 2 ? 0 : slot < 5 ? 1 : 2);
  const groupTotal = kind === "fish" ? [100, 100, 100] : [100];
  const slots: EncounterSlot[] = chances.map((chance, slot) => {
    const group = kind === "fish" ? rodOf(slot) : 0;
    // The slot goes to whichever species is furthest below its fair share of chances.
    let best = chosen[0];
    let bestGap = -Infinity;
    for (const e of chosen) {
      const gap = (weight(e) / totalWeight) * groupTotal[group] * (kind === "fish" ? 3 : 1) - share.get(e)!;
      if (gap > bestGap) {
        bestGap = gap;
        best = e;
      }
    }
    share.set(best, share.get(best)! + chance);
    // Levels: inside both the band and the species' range; fishing rises by rod.
    let a = Math.max(lo, best.minLevel);
    let b = Math.min(hi, best.maxLevel);
    if (kind === "fish") {
      const span = b - a;
      a = a + Math.round((span * group) / 3);
      b = Math.max(a, a + Math.round(span / 3));
      b = Math.min(b, Math.min(hi, best.maxLevel));
    }
    const min = rng.int(a, Math.max(a, b));
    const max = Math.min(b, min + rng.int(0, 1));
    return { species: best.species, min, max: Math.max(min, max) };
  });
  return { rate: defaultRate(kind, cave), slots };
}

/** The level band for a map (Generate tab → Gameplay), default 3–6. */
export function levelBand(map: MapBlueprint): [number, number] {
  const n = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.max(1, Math.min(100, Math.round(v))) : d);
  const lo = n(map.params.levelMin, 3);
  const hi = n(map.params.levelMax, 6);
  return [Math.min(lo, hi), Math.max(lo, hi)];
}

/**
 * Draft encounter tables for a map from the species list: only the tables the
 * map needs. `salt` gives a different draft for the same map (the Redraft button).
 */
export function draftEncounters(map: MapBlueprint, pool: readonly SpeciesEntry[], salt = 0): EncounterPlan {
  const rng = new Rng(deriveSeed(map.seed, `encounters${salt}`));
  const biomes = mapBiomes(map);
  const cave = map.mapType === "cave";
  const band = levelBand(map);
  const plan: EncounterPlan = {};
  for (const kind of neededTables(map)) {
    const t = draftTable(kind, pool, band, biomes, cave, rng);
    if (t) plan[kind] = t;
  }
  return plan;
}

/** An empty table of the right size, for filling in by hand. */
export function emptyTable(kind: TableKind, cave: boolean): EncounterTable {
  return { rate: defaultRate(kind, cave), slots: SLOT_CHANCES[kind].map(() => ({ species: "SPECIES_NONE", min: 1, max: 1 })) };
}

/**
 * The map's entry for wild_encounters.json: { map, base_label, land_mons: {
 * encounter_rate, mons: [{ min_level, max_level, species }] }, … }.
 */
export function wildEncountersEntry(map: MapBlueprint, plan: EncounterPlan): Record<string, unknown> {
  const out: Record<string, unknown> = { map: map.header.id, base_label: `g${map.header.name}` };
  for (const kind of TABLES) {
    const t = plan[kind];
    if (!t) continue;
    out[TABLE_FIELD[kind]] = { encounter_rate: t.rate, mons: t.slots.map((s) => ({ min_level: s.min, max_level: s.max, species: s.species })) };
  }
  return out;
}
