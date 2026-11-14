// Zones: the optional plan a map can have before it's generated.
//
// A zone is a set of cells (a mask) with a kind and settings:
//   • biome       { biome }                 – this area is meadow, wetland, alpine…
//   • water       { water, depth }          – lake, pond, river, ocean or marsh; deep or shallow
//   • edge        { boundary }              – a boundary along a map edge or a drawn line:
//                                              coast, riverbank, cliff, forest wall or open
//   • keep_clear  {}                         – walkable ground: no water, no trees
//   • height      { level }                  – raised ground, 1 to 4 levels above the map's low
//                                              ground: a hill with cliffs, stairs and ledges
//
// Zones are soft by default: the generator follows their general shape with
// natural, irregular edges (fuzziness 0 = exact, 1 = loose). A hard zone is
// followed exactly. Locked cells always win over zones.
//
// Zones the generator makes itself (HM-gated areas) have data.generated = true
// and are replaced on every Generate; the user's zones are kept.

import type { Biome, Edge, MapBlueprint, Zone } from "./model";
import { BIOMES, makeGrid } from "./model";

export const ZONE_KINDS = ["biome", "water", "edge", "keep_clear", "height"] as const;
export type ZoneKind = (typeof ZONE_KINDS)[number];

export const WATER_TYPES = ["lake", "pond", "river", "ocean", "marsh"] as const;
export type WaterType = (typeof WATER_TYPES)[number];

export const BOUNDARY_TYPES = ["coast", "riverbank", "cliff", "forest", "open"] as const;
export type BoundaryType = (typeof BOUNDARY_TYPES)[number];

export const WATER_LABELS: Record<WaterType, string> = { lake: "Lake", pond: "Pond", river: "River", ocean: "Ocean", marsh: "Marsh" };
export const BOUNDARY_LABELS: Record<BoundaryType, string> = { coast: "Coast (sea)", riverbank: "Riverbank", cliff: "Cliff", forest: "Forest wall", open: "Open" };
export const BIOME_NAMES: Record<Biome, string> = {
  temperate_rainforest: "Rainforest",
  coastal: "Coastal",
  wetland: "Wetland",
  alpine: "Alpine",
  meadow: "Meadow",
  urban_edge: "Urban edge",
};

/** The most levels a raised-ground zone can ask for (Porymap elevations 4 to 7; only alpine maps build the fourth). */
export const MAX_HEIGHT_LEVEL = 4;

/** How many levels above the low ground a raised-ground zone is (1 if its setting is missing or odd). */
export function heightLevel(z: Zone): number {
  const v = Number(z.data.level);
  return Number.isFinite(v) ? Math.max(1, Math.min(MAX_HEIGHT_LEVEL, Math.round(v))) : 1;
}

/** Default fuzziness of a new (soft) zone. */
export const DEFAULT_FUZZINESS = 0.5;

/** The user's zones (not the generator's own HM areas). */
export function userZones(map: MapBlueprint): Zone[] {
  return map.layers.zones.filter((z) => z.data.generated !== true);
}

/** A readable name for a zone from its kind and settings. */
export function zoneLabel(z: Zone): string {
  if (z.kind === "biome") return BIOME_NAMES[z.data.biome as Biome] ?? "Biome";
  if (z.kind === "water") return `${WATER_LABELS[z.data.water as WaterType] ?? "Water"}${z.data.water !== "marsh" ? ` (${z.data.depth === "shallow" ? "shallow" : "deep"})` : ""}`;
  if (z.kind === "edge") return `${BOUNDARY_LABELS[z.data.boundary as BoundaryType] ?? "Edge"} edge`;
  if (z.kind === "keep_clear") return "Keep clear";
  if (z.kind === "height") return `Raised ground (${heightLevel(z)} up)`;
  return z.name;
}

/** A new, empty zone of a kind, with sensible settings. */
export function newZone(map: MapBlueprint, kind: ZoneKind, data: Zone["data"] = {}): Zone {
  let n = 1;
  while (map.layers.zones.some((z) => z.id === `zone_${n}`)) n++;
  const defaults: Record<ZoneKind, Zone["data"]> = {
    biome: { biome: "wetland" },
    water: { water: "lake", depth: "deep" },
    edge: { boundary: "coast" },
    keep_clear: {},
    height: { level: 1 },
  };
  const z: Zone = {
    id: `zone_${n}`,
    name: "",
    kind,
    hard: false,
    fuzziness: DEFAULT_FUZZINESS,
    mask: makeGrid(map.width, map.height),
    data: { ...defaults[kind], ...data },
  };
  z.name = zoneLabel(z);
  return z;
}

/**
 * The cells of a band along a map edge: `depth` cells in from the edge, between
 * `from` and `to` along it (inclusive; x for north/south edges, y for east/west).
 */
export function edgeBand(map: MapBlueprint, edge: Edge, from: number, to: number, depth: number): number[] {
  const along = edge === "north" || edge === "south" ? map.width : map.height;
  const a = Math.max(0, Math.min(from, to));
  const b = Math.min(along - 1, Math.max(from, to));
  const d = Math.max(1, Math.min(depth, edge === "north" || edge === "south" ? map.height : map.width));
  const out: number[] = [];
  for (let k = a; k <= b; k++)
    for (let j = 0; j < d; j++) {
      const [x, y] = edge === "north" ? [k, j] : edge === "south" ? [k, map.height - 1 - j] : edge === "west" ? [j, k] : [map.width - 1 - j, k];
      out.push(y * map.width + x);
    }
  return out;
}

/**
 * The water a map's zones already give it (from the region sketch, or painted in the Zones
 * tab): a river, and/or the sea (an ocean zone or a coast along an edge). A map that has
 * one doesn't get another of the same kind generated on top: the generator builds on it.
 */
export function zonedWater(map: Pick<MapBlueprint, "layers">): { river: boolean; sea: boolean } {
  const zones = map.layers.zones.filter((z) => z.data.generated !== true && z.mask.data.includes(1));
  return {
    river: zones.some((z) => (z.kind === "water" && z.data.water === "river") || (z.kind === "edge" && z.data.boundary === "riverbank")),
    sea: zones.some((z) => (z.kind === "water" && z.data.water === "ocean") || (z.kind === "edge" && z.data.boundary === "coast")),
  };
}

/** The layout to generate, given the water the map's zones already have: no second river, no second sea. */
export function layoutOver<L extends string>(map: Pick<MapBlueprint, "layers">, layout: L): L | "land" {
  const has = zonedWater(map);
  return (layout === "river" && has.river) || (layout === "coastal" && has.sea) ? "land" : layout;
}

export function isBiome(v: unknown): v is Biome {
  return typeof v === "string" && (BIOMES as readonly string[]).includes(v);
}
