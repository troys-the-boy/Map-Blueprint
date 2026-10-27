// Terrain vocabulary: the abstract terrain types a blueprint is painted with.
//
// The list itself lives in profiles/terrain.json so new types can be added
// without code changes. This file loads it, checks it, and gives fast lookups.
// Inside the app each type is identified by its index in TERRAIN_TYPES; saved
// files store names (see project.ts), so reordering the JSON never breaks files.

import vocabularyJson from "../../profiles/terrain.json";
import pnwPaletteJson from "../../profiles/palettes/pnw.json";
import highContrastPaletteJson from "../../profiles/palettes/high-contrast.json";

/** How the player can move onto a cell. */
export type Passability =
  | "walk" // walkable
  | "blocked" // never walkable
  | "one_way" // ledge: can only be crossed in `direction`
  | "surf" // needs Surf
  | "hm" // needs the HM in `hm` (Waterfall, Dive)
  | "warp"; // stepping on it warps (cave entrance)

export type Direction = "n" | "s" | "e" | "w";

/** Abstract elevation levels, mapped to real Gen 3 values by a tileset profile. */
export const ELEVATION_LEVELS = ["water", "ground", "raised1", "raised2", "raised3", "raised4", "bridge"] as const;
export type ElevationLevel = (typeof ELEVATION_LEVELS)[number];

export interface TerrainType {
  id: string;
  label: string;
  category: string;
  passability: Passability;
  hm?: string;
  direction?: Direction;
  /** Ice: the player keeps sliding across it until something stops them. */
  slide?: boolean;
  /** Which encounter table this terrain triggers, if any. */
  encounters: "land" | "water" | "cave" | null;
  /** The elevation level this terrain normally sits at. */
  elevation: ElevationLevel;
  /** Optional short symbol drawn on top of the color (arrows for ledges, etc.). */
  glyph?: string;
  note: string;
}

export interface TerrainPalette {
  id: string;
  name: string;
  description: string;
  colors: Record<string, string>;
}

const PASSABILITIES: readonly Passability[] = ["walk", "blocked", "one_way", "surf", "hm", "warp"];
const DIRECTIONS: readonly Direction[] = ["n", "s", "e", "w"];

function loadVocabulary(raw: unknown): TerrainType[] {
  const doc = raw as { types?: unknown };
  if (!Array.isArray(doc.types)) throw new Error("profiles/terrain.json: missing the \"types\" list");
  const seen = new Set<string>();
  return doc.types.map((t: TerrainType, i: number) => {
    const where = `profiles/terrain.json, entry ${i + 1} (${t?.id ?? "no id"})`;
    if (typeof t.id !== "string" || !/^[a-z][a-z0-9_]*$/.test(t.id))
      throw new Error(`${where}: "id" must be lowercase letters, digits and underscores`);
    if (seen.has(t.id)) throw new Error(`${where}: the id "${t.id}" is used twice`);
    seen.add(t.id);
    if (!PASSABILITIES.includes(t.passability))
      throw new Error(`${where}: "passability" must be one of ${PASSABILITIES.join(", ")}`);
    if (t.direction !== undefined && !DIRECTIONS.includes(t.direction))
      throw new Error(`${where}: "direction" must be one of n, s, e, w`);
    if (t.passability === "one_way" && t.direction === undefined)
      throw new Error(`${where}: a one-way (ledge) type needs a "direction"`);
    if (t.passability === "one_way" && t.direction === "n")
      throw new Error(`${where}: vanilla Emerald has no north-facing ledge`);
    if (!ELEVATION_LEVELS.includes(t.elevation))
      throw new Error(`${where}: "elevation" must be one of ${ELEVATION_LEVELS.join(", ")}`);
    return {
      id: t.id,
      label: String(t.label ?? t.id),
      category: String(t.category ?? "other"),
      passability: t.passability,
      hm: t.hm,
      direction: t.direction,
      slide: t.slide === true ? true : undefined,
      encounters: t.encounters ?? null,
      elevation: t.elevation,
      glyph: t.glyph,
      note: String(t.note ?? ""),
    };
  });
}

function loadPalette(raw: unknown, types: TerrainType[]): TerrainPalette {
  const p = raw as TerrainPalette;
  for (const t of types) {
    const c = p.colors?.[t.id];
    if (typeof c !== "string" || !/^#[0-9a-fA-F]{6}$/.test(c))
      throw new Error(`Palette "${p.id}": missing or invalid color for terrain "${t.id}" (use #rrggbb)`);
  }
  return { id: p.id, name: p.name, description: p.description, colors: p.colors };
}

/** All terrain types, in the order of profiles/terrain.json. */
export const TERRAIN_TYPES: readonly TerrainType[] = loadVocabulary(vocabularyJson);

const indexById = new Map(TERRAIN_TYPES.map((t, i) => [t.id, i]));

/** Index of a terrain type by id, or -1 if unknown. */
export function terrainIndex(id: string): number {
  return indexById.get(id) ?? -1;
}

/** Index of a terrain type that must exist (throws a readable error otherwise). */
export function requireTerrain(id: string): number {
  const i = terrainIndex(id);
  if (i < 0) throw new Error(`Unknown terrain type "${id}". Check profiles/terrain.json.`);
  return i;
}

/** The terrain new maps are filled with. */
export const DEFAULT_FILL_TERRAIN = "ground";

export const PALETTES: readonly TerrainPalette[] = [
  loadPalette(pnwPaletteJson, TERRAIN_TYPES as TerrainType[]),
  loadPalette(highContrastPaletteJson, TERRAIN_TYPES as TerrainType[]),
];

export function getPalette(id: string): TerrainPalette {
  return PALETTES.find((p) => p.id === id) ?? PALETTES[0];
}
