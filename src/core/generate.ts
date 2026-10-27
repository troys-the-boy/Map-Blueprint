// Generation entry point: runs the stages in order, validates the result, and
// retries with a related seed if anything is wrong.
//
//   same map + same settings + same seed  →  exactly the same result.
//
// Locked cells are never changed. If they make a valid map impossible (for
// example a painted wall across the only way through), the best attempt is
// returned along with the validation errors that explain why.

import type { Entity, MapBlueprint, Opening, Zone } from "./model";
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
import { cleanup, closeLedgeTraps } from "./generators/cleanup";
import { placeEntities } from "./generators/placement";
import { addSnow } from "./generators/snow";
import { applyMarsh, applyZones, prepareZones, shiftOpeningsOutOfZones } from "./generators/zones";
import { ELEVATION_LEVELS } from "./terrain";

/** Version of the generators. Bumped when the same seed starts giving different maps. */
export const GENERATOR_VERSION = 5;

export interface GenerateResult {
  ok: boolean;
  terrain: Uint8Array;
  elevation: Uint8Array;
  entities: Entity[];
  openings: Opening[];
  zones: Zone[];
  issues: Issue[];
  /** How many tries it took (1 = first try). */
  attempts: number;
}

/** Map types that have a generator so far. */
export function canGenerate(map: MapBlueprint): boolean {
  return map.mapType === "route";
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

function runOnce(map: MapBlueprint, input: GenInput, geometry: Geometry, seed: number, validate: ValidateOptions): GenerateResult {
  const ctx = new GenContext(input, new Rng(seed));
  // Things placed by hand stay put; the generator works around them.
  for (const e of map.entities) if (e.locked) ctx.entities.push(cloneThing(e));
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

  const elevation = finishElevation(ctx);
  // Each thing stands at the elevation of its cell (Porymap events need it to match).
  const levelAt = (x: number, y: number) => ELEVATION_LEVELS[elevation[y * ctx.width + x]];
  const keptZones = map.layers.zones.filter((z) => z.data.generated !== true);
  const zones = [...keptZones, ...ctx.zones];
  const draft: MapBlueprint = {
    ...map,
    openings: input.openings,
    entities: ctx.entities,
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
  return {
    ok: !issues.some((i) => i.severity === "error"),
    terrain: ctx.terrain,
    elevation,
    entities: ctx.entities,
    openings: input.openings,
    zones,
    issues,
    attempts: 1,
  };
}

/** Generate a route for this map, using its seed and saved settings. Doesn't change the map. */
export function generateRoute(map: MapBlueprint, validate: Omit<ValidateOptions, "availableHms"> = {}): GenerateResult {
  const params = readRouteParams(map.params);
  const layout = resolveLayout(params, map.biome);
  const layoutSeed = deriveSeed(map.seed, "layout");
  const geometry = computeGeometry(map.width, map.height, params, layout, layoutSeed);
  const openings = map.openings.length
    ? map.openings
    : shiftOpeningsOutOfZones(map, layoutOpenings(geometry, params, layout, new Rng(deriveSeed(map.seed, "openings"))));
  const input: GenInput = {
    width: map.width,
    height: map.height,
    terrain: map.layers.terrain.data,
    elevation: map.layers.elevation.data,
    locks: map.layers.locks.data,
    openings,
    biome: map.biome,
    zones: map.layers.zones.filter((z) => z.data.generated !== true),
    layout,
    params,
    labelBase: labelBase(map),
    layoutSeed,
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
  map.openings = result.openings;
  map.layers.zones = result.zones;
  map.params = { ...map.params, generatorVersion: GENERATOR_VERSION };
  // The border block shows beyond the map edges: water for sea routes, the wall style otherwise.
  const p = readRouteParams(map.params);
  const layout = resolveLayout(p, map.biome);
  const border = layout === "water" || layout === "coastal" ? "water_deep" : resolveBorder(p, map.biome) === "cliff" ? "rock_wall" : "tree";
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
