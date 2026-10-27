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
import { ELEVATION_LEVELS, TERRAIN_TYPES } from "./terrain";
import type { Issue, ValidateOptions } from "./validate";
import { validateMap } from "./validate";
import { GenContext } from "./generators/context";
import type { GenInput } from "./generators/context";
import { readRouteParams } from "./generators/params";
import { buildRouteSkeleton, defaultOpenings } from "./generators/routeSkeleton";
import { fillTerrain } from "./generators/terrainFill";
import { addHmPockets, addLedges } from "./generators/features";
import { cleanup } from "./generators/cleanup";
import { placeEntities } from "./generators/placement";

/** Version of the generators. Bumped when the same seed starts giving different maps. */
export const GENERATOR_VERSION = 1;

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

function elevationFor(terrain: Uint8Array): Uint8Array {
  const out = new Uint8Array(terrain.length);
  for (let i = 0; i < terrain.length; i++) out[i] = ELEVATION_LEVELS.indexOf(TERRAIN_TYPES[terrain[i]].elevation);
  return out;
}

/** The text used to suggest script labels and flags, e.g. "Route1". */
function labelBase(map: MapBlueprint): string {
  return map.header.name.replace(/[^A-Za-z0-9]/g, "") || map.name.replace(/[^A-Za-z0-9]/g, "") || "Map";
}

function runOnce(map: MapBlueprint, input: GenInput, seed: number, validate: ValidateOptions): GenerateResult {
  const ctx = new GenContext(input, new Rng(seed));
  buildRouteSkeleton(ctx);
  fillTerrain(ctx);
  addHmPockets(ctx);
  addLedges(ctx);
  cleanup(ctx);
  placeEntities(ctx);

  const elevation = elevationFor(ctx.terrain);
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
      ctx.entities.push({ id: `H${hidden}`, kind: "hidden_item", x, y, elevation: "ground", fields: { item: "ITEM_POTION", tier: "common", flag: `FLAG_HIDDEN_ITEM_${flagBase}_${hidden}` } });
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
  const openings = map.openings.length ? map.openings : defaultOpenings(map.width, map.height, params, new Rng(deriveSeed(map.seed, "openings")));
  const input: GenInput = {
    width: map.width,
    height: map.height,
    terrain: map.layers.terrain.data,
    locks: map.layers.locks.data,
    openings,
    biome: map.biome,
    params,
    labelBase: labelBase(map),
  };
  const opts: ValidateOptions = { ...validate, availableHms: params.availableHms };
  let best: GenerateResult | null = null;
  const errorCount = (r: GenerateResult) => r.issues.filter((i) => i.severity === "error").length;
  for (let attempt = 0; attempt <= params.retries; attempt++) {
    const seed = attempt === 0 ? map.seed : deriveSeed(map.seed, `attempt${attempt}`);
    const result = runOnce(map, input, seed, opts);
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
}
