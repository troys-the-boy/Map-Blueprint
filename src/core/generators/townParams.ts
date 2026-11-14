// Town generator settings: names, defaults and allowed ranges. Saved in the
// map's `params` beside the route settings it shares (tree density, border,
// hidden items, levels), so a project file reproduces the same town.
//
// Building footprints are in metatiles. They're typical Gen 3 sizes, not
// checked against pokeemerald's layouts (those are binary map.bin files): the
// user can change them here. Every Gen 3 building's door is on its front
// (south) face, because the tilesets draw buildings from the front.

import type { Settlement } from "../model";

// Town plans. Every plan grows the town from a core (the middle of the town, between its
// entrances): the Pokémon Center and Mart stand there, and the houses fill outward from it,
// close together, so a big map gets a compact town with country round it instead of buildings
// scattered across the whole map. (Growing a settlement in phases from a core is the approach
// Magna Urbis describes for its towns; this is written for this grid, not taken from it.)
export const TOWN_LAYOUTS = ["square", "crossroads", "grid", "organic", "waterfront", "riverside"] as const;
export type TownLayout = (typeof TOWN_LAYOUTS)[number];

export const TOWN_LAYOUT_LABELS: Record<TownLayout, string> = {
  square: "Market square",
  crossroads: "Crossroads village",
  grid: "Grid: streets in blocks",
  organic: "Winding lanes",
  waterfront: "Harbour: along the shore",
  riverside: "Riverside: a river through town",
};

/** The water a plan needs laid before the town is built: the sea along one side, a river through it, or none. */
export function townWater(layout: TownLayout): "coastal" | "river" | "land" {
  return layout === "waterfront" ? "coastal" : layout === "riverside" ? "river" : "land";
}

export const BUILDING_KINDS = ["center", "mart", "gym", "landmark", "house"] as const;
export type BuildingKind = (typeof BUILDING_KINDS)[number];

export interface BuildingType {
  label: string;
  width: number;
  height: number;
  /** End of the interior's MAP_* constant, after the town's: MAP_OLDALE_TOWN + "_MART". */
  interior: string;
}

/** Default footprints (editable in the Generate tab). */
export const BUILDING_TYPES: Record<BuildingKind, BuildingType> = {
  center: { label: "Pokémon Center", width: 5, height: 4, interior: "_POKEMON_CENTER_1F" },
  mart: { label: "Mart", width: 4, height: 4, interior: "_MART" },
  gym: { label: "Gym", width: 7, height: 6, interior: "_GYM" },
  landmark: { label: "Landmark building", width: 6, height: 5, interior: "_LANDMARK" },
  house: { label: "House", width: 4, height: 3, interior: "_HOUSE" },
};

export interface TownParams {
  townLayout: TownLayout;
  center: boolean;
  mart: boolean;
  gym: boolean;
  landmark: boolean;
  houses: number;
  /** Some houses are bigger (5×4), like the larger family houses in vanilla towns. */
  largeHouses: number;
  /** A wall (fence) round the built-up part of the town, with gaps where the streets pass. */
  wall: boolean;
  /** Fields, orchards, paddocks, ponds and berry patches round the town, 0 … 1 (0 = none). See outskirts.ts. */
  outskirts: number;
  /** People walking around town. */
  people: number;
  /** Small optional patches of tall grass near the edges, 0 … 1. Never needed to get anywhere. */
  edgeGrass: number;
}

export const DEFAULT_TOWN_PARAMS: TownParams = {
  townLayout: "grid",
  center: true,
  mart: true,
  gym: false,
  landmark: false,
  houses: 3,
  largeHouses: 1,
  wall: false,
  outskirts: 0.5,
  people: 3,
  edgeGrass: 0.3,
};

type BuildingSettings = Pick<TownParams, "center" | "mart" | "gym" | "landmark" | "houses" | "largeHouses">;

/**
 * The buildings each settlement size starts with (each can then be changed in the
 * Generate tab). A hamlet is a few houses; a village adds a Pokémon Center; a town
 * has a Mart too.
 */
export const SETTLEMENT_BUILDINGS: Record<Settlement, BuildingSettings> = {
  none: { center: false, mart: false, gym: false, landmark: false, houses: 0, largeHouses: 0 },
  hamlet: { center: false, mart: false, gym: false, landmark: false, houses: 2, largeHouses: 0 },
  village: { center: true, mart: false, gym: false, landmark: false, houses: 3, largeHouses: 1 },
  town: { center: true, mart: true, gym: false, landmark: false, houses: 3, largeHouses: 1 },
};

export const SETTLEMENT_LABELS: Record<Settlement, string> = {
  none: "None",
  hamlet: "Hamlet: houses",
  village: "Village: + Pokémon Center",
  town: "Town: + Center and Mart",
};

export const TOWN_RANGES: Record<"houses" | "largeHouses" | "people" | "edgeGrass" | "outskirts", [number, number, boolean]> = {
  houses: [0, 12, true],
  largeHouses: [0, 6, true],
  people: [0, 10, true],
  edgeGrass: [0, 1, false],
  outskirts: [0, 1, false],
};

export function readTownParams(params: Record<string, string | number | boolean>, settlement: Settlement = "town"): TownParams {
  // With no settlement there are no buildings, whatever the saved building settings say.
  if (settlement === "none") return { ...readTownParams(params, "town"), ...SETTLEMENT_BUILDINGS.none };
  const d = { ...DEFAULT_TOWN_PARAMS, ...SETTLEMENT_BUILDINGS[settlement] };
  const n = (key: keyof typeof TOWN_RANGES) => {
    const [min, max, whole] = TOWN_RANGES[key];
    const v = params[key];
    if (typeof v !== "number" || !Number.isFinite(v)) return d[key];
    const c = Math.min(max, Math.max(min, v));
    return whole ? Math.round(c) : c;
  };
  const b = (key: "center" | "mart" | "gym" | "landmark") => (typeof params[key] === "boolean" ? (params[key] as boolean) : d[key]);
  return {
    townLayout: (TOWN_LAYOUTS as readonly unknown[]).includes(params.townLayout) ? (params.townLayout as TownLayout) : d.townLayout,
    center: b("center"),
    mart: b("mart"),
    gym: b("gym"),
    landmark: b("landmark"),
    houses: n("houses"),
    largeHouses: n("largeHouses"),
    wall: params.wall === true,
    outskirts: n("outskirts"),
    people: n("people"),
    edgeGrass: n("edgeGrass"),
  };
}

/** The buildings to place, biggest and most important first. */
export function buildingList(p: TownParams): BuildingKind[] {
  const out: BuildingKind[] = [];
  if (p.gym) out.push("gym");
  if (p.landmark) out.push("landmark");
  if (p.center) out.push("center");
  if (p.mart) out.push("mart");
  for (let k = 0; k < p.houses; k++) out.push("house");
  return out;
}
