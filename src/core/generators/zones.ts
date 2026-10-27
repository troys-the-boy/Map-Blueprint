// Following the user's zones while generating (see core/zones.ts for what zones are).
//
//   prepareZones  – works out which cells each zone covers. A soft zone's edge is
//                   moved in or out by up to 4 cells (× fuzziness) with noise, so
//                   it looks natural; a hard zone is used exactly. Biome zones set
//                   the biome cell by cell.
//   applyZones    – right after the layout: water (lake, pond, river, ocean),
//                   boundaries (coast, riverbank, cliff, forest wall, open), and
//                   keep-clear ground, so the path is planned around them. Rivers
//                   can be crossed on bridges; the rest can't be walked through.
//   applyMarsh    – after the terrain fill: marsh becomes shallow pools, long
//                   grass and mud.
//
// Locked cells always win: ctx.set never changes them.

import { T, distanceField } from "../grid";
import type { Biome, MapBlueprint, Opening, Zone } from "../model";
import { BIOMES } from "../model";
import { isBiome } from "../zones";
import type { GenContext } from "./context";
import { Role } from "./context";
import { beachAround } from "./layout";

/** Largest distance (cells) a fully fuzzy zone's edge moves in or out. */
const MAX_WOBBLE = 4;

/** Which cells a zone covers this time: exact for hard zones, with a natural edge for soft ones. */
function membership(ctx: GenContext, z: Zone, k: number): Uint8Array {
  const mask = z.mask.data;
  const out = new Uint8Array(ctx.n);
  const wobble = z.hard ? 0 : MAX_WOBBLE * Math.max(0, Math.min(1, z.fuzziness));
  if (wobble === 0) {
    for (let i = 0; i < ctx.n; i++) out[i] = mask[i] ? 1 : 0;
    return out;
  }
  const inside: number[] = [];
  const outside: number[] = [];
  for (let i = 0; i < ctx.n; i++) (mask[i] ? inside : outside).push(i);
  if (!inside.length) return out;
  const toInside = distanceField(ctx.width, ctx.height, inside);
  const toOutside = outside.length ? distanceField(ctx.width, ctx.height, outside) : null;
  // A thin zone (a strip, a path of keep-clear ground) only wobbles inward by up to
  // half its own thickness, so it never breaks up or disappears.
  let thickest = 0;
  if (toOutside) for (const i of inside) thickest = Math.max(thickest, toOutside[i]);
  const inward = toOutside ? Math.min(wobble, Math.max(0, (thickest - 1) / 2)) : wobble;
  for (let i = 0; i < ctx.n; i++) {
    const depth = mask[i] ? (toOutside ? toOutside[i] : Infinity) - 0.5 : 0.5 - toInside[i];
    if (Math.abs(depth) > wobble + 1) {
      out[i] = depth > 0 ? 1 : 0;
      continue;
    }
    const [x, y] = ctx.xy(i);
    const n = ctx.noise.fractal(x + 8100 + k * 97, y + 8300, 6, 2) - 0.5;
    const jitter = n * 2 * (n < 0 ? inward : wobble);
    out[i] = depth + jitter > 0 ? 1 : 0;
  }
  return out;
}

/** Work out every zone's cells, and the biome of every cell. */
export function prepareZones(ctx: GenContext): void {
  ctx.zoneCells = ctx.input.zones.map((zone, k) => ({ zone, cells: membership(ctx, zone, k) }));
  for (const { zone, cells } of ctx.zoneCells) {
    if (zone.kind !== "biome" || !isBiome(zone.data.biome)) continue;
    const b = BIOMES.indexOf(zone.data.biome as Biome);
    for (let i = 0; i < ctx.n; i++) if (cells[i]) ctx.biomeIndex[i] = b;
  }
}

/** Lay down water, boundaries and keep-clear ground from the zones (later zones win). */
export function applyZones(ctx: GenContext): void {
  for (const { zone, cells } of ctx.zoneCells) {
    const list: number[] = [];
    for (let i = 0; i < ctx.n; i++) if (cells[i] && !ctx.locks[i]) list.push(i);
    if (!list.length) continue;
    if (zone.kind === "water") {
      const type = String(zone.data.water);
      if (type === "marsh") {
        // Open ground for now; it becomes pools, long grass and mud after the fill.
        for (const i of list) ctx.set(i, T.ground, Role.Clearing);
        continue;
      }
      const water = zone.data.depth === "shallow" ? T.waterShallow : T.waterDeep;
      for (const i of list) {
        ctx.set(i, water, Role.Sea);
        if (type === "river") ctx.crossable[i] = 1;
      }
      if (type === "ocean") beachAround(ctx, list, 2);
    } else if (zone.kind === "edge") {
      const b = String(zone.data.boundary);
      if (b === "coast") {
        for (const i of list) ctx.set(i, T.waterDeep, Role.Sea);
        beachAround(ctx, list, 2);
      } else if (b === "riverbank") {
        for (const i of list) ctx.set(i, T.waterDeep, Role.Sea);
        beachAround(ctx, list, 1);
      } else if (b === "cliff") for (const i of list) ctx.set(i, T.rockWall, Role.Border);
      else if (b === "forest") for (const i of list) ctx.set(i, T.denseForest, Role.Border);
      else if (b === "open") for (const i of list) ctx.set(i, T.ground, Role.Keep);
    } else if (zone.kind === "keep_clear") {
      for (const i of list) ctx.set(i, T.ground, Role.Keep);
    }
  }
}

/** Marsh: shallow pools, long grass and mud, with the path left as it is. */
export function applyMarsh(ctx: GenContext): void {
  for (const { zone, cells } of ctx.zoneCells) {
    if (zone.kind !== "water" || zone.data.water !== "marsh") continue;
    for (let i = 0; i < ctx.n; i++) {
      if (!cells[i] || ctx.isProtected(i) || !ctx.isWalkable(i)) continue;
      const [x, y] = ctx.xy(i);
      const v = ctx.noise.fractal(x + 8700, y + 8900, 5, 2);
      ctx.set(i, v < 0.38 ? T.waterShallow : v < 0.68 ? T.longGrass : v < 0.8 ? T.mud : T.ground);
    }
  }
}

/** Zones an entrance can't sit in: water (not marsh) and walls along an edge (not "open"). */
function blocksEntrance(z: Zone): boolean {
  if (z.kind === "water") return z.data.water !== "marsh";
  if (z.kind === "edge") return z.data.boundary !== "open";
  return false;
}

/**
 * Slide automatic walking entrances along their edge so they don't land in a
 * zone of water or wall (for example an ocean painted along part of the edge).
 */
export function shiftOpeningsOutOfZones(map: MapBlueprint, openings: Opening[]): Opening[] {
  const blocking = map.layers.zones.filter((z) => z.data.generated !== true && blocksEntrance(z));
  if (!blocking.length) return openings;
  const bad = new Uint8Array(map.width * map.height);
  for (const z of blocking) for (let i = 0; i < bad.length; i++) if (z.mask.data[i]) bad[i] = 1;
  const cellsOf = (o: Opening, start: number) => {
    const out: number[] = [];
    for (let k = 0; k < o.width; k++)
      for (let d = 0; d < 3; d++) {
        const along = start + k;
        const [x, y] = o.edge === "north" ? [along, d] : o.edge === "south" ? [along, map.height - 1 - d] : o.edge === "west" ? [d, along] : [map.width - 1 - d, along];
        if (x >= 0 && y >= 0 && x < map.width && y < map.height) out.push(y * map.width + x);
      }
    return out;
  };
  const edgeLength = (o: Opening) => (o.edge === "north" || o.edge === "south" ? map.width : map.height);
  return openings.map((o) => {
    if (o.kind !== "walk" || !cellsOf(o, o.start).some((i) => bad[i])) return o;
    const max = edgeLength(o) - o.width;
    for (let step = 1; step <= max; step++)
      for (const s of [o.start - step, o.start + step]) {
        if (s < 2 || s > max - 2) continue;
        if (!cellsOf(o, s).some((i) => bad[i])) return { ...o, start: s };
      }
    return o;
  });
}
