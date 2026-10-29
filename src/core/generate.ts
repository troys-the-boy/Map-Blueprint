// Generation entry point: runs the stages in order, validates the result, and
// retries with a related seed if anything is wrong.
//
//   same map + same settings + same seed  →  exactly the same result.
//
// Locked cells are never changed. If they make a valid map impossible (for
// example a painted wall across the only way through), the best attempt is
// returned along with the validation errors that explain why.

import type { Entity, MapBlueprint, Opening, Warp, Zone } from "./model";
import type { Area } from "./selection";
import { inArea } from "./selection";
import { cloneThing } from "./things";
import { Rng, deriveSeed } from "./rng";
import { IS_WATER, T } from "./grid";
import type { Issue, ValidateOptions } from "./validate";
import { validateMap } from "./validate";
import { GenContext, LEVEL } from "./generators/context";
import type { GenInput } from "./generators/context";
import { hmsFor, readRouteParams, resolveBorder, resolveLayout } from "./generators/params";
import { buildRouteSkeleton } from "./generators/routeSkeleton";
import { applyLayout, computeGeometry, layoutOpenings } from "./generators/layout";
import type { Geometry } from "./generators/layout";
import { addPlateaus, connectStairs } from "./generators/plateaus";
import { addGrassShortcut, addPathGrass } from "./generators/shortcut";
import { fillTerrain } from "./generators/terrainFill";
import { addHmPockets, addLedgePockets, addLedgeRows } from "./generators/features";
import { cleanup, closeLedgeTraps, removeWaterLedges } from "./generators/cleanup";
import { placeEntities } from "./generators/placement";
import { addSnow } from "./generators/snow";
import { applyMarsh, applyZones, prepareZones, shiftOpeningsOutOfZones } from "./generators/zones";
import { ELEVATION_LEVELS } from "./terrain";
import { buildTown } from "./generators/town";
import { buildingList, readTownParams } from "./generators/townParams";
import { addForestLedges, addGuaranteedHidden, buildForest } from "./generators/forest";
import { readForestParams } from "./generators/forestParams";
import { buildCave } from "./generators/cave";
import { readCaveParams } from "./generators/caveParams";
import { markTravel } from "./generators/travel";

/** Version of the generators. Bumped when the same seed starts giving different maps. */
export const GENERATOR_VERSION = 6;

export interface GenerateResult {
  ok: boolean;
  terrain: Uint8Array;
  elevation: Uint8Array;
  entities: Entity[];
  /** Warps placed by hand, and the ones the generator made (town doors). */
  warps: Warp[];
  openings: Opening[];
  zones: Zone[];
  issues: Issue[];
  /** How many tries it took (1 = first try). */
  attempts: number;
  /** Plain-language notes for the user, e.g. buildings that didn't fit. */
  notes?: string[];
}

/** Map types that have a generator so far. */
export function canGenerate(map: MapBlueprint): boolean {
  return map.mapType === "route" || map.mapType === "town" || map.mapType === "forest" || map.mapType === "cave";
}

/** Final elevation: plateau levels as built, water on the low level marked "water", bridges "bridge". */
function finishElevation(ctx: GenContext): Uint8Array {
  const out = ctx.elevation.slice();
  for (let i = 0; i < ctx.n; i++) {
    if (ctx.locks[i]) continue;
    const low = out[i] === LEVEL.ground || out[i] === LEVEL.water;
    if (ctx.terrain[i] === T.bridge) out[i] = LEVEL.bridge;
    else if (low && IS_WATER[ctx.terrain[i]]) out[i] = LEVEL.water;
    else if (out[i] === LEVEL.water) out[i] = LEVEL.ground;
  }
  return out;
}

/** The text used to suggest script labels and flags, e.g. "Route1". */
function labelBase(map: MapBlueprint): string {
  return map.header.name.replace(/[^A-Za-z0-9]/g, "") || map.name.replace(/[^A-Za-z0-9]/g, "") || "Map";
}

/** Give a generated thing a fresh ID if a thing placed by hand already uses its ID. */
function renumberClashes(entities: Entity[]): void {
  const used = new Set(entities.filter((e) => e.locked).map((e) => e.id));
  for (const e of entities) {
    if (e.locked || !used.has(e.id)) {
      used.add(e.id);
      continue;
    }
    const prefix = e.id.replace(/\d+$/, "");
    let n = 1;
    while (used.has(prefix + n)) n++;
    e.id = prefix + n;
    used.add(e.id);
  }
}

/** A town: streets, buildings with doors, gardens, people (see generators/town.ts). */
function townStages(ctx: GenContext, geometry: Geometry) {
  prepareZones(ctx);
  applyLayout(ctx, geometry); // the sea, for a waterfront town
  applyZones(ctx);
  buildTown(ctx);
  closeLedgeTraps(ctx); // hillsides' ledges never drop the player somewhere they can't leave
  placeEntities(ctx); // the town sign and hidden items
}

/** A forest: a maze through dense forest, clearings, long grass, trainers and items (see generators/forest.ts). */
function forestStages(ctx: GenContext) {
  prepareZones(ctx); // biome per cell
  applyZones(ctx); // the user's water, edges and keep-clear ground
  buildForest(ctx);
  addForestLedges(ctx); // with a travel direction: jump back toward the start
  removeWaterLedges(ctx); // no ledge jumps off water or into it
  placeEntities(ctx); // trainers on the main path, items at dead ends, hidden items, the sign
  addGuaranteedHidden(ctx);
}

/** A cave floor: chambers, tunnels, exits, platforms, water, Rock Smash rocks (see generators/cave.ts). */
function caveStages(ctx: GenContext) {
  prepareZones(ctx);
  applyZones(ctx);
  buildCave(ctx);
  closeLedgeTraps(ctx); // platforms' ledges never drop the player somewhere they can't leave
  placeEntities(ctx); // trainers, items at the far ends, hidden items
}

function runOnce(map: MapBlueprint, input: GenInput, geometry: Geometry, seed: number, validate: ValidateOptions): GenerateResult {
  const ctx = new GenContext(input, new Rng(seed));
  // Things placed by hand stay put; the generator works around them.
  for (const e of map.entities) if (e.locked) ctx.entities.push(cloneThing(e));
  if (map.mapType === "town") townStages(ctx, geometry);
  else if (map.mapType === "forest") forestStages(ctx);
  else if (map.mapType === "cave") caveStages(ctx);
  else routeStages(ctx, geometry);
  return finish(map, input, ctx, validate);
}

/** A route: the path, hills, grass, water, ledges, pockets, trainers and items. */
function routeStages(ctx: GenContext, geometry: Geometry) {
  prepareZones(ctx); // which cells each of the user's zones covers; biome per cell
  applyLayout(ctx, geometry); // sea, river or open water
  applyZones(ctx); // the user's water, boundaries and keep-clear areas
  addPlateaus(ctx); // elevation: cliffs, stairs, ledges
  buildRouteSkeleton(ctx); // entrances, main path, branches
  connectStairs(ctx); // trails up to every flight of stairs
  addGrassShortcut(ctx); // the second way through, in tall grass
  addPathGrass(ctx); // grass across the main path
  fillTerrain(ctx); // trees, open ground, ponds, stream, grass
  applyMarsh(ctx); // marsh zones: shallow pools, long grass, mud
  addHmPockets(ctx);
  addLedgeRows(ctx); // ledges across the route: wind round one way, jump down the other
  addLedgePockets(ctx); // with a travel direction: an item reached by jumping in on the way back
  cleanup(ctx);
  addSnow(ctx); // snow from the highest ground down
  closeLedgeTraps(ctx); // no ledge may drop the player somewhere they can't leave
  placeEntities(ctx);
}

/** Final elevation, the things' levels, the warps, validation, and the hidden items for quiet dead ends. */
function finish(map: MapBlueprint, input: GenInput, ctx: GenContext, validate: ValidateOptions): GenerateResult {
  const elevation = finishElevation(ctx);
  // Warps placed by hand are kept; the generator's own (town doors) get IDs that don't clash with them.
  const keptWarps = map.warps.filter((w) => w.locked);
  const used = new Set(keptWarps.map((w) => w.id));
  const madeWarps = ctx.warps.map((w) => {
    let n = 1;
    while (used.has(`w${n}`)) n++;
    used.add(`w${n}`);
    return { ...w, id: `w${n}` };
  });
  const warps = [...keptWarps, ...madeWarps];
  // Each thing stands at the elevation of its cell (Porymap events need it to match).
  const levelAt = (x: number, y: number) => ELEVATION_LEVELS[elevation[y * ctx.width + x]];
  const keptZones = map.layers.zones.filter((z) => z.data.generated !== true);
  if (ctx.lockedBridges.length) {
    const mask = { width: map.width, height: map.height, data: new Uint8Array(map.width * map.height) };
    for (const i of ctx.lockedBridges) mask.data[i] = 1;
    ctx.zones.push({ id: "generated_bridges", name: "Bridges over your water", kind: "bridge", hard: true, fuzziness: 0, mask, data: { generated: true } });
  }
  const zones = [...keptZones, ...ctx.zones];
  const draft: MapBlueprint = {
    ...map,
    openings: input.openings,
    entities: ctx.entities,
    warps,
    layers: {
      ...map.layers,
      terrain: { width: map.width, height: map.height, data: ctx.terrain },
      elevation: { width: map.width, height: map.height, data: elevation },
      zones,
    },
  };
  for (const e of ctx.entities) e.elevation = levelAt(e.x, e.y);
  let issues = validateMap(draft, validate);
  // Quiet dead ends get a hidden item at their far end, then check again.
  const empty = issues.filter((i) => i.code === "empty-dead-end");
  if (empty.length) {
    let hidden = ctx.entities.filter((e) => e.kind === "hidden_item").length;
    const flagBase = input.labelBase.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase();
    for (const issue of empty) {
      const c = issue.cells[0];
      const [x, y] = ctx.xy(c);
      if (ctx.entities.some((e) => e.x === x && e.y === y)) continue;
      hidden++;
      ctx.entities.push({ id: `H${hidden}`, kind: "hidden_item", x, y, elevation: levelAt(x, y), fields: { item: "ITEM_POTION", tier: "common", flag: `FLAG_HIDDEN_ITEM_${flagBase}_${hidden}` } });
    }
    issues = validateMap(draft, validate);
  }
  renumberClashes(ctx.entities);
  const notes: string[] = [];
  if (input.town) {
    const wanted = buildingList(input.town).length;
    if (ctx.buildings.length < wanted)
      notes.push(`Only ${ctx.buildings.length} of the ${wanted} buildings fit. Make the town bigger (Maps → resize), or ask for fewer houses.`);
  }
  return {
    notes,
    ok: !issues.some((i) => i.severity === "error"),
    terrain: ctx.terrain,
    elevation,
    entities: ctx.entities,
    warps,
    openings: input.openings,
    zones,
    issues,
    attempts: 1,
  };
}

/** Generate a route for this map, using its seed and saved settings. Doesn't change the map. */
export function generateRoute(map: MapBlueprint, validate: Omit<ValidateOptions, "availableHms"> = {}): GenerateResult {
  const town = map.mapType === "town" ? readTownParams(map.params) : undefined;
  // Towns share the route settings they use (border, trees, hidden items) but have no trainers,
  // extra items, branches, hills or ledges; a waterfront town is laid out like a coastal route.
  const forest = map.mapType === "forest" ? readForestParams(map.params) : undefined;
  const cave = map.mapType === "cave" ? readCaveParams(map.params) : undefined;
  const routeParams = readRouteParams(map.params);
  // Forests use the route settings for paths, grass, border, trainers, items, ledge shortcuts and
  // travel direction, without hills, branches (the maze makes its own) or HM areas.
  // Caves use the route settings for the border, trainers and items; their exits are warps, not edges.
  const params = cave
    ? { ...routeParams, elevation: 0, branches: 0, hmPockets: 0, ledges: 0, layout: "land" as const, grassShortcut: false, pathGrass: 0, snow: 0, travel: "auto" as const, pathWidthMin: 1 }
    : forest
    ? { ...routeParams, elevation: 0, branches: 0, hmPockets: 0, layout: "land" as const, grassShortcut: false, pathGrass: 0, snow: 0 }
    : town
    ? {
        ...routeParams,
        trainers: 0,
        items: 0,
        // Towns are flat and have no side streets unless asked (the route defaults would make every town hilly).
        branches: typeof map.params.branches === "number" ? routeParams.branches : 0,
        elevation: typeof map.params.elevation === "number" ? routeParams.elevation : 0,
        ledges: 0,
        hmPockets: 0,
        travel: "auto" as const,
        layout: town.townLayout === "waterfront" ? ("coastal" as const) : ("land" as const),
        surfEntrances: false,
        water: -0.5, // a narrower sea, so a waterfront town has room for its buildings
      }
    : routeParams;
  const layout = resolveLayout(params, map.biome);
  const layoutSeed = deriveSeed(map.seed, "layout");
  const geometry = computeGeometry(map.width, map.height, params, layout, layoutSeed);
  const openings = cave
    ? map.openings
    : map.openings.length
    ? map.openings
    : // A map from before file format 10 may still have the old travel direction: mark its Start and Finish.
      markTravel(shiftOpeningsOutOfZones(map, layoutOpenings(geometry, params, layout, new Rng(deriveSeed(map.seed, "openings")))), params.travel);
  const input: GenInput = {
    width: map.width,
    height: map.height,
    terrain: map.layers.terrain.data,
    elevation: map.layers.elevation.data,
    locks: map.layers.locks.data,
    openings,
    warps: map.warps,
    oldBridges: map.layers.zones.find((z) => z.id === "generated_bridges" && z.data.generated === true)?.mask.data,
    biome: map.biome,
    zones: map.layers.zones.filter((z) => z.data.generated !== true),
    layout,
    params,
    labelBase: labelBase(map),
    layoutSeed,
    mapType: map.mapType,
    mapConstant: map.header.id,
    town,
    forest,
    cave,
  };
  const opts: ValidateOptions = { ...validate, availableHms: hmsFor(params, map.biome) };
  let best: GenerateResult | null = null;
  const errorCount = (r: GenerateResult) => r.issues.filter((i) => i.severity === "error").length;
  for (let attempt = 0; attempt <= params.retries; attempt++) {
    const seed = attempt === 0 ? map.seed : deriveSeed(map.seed, `attempt${attempt}`);
    const result = runOnce(map, input, geometry, seed, opts);
    result.attempts = attempt + 1;
    if (result.ok) return result;
    if (!best || errorCount(result) < errorCount(best)) best = result;
  }
  return best!;
}

/** Copy a result into the map (locked cells were already left as they were). */
export function applyResult(map: MapBlueprint, result: GenerateResult): void {
  map.layers.terrain.data.set(result.terrain);
  map.layers.elevation.data.set(result.elevation);
  map.entities = result.entities;
  map.warps = result.warps;
  map.openings = result.openings;
  map.layers.zones = result.zones;
  // The old travel direction setting is now on the entrances (Start and Finish).
  const { travel: _old, ...rest } = map.params;
  map.params = { ...rest, generatorVersion: GENERATOR_VERSION };
  // The border block shows beyond the map edges: water for sea routes, the wall style otherwise.
  const p = readRouteParams(map.params);
  const layout = map.mapType === "town" ? (readTownParams(map.params).townLayout === "waterfront" ? "coastal" : "land") : resolveLayout(p, map.biome);
  const border = map.mapType === "cave" ? "rock_wall" : layout === "water" || layout === "coastal" ? "water_deep" : resolveBorder(p, map.biome) === "cliff" ? "rock_wall" : "tree";
  map.layout.borderBlock = [border, border, border, border];
}

// ---------------------------------------------------------------------------
// Regenerating part of a map, or all of it
// ---------------------------------------------------------------------------

/** A copy of a map with every cell and thing outside `area` locked, for regenerating just that area. */
export function areaInput(map: MapBlueprint, area: Area, seed: number): MapBlueprint {
  const locks = map.layers.locks.data.slice();
  for (let y = 0; y < map.height; y++)
    for (let x = 0; x < map.width; x++) if (!inArea(area, x, y)) locks[y * map.width + x] = 1;
  return {
    ...map,
    seed: seed >>> 0,
    layers: { ...map.layers, locks: { ...map.layers.locks, data: locks } },
    entities: map.entities.map((e) => (inArea(area, e.x, e.y) ? { ...e } : { ...e, locked: true })),
  };
}

/**
 * Copy the result of regenerating an area back into the map. Only cells inside the
 * area change; things outside it stay as they were, and only new things inside it
 * are added. HM-area zones that overlapped the area are replaced by the new ones.
 */
export function applyAreaResult(map: MapBlueprint, area: Area, result: GenerateResult): void {
  for (let y = area.y; y < area.y + area.h; y++)
    for (let x = area.x; x < area.x + area.w; x++) {
      if (!inArea(area, x, y)) continue;
      const i = y * map.width + x;
      map.layers.terrain.data[i] = result.terrain[i];
      map.layers.elevation.data[i] = result.elevation[i];
    }
  const touches = (z: Zone) => {
    for (let y = area.y; y < area.y + area.h; y++) for (let x = area.x; x < area.x + area.w; x++) if (inArea(area, x, y) && z.mask.data[y * map.width + x]) return true;
    return false;
  };
  const inside = (z: Zone) => z.mask.data.every((v, i) => !v || inArea(area, i % map.width, Math.floor(i / map.width)));
  map.layers.zones = [
    ...map.layers.zones.filter((z) => z.data.generated !== true || !touches(z)),
    ...result.zones.filter((z) => z.data.generated === true && inside(z) && !map.layers.zones.some((k) => k.id === z.id)),
  ];
  // Warps: keep those outside the area and those placed by hand; take the new ones inside it.
  const keptWarps = map.warps.filter((w) => !inArea(area, w.x, w.y) || w.locked);
  const usedWarpIds = new Set(keptWarps.map((w) => w.id));
  const newWarps = result.warps.filter((w) => !w.locked && inArea(area, w.x, w.y)).map((w) => {
    let n = 1;
    while (usedWarpIds.has(`w${n}`)) n++;
    usedWarpIds.add(`w${n}`);
    return { ...w, id: `w${n}` };
  });
  map.warps = [...keptWarps, ...newWarps];
  const keep = map.entities.filter((e) => !inArea(area, e.x, e.y) || e.locked);
  const added = result.entities.filter((e) => inArea(area, e.x, e.y) && !e.locked && !keep.some((k) => k.x === e.x && k.y === e.y));
  map.entities = [...keep, ...added];
  // New IDs must not clash with any kept thing, hand-placed or not.
  const used = new Set(keep.map((e) => e.id));
  for (const e of added) {
    if (!used.has(e.id)) {
      used.add(e.id);
      continue;
    }
    const prefix = e.id.replace(/\d+$/, "");
    let n = 1;
    while (used.has(prefix + n)) n++;
    e.id = prefix + n;
    used.add(e.id);
  }
}

/** A copy of a map with nothing locked, for regenerating the whole map from scratch. */
export function wholeMapInput(map: MapBlueprint): MapBlueprint {
  return {
    ...map,
    layers: { ...map.layers, locks: { ...map.layers.locks, data: new Uint8Array(map.width * map.height) } },
    entities: map.entities.map((e) => ({ ...e, locked: false })),
  };
}
