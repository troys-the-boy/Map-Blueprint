// The data model: what a project, region and map blueprint contain.
//
// These are the "in memory" shapes the app works with. Grid layers are stored
// as compact typed arrays here; project.ts converts them to and from the saved
// file format (a per-layer legend + numbers, see docs/formats.md).

import type { Hm } from "./constants";
import { MAP_OFFSET_H, MAP_OFFSET_W, MAX_MAP_DATA_SIZE, OBJECT_EVENT_TEMPLATES_COUNT } from "./constants";
import type { ElevationLevel } from "./terrain";
import { DEFAULT_FILL_TERRAIN, ELEVATION_LEVELS, requireTerrain } from "./terrain";
import type { Seed } from "./rng";

export const MAP_TYPES = ["route", "town", "forest", "cave", "interior_stub"] as const;
export type MapType = (typeof MAP_TYPES)[number];

export const BIOMES = ["temperate_rainforest", "coastal", "wetland", "alpine", "meadow", "urban_edge"] as const;
export type Biome = (typeof BIOMES)[number];

/** A width × height grid of small numbers, stored row by row (index = y * width + x). */
export interface Grid {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface MapLayers {
  /** Terrain per cell: an index into TERRAIN_TYPES. */
  terrain: Grid;
  /** Elevation per cell: an index into ELEVATION_LEVELS. */
  elevation: Grid;
  /** 1 = the user painted or pinned this cell; generators must not change it. */
  locks: Grid;
  /** Optional named areas (biome areas, water intent, keep-clear areas…). */
  zones: Zone[];
}

/** A named area of intent. Filled in by the zone tools in a later milestone. */
export interface Zone {
  id: string;
  name: string;
  /** e.g. "biome", "water", "edge", "keep_clear", "hm_gate", "lot". */
  kind: string;
  /** Hard = follow exactly; soft = follow the general shape. */
  hard: boolean;
  /** 0 = exact, 1 = loose. Only used when hard is false. */
  fuzziness: number;
  /** 1 for cells inside the zone. */
  mask: Grid;
  /** Kind-specific settings, e.g. { biome: "wetland" } or { depth: "deep" }. */
  data: Record<string, string | number | boolean>;
}

/** Porymap object/BG/coord event kinds (warps are kept separately in `warps`). */
export const ENTITY_KINDS = [
  "trainer",
  "npc",
  "item_ball",
  "cut_tree",
  "smash_rock",
  "strength_boulder",
  "berry_tree",
  "trigger",
  "sign",
  "hidden_item",
  "secret_base",
  "heal_location",
] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

export interface Entity {
  id: string;
  kind: EntityKind;
  x: number;
  y: number;
  elevation: ElevationLevel;
  /** Suggested Porymap field values (graphics_id, script, flag…), all editable. */
  fields: Record<string, string | number | boolean>;
}

export const WARP_KINDS = ["door", "cave_mouth", "ladder", "stairs", "other"] as const;
export type WarpKind = (typeof WARP_KINDS)[number];

export interface Warp {
  id: string;
  kind: WarpKind;
  x: number;
  y: number;
  elevation: ElevationLevel;
  /** Internal id of the destination map in this project, or a MAP_* constant. */
  destMap: string;
  /** Index of the destination warp on that map (Porymap "dest_warp_id"). */
  destWarpId: number | null;
}

/** Connection directions, named as in pokeemerald map.json ("up", "down", …). */
export const CONNECTION_DIRECTIONS = ["up", "down", "left", "right", "dive", "emerge"] as const;
export type ConnectionDirection = (typeof CONNECTION_DIRECTIONS)[number];

export interface Connection {
  direction: ConnectionDirection;
  /** Internal id of the neighbouring map in this project. */
  map: string;
  /** Porymap "offset", in metatiles. */
  offset: number;
}

/**
 * Suggested map.json header values. Field names match pokeemerald's map.json
 * exactly (checked against data/maps/Route101/map.json). floor_number is not in
 * vanilla Emerald's map.json (it comes from pokefirered / Porymap), so it is
 * optional here.
 */
export interface MapHeader {
  id: string;
  name: string;
  music: string;
  region_map_section: string;
  weather: string;
  map_type: string;
  requires_flash: boolean;
  allow_cycling: boolean;
  allow_escaping: boolean;
  allow_running: boolean;
  show_map_name: boolean;
  battle_scene: string;
  floor_number: number | null;
}

export interface MapLayout {
  /** The 2×2 border block, as terrain ids: top-left, top-right, bottom-left, bottom-right. */
  borderBlock: [string, string, string, string];
  /** Left blank until a tileset profile exists. */
  primaryTileset: string;
  secondaryTileset: string;
}

/**
 * A recorded user action, replayed on regenerate (from Milestone 3).
 * Milestone 1 records pencil and eraser strokes.
 */
export interface StrokeEdit {
  type: "stroke";
  tool: "pencil" | "erase";
  /** Terrain id painted (for erase: the fill terrain restored). */
  terrain: string;
  brush: number;
  /** Whether the stroke locked the cells it painted. */
  locked: boolean;
  /** Flat list of cell coordinates: [x0, y0, x1, y1, …]. */
  cells: number[];
}
export type Edit = StrokeEdit;

export interface MapBlueprint {
  /** Internal id, unique in the project (e.g. "map_3"). Not the MAP_* constant. */
  id: string;
  name: string;
  mapType: MapType;
  width: number;
  height: number;
  seed: Seed;
  biome: Biome;
  /** Generator settings (filled in by the generators in later milestones). */
  params: Record<string, string | number | boolean>;
  layers: MapLayers;
  entities: Entity[];
  warps: Warp[];
  connections: Connection[];
  header: MapHeader;
  layout: MapLayout;
  /** Draft wild encounter plan (Milestone 4). Always null in this version. */
  encounterPlan: null;
  edits: Edit[];
  /** The route this map is a segment of, if any. */
  routeId: string | null;
  /** The progression step this map belongs to, if any. */
  progressionStep: string | null;
}

/** One logical route made of several connected map segments. */
export interface Route {
  id: string;
  name: string;
  segmentMapIds: string[];
  primaryTileset: string;
  secondaryTileset: string;
  regionMapSection: string;
  progressionStep: string | null;
  biome: Biome;
}

export interface ProgressionStep {
  id: string;
  name: string;
  badges: number;
  hms: Hm[];
}

/** Engine limits. Defaults are vanilla Emerald; a hack that raises a limit can change them. */
export interface EngineLimits {
  maxMapDataSize: number;
  mapOffsetW: number;
  mapOffsetH: number;
  objectEventTemplates: number;
}

export const DEFAULT_ENGINE_LIMITS: EngineLimits = {
  maxMapDataSize: MAX_MAP_DATA_SIZE,
  mapOffsetW: MAP_OFFSET_W,
  mapOffsetH: MAP_OFFSET_H,
  objectEventTemplates: OBJECT_EVENT_TEMPLATES_COUNT,
};

export interface RegionSettings {
  defaultBiome: Biome;
  levelCurve: { start: number; end: number };
  /** Routes longer than this (metatiles) are split into segments. */
  targetSegmentLength: number;
  engineLimits: EngineLimits;
}

export interface Region {
  name: string;
  seed: Seed;
  /** The coarse region sketch (Milestone 6). Always null in this version. */
  sketch: null;
  maps: MapBlueprint[];
  routes: Route[];
  progression: ProgressionStep[];
  settings: RegionSettings;
  /** Counter for making new internal ids ("map_1", "map_2"…), so ids are deterministic. */
  nextId: number;
}

// ---------------------------------------------------------------------------
// Constructors
// ---------------------------------------------------------------------------

export function makeGrid(width: number, height: number, fill = 0): Grid {
  const data = new Uint8Array(width * height);
  if (fill !== 0) data.fill(fill);
  return { width, height, data };
}

export function newRegion(name: string, seed: Seed): Region {
  return {
    name,
    seed,
    sketch: null,
    maps: [],
    routes: [],
    progression: [],
    settings: {
      defaultBiome: "temperate_rainforest",
      levelCurve: { start: 3, end: 60 },
      targetSegmentLength: 80,
      engineLimits: { ...DEFAULT_ENGINE_LIMITS },
    },
    nextId: 1,
  };
}

/** Turn a display name into a pokeemerald-style constant, e.g. "Route 3 North" → "MAP_ROUTE3_NORTH". */
export function mapConstantFromName(name: string): string {
  const core = name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/ROUTE_(\d)/g, "ROUTE$1");
  return "MAP_" + (core || "UNNAMED");
}

/** pokeemerald header defaults per map type (see data/maps/*\/map.json). */
function defaultHeader(name: string, mapType: MapType): MapHeader {
  const constant = mapConstantFromName(name);
  const pascal = name.replace(/[^A-Za-z0-9]+/g, "");
  const typeMap: Record<MapType, string> = {
    route: "MAP_TYPE_ROUTE",
    town: "MAP_TYPE_TOWN",
    forest: "MAP_TYPE_ROUTE",
    cave: "MAP_TYPE_UNDERGROUND",
    interior_stub: "MAP_TYPE_INDOOR",
  };
  const outdoors = mapType !== "cave" && mapType !== "interior_stub";
  return {
    id: constant,
    name: pascal || "Unnamed",
    music: "MUS_DUMMY",
    region_map_section: "MAPSEC_NONE",
    weather: outdoors ? "WEATHER_SUNNY" : "WEATHER_NONE",
    map_type: typeMap[mapType],
    requires_flash: false,
    allow_cycling: mapType !== "interior_stub",
    allow_escaping: mapType === "cave",
    allow_running: true,
    show_map_name: mapType !== "interior_stub",
    battle_scene: "MAP_BATTLE_SCENE_NORMAL",
    floor_number: null,
  };
}

export interface NewMapOptions {
  name: string;
  mapType: MapType;
  width: number;
  height: number;
  seed: Seed;
  biome?: Biome;
}

/** Make a blank map filled with the default terrain, and add it to the region. */
export function addNewMap(region: Region, opts: NewMapOptions): MapBlueprint {
  const id = `map_${region.nextId++}`;
  const fill = requireTerrain(DEFAULT_FILL_TERRAIN);
  const ground = ELEVATION_LEVELS.indexOf("ground");
  const map: MapBlueprint = {
    id,
    name: opts.name,
    mapType: opts.mapType,
    width: opts.width,
    height: opts.height,
    seed: opts.seed,
    biome: opts.biome ?? region.settings.defaultBiome,
    params: {},
    layers: {
      terrain: makeGrid(opts.width, opts.height, fill),
      elevation: makeGrid(opts.width, opts.height, ground),
      locks: makeGrid(opts.width, opts.height, 0),
      zones: [],
    },
    entities: [],
    warps: [],
    connections: [],
    header: defaultHeader(opts.name, opts.mapType),
    layout: {
      borderBlock: opts.mapType === "cave" ? ["rock_wall", "rock_wall", "rock_wall", "rock_wall"] : ["tree", "tree", "tree", "tree"],
      primaryTileset: "",
      secondaryTileset: "",
    },
    encounterPlan: null,
    edits: [],
    routeId: null,
    progressionStep: null,
  };
  region.maps.push(map);
  return map;
}
