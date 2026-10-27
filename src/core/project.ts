// Saving and opening project files.
//
// A project is one .json file holding the region, all its maps and their edits.
// Grid layers are saved as a per-layer "legend" (the names used) plus rows of
// numbers pointing into that legend, e.g.
//     "terrain": { "legend": ["ground", "tree"], "rows": [[1, 1, 0], [1, 0, 0]] }
// so files stay small and adding new terrain types never breaks old files.
// The full format is documented in docs/formats.md.
//
// Every file has a schemaVersion. When the format changes, bump
// CURRENT_SCHEMA_VERSION and add a migration that upgrades the previous version.

import { HMS } from "./constants";
import type {
  Biome,
  Connection,
  Edit,
  Entity,
  Grid,
  MapBlueprint,
  Opening,
  ProgressionStep,
  Region,
  Route,
  Warp,
  Zone,
} from "./model";
import {
  BIOMES,
  CONNECTION_DIRECTIONS,
  EDGES,
  ENTITY_KINDS,
  OPENING_KINDS,
  MAP_TYPES,
  WARP_KINDS,
  makeGrid,
} from "./model";
import { MAX_SEED } from "./rng";
import type { Check } from "./schema";
import {
  FileFormatError,
  arrayOf,
  bool,
  intArray,
  literal,
  nullValue,
  nullable,
  num,
  object,
  oneOf,
  simpleRecord,
  str,
} from "./schema";
import { ELEVATION_LEVELS, TERRAIN_TYPES, terrainIndex } from "./terrain";

export const FILE_FORMAT_ID = "gen3-map-blueprint-project";
export const CURRENT_SCHEMA_VERSION = 5;

/** Safety limits for opened files. Anything bigger is rejected. */
export const FILE_LIMITS = {
  maxFileBytes: 30 * 1024 * 1024,
  maxMaps: 500,
  maxMapSide: 512,
  maxEntitiesPerMap: 1000,
  maxEditsPerMap: 20000,
  maxCellsPerEdit: 2 * 512 * 512,
  maxZonesPerMap: 200,
  maxText: 500,
} as const;

const LOCK_LEGEND = ["free", "locked"] as const;
const MASK_LEGEND = ["out", "in"] as const;

// ---------------------------------------------------------------------------
// Saved shapes
// ---------------------------------------------------------------------------

export interface SavedGrid {
  legend: string[];
  rows: number[][];
}

export interface ProjectFile {
  format: typeof FILE_FORMAT_ID;
  schemaVersion: number;
  appVersion: string;
  savedAt: string;
  region: unknown;
}

// ---------------------------------------------------------------------------
// Grid encoding
// ---------------------------------------------------------------------------

/** Encode a grid using `names[value]` as the name of each value. Legend order = first appearance. */
export function encodeGrid(grid: Grid, names: readonly string[]): SavedGrid {
  const legendIndex = new Map<number, number>();
  const legend: string[] = [];
  const rows: number[][] = [];
  for (let y = 0; y < grid.height; y++) {
    const row: number[] = new Array(grid.width);
    for (let x = 0; x < grid.width; x++) {
      const v = grid.data[y * grid.width + x];
      let li = legendIndex.get(v);
      if (li === undefined) {
        li = legend.length;
        legendIndex.set(v, li);
        legend.push(names[v]);
      }
      row[x] = li;
    }
    rows.push(row);
  }
  return { legend, rows };
}

/** Decode a saved grid. `resolve` turns a legend name into the in-memory value (or -1 if unknown). */
export function decodeGrid(
  saved: SavedGrid,
  width: number,
  height: number,
  resolve: (name: string) => number,
  path: string,
  what: string,
): Grid {
  const values = saved.legend.map((name, i) => {
    const v = resolve(name);
    if (v < 0) throw new FileFormatError(`${path}.legend[${i}]`, `unknown ${what} "${name}"`);
    return v;
  });
  if (saved.rows.length !== height)
    throw new FileFormatError(`${path}.rows`, `expected ${height} rows (the map height), found ${saved.rows.length}`);
  const grid = makeGrid(width, height);
  for (let y = 0; y < height; y++) {
    const row = saved.rows[y];
    if (row.length !== width)
      throw new FileFormatError(`${path}.rows[${y}]`, `expected ${width} cells (the map width), found ${row.length}`);
    for (let x = 0; x < width; x++) {
      const li = row[x];
      if (li >= values.length)
        throw new FileFormatError(`${path}.rows[${y}][${x}]`, `${li} is not in the legend (it has ${values.length} entries)`);
      grid.data[y * width + x] = values[li];
    }
  }
  return grid;
}

const terrainNames = TERRAIN_TYPES.map((t) => t.id);

// ---------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------

function saveMap(m: MapBlueprint) {
  return {
    id: m.id,
    name: m.name,
    mapType: m.mapType,
    width: m.width,
    height: m.height,
    seed: m.seed,
    biome: m.biome,
    params: m.params,
    layers: {
      terrain: encodeGrid(m.layers.terrain, terrainNames),
      elevation: encodeGrid(m.layers.elevation, ELEVATION_LEVELS),
      locks: encodeGrid(m.layers.locks, LOCK_LEGEND),
      zones: m.layers.zones.map((z) => ({ ...z, mask: encodeGrid(z.mask, MASK_LEGEND) })),
    },
    entities: m.entities,
    warps: m.warps,
    openings: m.openings,
    connections: m.connections,
    header: m.header,
    layout: m.layout,
    encounterPlan: m.encounterPlan,
    edits: m.edits,
    routeId: m.routeId,
    progressionStep: m.progressionStep,
  };
}

/** Build the saved-file object for a region. */
export function toProjectFile(region: Region, appVersion: string, savedAt: Date = new Date()): ProjectFile {
  return {
    format: FILE_FORMAT_ID,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    appVersion,
    savedAt: savedAt.toISOString(),
    region: {
      name: region.name,
      seed: region.seed,
      sketch: region.sketch,
      settings: region.settings,
      progression: region.progression,
      routes: region.routes,
      nextId: region.nextId,
      maps: region.maps.map(saveMap),
    },
  };
}

/**
 * Turn a project into JSON text. Indented for readability, but each grid row
 * and each list of numbers stays on one line so the file is easy to scroll.
 */
export function serializeProject(region: Region, appVersion: string, savedAt?: Date): string {
  const text = JSON.stringify(toProjectFile(region, appVersion, savedAt), null, 2);
  return text.replace(/\[\s*(-?\d+(?:,\s*-?\d+)*)\s*\]/g, (_m, inner: string) => `[${inner.replace(/\s+/g, "")}]`) + "\n";
}

// ---------------------------------------------------------------------------
// Opening
// ---------------------------------------------------------------------------

const ID = /^[A-Za-z0-9_\-]{1,64}$/;
const text = () => str(FILE_LIMITS.maxText);
const coord = num(0, FILE_LIMITS.maxMapSide - 1);
const elevation = oneOf(ELEVATION_LEVELS);
const fields = simpleRecord(64, FILE_LIMITS.maxText);

const savedGridCheck: Check<SavedGrid> = object({
  legend: arrayOf(str(64), 256),
  rows: arrayOf(intArray(0, 255, FILE_LIMITS.maxMapSide), FILE_LIMITS.maxMapSide),
});

const entityCheck: Check<Entity> = object({
  id: str(64, ID),
  kind: oneOf(ENTITY_KINDS),
  x: coord,
  y: coord,
  elevation,
  fields,
  locked: bool,
}, ["locked"]);

const warpCheck: Check<Warp> = object({
  id: str(64, ID),
  kind: oneOf(WARP_KINDS),
  x: coord,
  y: coord,
  elevation,
  destMap: str(100),
  destWarpId: nullable(num(0, 255)),
});

const openingCheck: Check<Opening> = object({
  id: str(64, ID),
  edge: oneOf(EDGES),
  start: num(0, FILE_LIMITS.maxMapSide - 1),
  width: num(1, FILE_LIMITS.maxMapSide),
  kind: oneOf(OPENING_KINDS),
});

const connectionCheck: Check<Connection> = object({
  direction: oneOf(CONNECTION_DIRECTIONS),
  map: str(64, ID),
  offset: num(-FILE_LIMITS.maxMapSide * 4, FILE_LIMITS.maxMapSide * 4),
});

const strokeEditCheck = object({
  type: literal("stroke"),
  tool: oneOf(["pencil", "erase"] as const),
  terrain: str(64),
  brush: num(1, 16),
  locked: bool,
  cells: intArray(0, FILE_LIMITS.maxMapSide - 1, FILE_LIMITS.maxCellsPerEdit),
});

const elevationEditCheck = object({
  type: literal("elevation"),
  level: elevation,
  brush: num(1, 16),
  locked: bool,
  cells: intArray(0, FILE_LIMITS.maxMapSide - 1, FILE_LIMITS.maxCellsPerEdit),
});

const lockEditCheck = object({
  type: literal("lock"),
  locked: bool,
  brush: num(1, 16),
  cells: intArray(0, FILE_LIMITS.maxMapSide - 1, FILE_LIMITS.maxCellsPerEdit),
});

const areaEditCheck = object({
  type: literal("area"),
  action: oneOf(["move", "paste", "delete", "regenerate"] as const),
  area: object({ x: coord, y: coord, w: num(1, FILE_LIMITS.maxMapSide), h: num(1, FILE_LIMITS.maxMapSide) }),
  toX: nullable(coord),
  toY: nullable(coord),
});

const entityEditCheck = object({
  type: literal("entity"),
  action: oneOf(["place", "move", "turn", "sight", "delete"] as const),
  id: str(64, ID),
  kind: oneOf(ENTITY_KINDS),
  x: coord,
  y: coord,
});

const EDIT_CHECKS: Record<string, Check<Edit>> = {
  stroke: strokeEditCheck,
  elevation: elevationEditCheck,
  lock: lockEditCheck,
  area: areaEditCheck,
  entity: entityEditCheck,
};

/** An edit is one of several kinds, told apart by its "type". */
const editCheck: Check<Edit> = (v, path) => {
  const type = v !== null && typeof v === "object" ? (v as { type?: unknown }).type : undefined;
  const check = typeof type === "string" && Object.prototype.hasOwnProperty.call(EDIT_CHECKS, type) ? EDIT_CHECKS[type] : strokeEditCheck;
  return check(v, path);
};

const savedZoneCheck = object({
  id: str(64, ID),
  name: text(),
  kind: str(64, /^[a-z][a-z0-9_]*$/),
  hard: bool,
  fuzziness: num(0, 1, false),
  mask: savedGridCheck,
  data: fields,
});

const headerCheck = object({
  id: str(100),
  name: str(100),
  music: str(100),
  region_map_section: str(100),
  weather: str(100),
  map_type: str(100),
  requires_flash: bool,
  allow_cycling: bool,
  allow_escaping: bool,
  allow_running: bool,
  show_map_name: bool,
  battle_scene: str(100),
  floor_number: nullable(num(-128, 127)),
});

const terrainId: Check<string> = (v, path) => {
  const s = str(64)(v, path);
  if (terrainIndex(s) < 0) throw new FileFormatError(path, `unknown terrain type "${s}"`);
  return s;
};

const savedMapCheck = object({
  id: str(64, ID),
  name: text(),
  mapType: oneOf(MAP_TYPES),
  width: num(1, FILE_LIMITS.maxMapSide),
  height: num(1, FILE_LIMITS.maxMapSide),
  seed: num(0, MAX_SEED),
  biome: oneOf(BIOMES),
  params: fields,
  layers: object({
    terrain: savedGridCheck,
    elevation: savedGridCheck,
    locks: savedGridCheck,
    zones: arrayOf(savedZoneCheck, FILE_LIMITS.maxZonesPerMap),
  }),
  entities: arrayOf(entityCheck, FILE_LIMITS.maxEntitiesPerMap),
  warps: arrayOf(warpCheck, 256),
  openings: arrayOf(openingCheck, 32),
  connections: arrayOf(connectionCheck, 16),
  header: headerCheck,
  layout: object({
    borderBlock: (v: unknown, path: string) => {
      const list = arrayOf(terrainId, 4)(v, path);
      if (list.length !== 4) throw new FileFormatError(path, "the border block needs exactly 4 terrain types (2×2)");
      return list as [string, string, string, string];
    },
    primaryTileset: str(100),
    secondaryTileset: str(100),
  }),
  encounterPlan: nullValue,
  edits: arrayOf(editCheck, FILE_LIMITS.maxEditsPerMap),
  routeId: nullable(str(64, ID)),
  progressionStep: nullable(str(64, ID)),
});

const routeCheck: Check<Route> = object({
  id: str(64, ID),
  name: text(),
  segmentMapIds: arrayOf(str(64, ID), 64),
  primaryTileset: str(100),
  secondaryTileset: str(100),
  regionMapSection: str(100),
  progressionStep: nullable(str(64, ID)),
  biome: oneOf(BIOMES),
});

const progressionCheck: Check<ProgressionStep> = object({
  id: str(64, ID),
  name: text(),
  badges: num(0, 8),
  hms: arrayOf(oneOf(HMS), HMS.length),
});

const regionCheck = object({
  name: text(),
  seed: num(0, MAX_SEED),
  sketch: nullValue,
  settings: object({
    defaultBiome: oneOf(BIOMES) as Check<Biome>,
    levelCurve: object({ start: num(1, 100), end: num(1, 100) }),
    targetSegmentLength: num(10, FILE_LIMITS.maxMapSide),
    engineLimits: object({
      maxMapDataSize: num(1, 1_000_000),
      mapOffsetW: num(0, 100),
      mapOffsetH: num(0, 100),
      objectEventTemplates: num(1, 1000),
    }),
  }),
  progression: arrayOf(progressionCheck, 64),
  routes: arrayOf(routeCheck, FILE_LIMITS.maxMaps),
  nextId: num(1, 1e9),
  maps: arrayOf(savedMapCheck, FILE_LIMITS.maxMaps),
});

const envelopeCheck = object({
  format: literal(FILE_FORMAT_ID),
  schemaVersion: num(1, 1000),
  appVersion: str(40),
  savedAt: str(40),
  region: (v: unknown) => v,
});

/** A migration upgrades a parsed file from version N to N + 1. */
export type Migration = (file: Record<string, unknown>) => Record<string, unknown>;

/** Migrations, keyed by the version they upgrade FROM. Each returns a new object. */
export const MIGRATIONS: Record<number, Migration> = {
  // v1 → v2 (Milestone 2): every map gains an "openings" list (edge entrances).
  1: (file) => {
    const region = file.region as Record<string, unknown> | null;
    const maps = Array.isArray(region?.maps) ? (region!.maps as unknown[]) : null;
    return {
      ...file,
      schemaVersion: 2,
      region:
        region && maps
          ? {
              ...region,
              maps: maps.map((m) => (m && typeof m === "object" && !Array.isArray(m) ? { ...(m as object), openings: [] } : m)),
            }
          : region,
    };
  },
  // v2 → v3 (Milestone 2 revision): entrances are "walk" or "surf"; existing ones are walk.
  2: (file) => {
    const region = file.region as Record<string, unknown> | null;
    const maps = Array.isArray(region?.maps) ? (region!.maps as unknown[]) : null;
    const upgradeMap = (m: unknown) => {
      if (!m || typeof m !== "object" || Array.isArray(m)) return m;
      const openings = (m as { openings?: unknown }).openings;
      return {
        ...(m as object),
        openings: Array.isArray(openings) ? openings.map((o) => (o && typeof o === "object" ? { ...(o as object), kind: "walk" } : o)) : openings,
      };
    };
    return { ...file, schemaVersion: 3, region: region && maps ? { ...region, maps: maps.map(upgradeMap) } : region };
  },
  // v3 → v4 (second revision): new terrain types (snow, snowy grass, ice, snowdrift),
  // elevation levels raised3 and raised4, and elevation-brush edits. Nothing in a
  // version-3 file needs changing; only the version number moves on.
  3: (file) => ({ ...file, schemaVersion: 4 }),
  // v4 → v5 (Milestone 3, part A): things on the map can be "locked" (placed by hand),
  // and new edit records for the lock brush, selections and the Things tool. Nothing
  // in a version-4 file needs changing.
  4: (file) => ({ ...file, schemaVersion: 5 }),
};

/** Upgrade an old file step by step to the target version. */
export function migrate(
  file: Record<string, unknown>,
  migrations: Record<number, Migration> = MIGRATIONS,
  target: number = CURRENT_SCHEMA_VERSION,
): Record<string, unknown> {
  let current = file;
  let version = current.schemaVersion as number;
  if (version > target)
    throw new FileFormatError(
      "schemaVersion",
      `this file was saved by a newer version of the tool (file format ${version}; this tool reads up to ${target}). Please update the tool.`,
    );
  while (version < target) {
    const step = migrations[version];
    if (!step) throw new FileFormatError("schemaVersion", `cannot upgrade files of format version ${version}`);
    current = step(current);
    if (current.schemaVersion !== version + 1)
      throw new Error(`Migration from version ${version} did not produce version ${version + 1}`);
    version++;
  }
  return current;
}

function loadMap(saved: ReturnType<typeof savedMapCheck>, path: string): MapBlueprint {
  const { width, height } = saved;
  const L = saved.layers;
  const elevIndex = (n: string) => ELEVATION_LEVELS.indexOf(n as (typeof ELEVATION_LEVELS)[number]);
  const listIndex = (list: readonly string[]) => (n: string) => list.indexOf(n);

  const zones: Zone[] = L.zones.map((z, i) => ({
    ...z,
    mask: decodeGrid(z.mask, width, height, listIndex(MASK_LEGEND), `${path}.layers.zones[${i}].mask`, "zone mask value"),
  }));

  // Positions must be inside the map.
  const inside = (x: number, y: number, where: string) => {
    if (x >= width || y >= height)
      throw new FileFormatError(where, `position (${x}, ${y}) is outside the ${width}×${height} map`);
  };
  saved.entities.forEach((e, i) => inside(e.x, e.y, `${path}.entities[${i}]`));
  saved.warps.forEach((w, i) => inside(w.x, w.y, `${path}.warps[${i}]`));
  saved.openings.forEach((o, i) => {
    const edgeLength = o.edge === "north" || o.edge === "south" ? width : height;
    if (o.start + o.width > edgeLength)
      throw new FileFormatError(`${path}.openings[${i}]`, `the opening runs past the end of the ${o.edge} edge (${edgeLength} cells long)`);
  });
  saved.edits.forEach((e, i) => {
    if (e.type === "area") {
      if (e.area.x + e.area.w > width || e.area.y + e.area.h > height) throw new FileFormatError(`${path}.edits[${i}].area`, "the area runs past the edge of the map");
      if (e.toX !== null) inside(e.toX, e.toY ?? 0, `${path}.edits[${i}]`);
      return;
    }
    if (e.type === "entity") return inside(e.x, e.y, `${path}.edits[${i}]`);
    if (e.cells.length % 2 !== 0) throw new FileFormatError(`${path}.edits[${i}].cells`, "expected pairs of x, y numbers");
    if (e.type === "stroke" && terrainIndex(e.terrain) < 0) throw new FileFormatError(`${path}.edits[${i}].terrain`, `unknown terrain type "${e.terrain}"`);
    for (let k = 0; k < e.cells.length; k += 2) inside(e.cells[k], e.cells[k + 1], `${path}.edits[${i}].cells`);
  });

  return {
    ...saved,
    layers: {
      terrain: decodeGrid(L.terrain, width, height, terrainIndex, `${path}.layers.terrain`, "terrain type"),
      elevation: decodeGrid(L.elevation, width, height, elevIndex, `${path}.layers.elevation`, "elevation level"),
      locks: decodeGrid(L.locks, width, height, listIndex(LOCK_LEGEND), `${path}.layers.locks`, "lock value"),
      zones,
    },
  };
}

/**
 * Parse project file text into a Region. Throws FileFormatError with a
 * plain-language message if anything is wrong; never partially loads.
 */
export function parseProject(textContent: string): Region {
  if (textContent.length > FILE_LIMITS.maxFileBytes)
    throw new FileFormatError("", `the file is too large (limit ${FILE_LIMITS.maxFileBytes / 1024 / 1024} MB)`);
  let raw: unknown;
  try {
    raw = JSON.parse(textContent);
  } catch {
    throw new FileFormatError("", "this is not a valid project file (it is not readable JSON)");
  }
  if (typeof raw !== "object" || raw === null || (raw as Record<string, unknown>).format !== FILE_FORMAT_ID)
    throw new FileFormatError("", "this is not a Gen 3 Map Blueprint project file");

  const envelope = envelopeCheck(raw, "");
  const upgraded = migrate(envelope as unknown as Record<string, unknown>);
  const r = regionCheck(upgraded.region, "region");

  const maps = r.maps.map((m, i) => loadMap(m, `region.maps[${i}]`));

  // Cross-references must point at things that exist.
  const ids = new Set<string>();
  maps.forEach((m, i) => {
    if (ids.has(m.id)) throw new FileFormatError(`region.maps[${i}].id`, `the map id "${m.id}" is used twice`);
    ids.add(m.id);
  });
  maps.forEach((m, i) =>
    m.connections.forEach((c, j) => {
      if (!ids.has(c.map))
        throw new FileFormatError(`region.maps[${i}].connections[${j}].map`, `no map with id "${c.map}" in this project`);
    }),
  );
  r.routes.forEach((route, i) =>
    route.segmentMapIds.forEach((id, j) => {
      if (!ids.has(id)) throw new FileFormatError(`region.routes[${i}].segmentMapIds[${j}]`, `no map with id "${id}" in this project`);
    }),
  );

  return { ...r, maps };
}

/** Turn any error from parseProject into one readable sentence for the user. */
export function explainOpenError(err: unknown): string {
  if (err instanceof FileFormatError) {
    return err.path
      ? `This project file can't be opened. Problem at ${err.path}: ${err.problem}.`
      : `This file can't be opened: ${err.problem}.`;
  }
  return `This file can't be opened because of an unexpected error: ${err instanceof Error ? err.message : String(err)}`;
}
