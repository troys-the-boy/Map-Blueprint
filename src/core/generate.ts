// Generation entry point: runs the stages in order, validates the result, and
// retries with a related seed if anything is wrong.
//
//   same map + same settings + same seed  →  exactly the same result.
//
// Locked cells are never changed. If they make a valid map impossible (for
// example a painted wall across the only way through), the best attempt is
// returned along with the validation errors that explain why.

import type { Entity, MapBlueprint, Opening, Zone } from "./model";
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
import { addHmPockets, addLedges } from "./generators/features";
import { cleanup } from "./generators/cleanup";
import { placeEntities } from "./generators/placement";
import { addSnow } from "./generators/snow";
import { ELEVATION_LEVELS } from "./terrain";

/** Version of the generators. Bumped when the same seed starts giving different maps. */
export const GENERATOR_VERSION = 3;

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

function runOnce(map: MapBlueprint, input: GenInput, geometry: Geometry, seed: number, validate: ValidateOptions): GenerateResult {
  const ctx = new GenContext(input, new Rng(seed));
  applyLayout(ctx, geometry); // sea, river or open water
  addPlateaus(ctx); // elevation: cliffs, stairs, ledges
  buildRouteSkeleton(ctx); // entrances, main path, branches
  connectStairs(ctx); // trails up to every flight of stairs
  addGrassShortcut(ctx); // the second way through, in tall grass
  addPathGrass(ctx); // grass across the main path
  fillTerrain(ctx); // trees, open ground, ponds, stream, grass
  addHmPockets(ctx);
  addLedges(ctx); // extra ledge shortcut loops
  cleanup(ctx);
  addSnow(ctx); // snow from the highest ground down
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
  const openings = map.openings.length ? map.openings : layoutOpenings(geometry, params, layout, new Rng(deriveSeed(map.seed, "openings")));
  const input: GenInput = {
    width: map.width,
    height: map.height,
    terrain: map.layers.terrain.data,
    elevation: map.layers.elevation.data,
    locks: map.layers.locks.data,
    openings,
    biome: map.biome,
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
