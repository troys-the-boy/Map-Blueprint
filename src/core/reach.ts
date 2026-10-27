// Reachability: where can the player walk, given the HMs they have?
//
// The movement rules follow Gen 3:
//   • trees, walls, fences, signs and buildings block;
//   • a ledge can only be crossed in its jump direction, and the player lands on
//     the cell beyond it;
//   • deep water and currents need Surf; a waterfall needs Surf + Waterfall;
//   • Cut trees, Rock Smash rocks and Strength boulders (entities) need their HM;
//   • trainers, NPCs and signs (entities) block their cell. Item balls don't
//     count as blocking, since the player picks them up.
//   • elevation: water, ground and bridges are the low level; raised1 and
//     raised2 are plateaus. You can only change level on stairs (one level at
//     a time), or by jumping down a ledge.
// Simplification for now: currents are treated as plain Surf water (forced
// movement is ignored).

import type { Hm } from "./constants";
import { DIRS } from "./grid";
import type { Entity, Opening } from "./model";
import type { Direction } from "./terrain";
import { ELEVATION_LEVELS, TERRAIN_TYPES } from "./terrain";

/** The minimum a reachability check needs to know about a map. */
export interface MapView {
  width: number;
  height: number;
  terrain: Uint8Array;
  entities: readonly Entity[];
  /** Elevation level per cell (index into ELEVATION_LEVELS). Missing = all low ground. */
  elevation?: Uint8Array;
}

/** Height tier of each elevation level: water, ground and bridges are all tier 0. */
const TIER: Record<string, number> = { water: 0, ground: 0, bridge: 0, raised1: 1, raised2: 2 };
const LEVEL_TIER = ELEVATION_LEVELS.map((l) => TIER[l]);
const STAIRS = TERRAIN_TYPES.findIndex((t) => t.id === "stairs");

/** HMs that matter for reaching places (Flash only lights caves). In the order the heatmap labels them. */
export const MOVEMENT_HMS: readonly Hm[] = ["cut", "rock_smash", "strength", "surf", "waterfall", "dive"];

const BLOCKING_KINDS = new Set(["trainer", "npc", "sign", "berry_tree"]);
const HM_OBJECTS: Record<string, Hm> = { cut_tree: "cut", smash_rock: "rock_smash", strength_boulder: "strength" };

/** Per cell: 0 free, 1 blocked by an object, 2+ needs the HM MOVEMENT_HMS[value - 2]. */
function objectLayer(view: MapView): Uint8Array {
  const layer = new Uint8Array(view.width * view.height);
  for (const e of view.entities) {
    if (e.x < 0 || e.y < 0 || e.x >= view.width || e.y >= view.height) continue;
    const i = e.y * view.width + e.x;
    if (BLOCKING_KINDS.has(e.kind)) layer[i] = 1;
    else if (HM_OBJECTS[e.kind]) layer[i] = 2 + MOVEMENT_HMS.indexOf(HM_OBJECTS[e.kind]);
  }
  return layer;
}

/** Directed movement graph for one set of HMs: for each cell, the cells one step reaches. */
export class MoveGraph {
  /** out[i*4 + k] = destination cell for direction k, or -1. */
  readonly out: Int32Array;
  /** 1 where the player can stand with these HMs. */
  readonly canStand: Uint8Array;

  constructor(
    readonly view: MapView,
    readonly hms: ReadonlySet<Hm>,
  ) {
    const { width, height, terrain } = view;
    const objects = objectLayer(view);
    const n = width * height;
    this.out = new Int32Array(n * 4).fill(-1);

    // Can the player stand on cell i (ignoring how they got there)?
    const standable = (i: number): boolean => {
      const t = TERRAIN_TYPES[terrain[i]];
      if (objects[i] === 1) return false;
      if (objects[i] >= 2 && !hms.has(MOVEMENT_HMS[objects[i] - 2])) return false;
      switch (t.passability) {
        case "walk":
        case "warp":
          return true;
        case "surf":
          return hms.has("surf");
        case "hm":
          // Waterfalls need Surf and Waterfall. Dive spots are surfable water.
          return hms.has("surf") && (t.hm !== "waterfall" || hms.has("waterfall"));
        default:
          return false;
      }
    };
    const canStand = (this.canStand = new Uint8Array(n));
    for (let i = 0; i < n; i++) canStand[i] = standable(i) ? 1 : 0;
    const elev = view.elevation;
    const tier = (i: number) => (elev ? LEVEL_TIER[elev[i]] ?? 0 : 0);
    /** Can you step from a to b without a ledge? Same level, or one level apart on stairs. */
    const levelOk = (a: number, b: number) => {
      const d = Math.abs(tier(a) - tier(b));
      return d === 0 || (d === 1 && (terrain[a] === STAIRS || terrain[b] === STAIRS));
    };

    for (let i = 0; i < n; i++) {
      if (!canStand[i]) continue;
      const x = i % width;
      const y = (i - x) / width;
      DIRS.forEach(({ dir, dx, dy }, k) => {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) return;
        const j = ny * width + nx;
        const t = TERRAIN_TYPES[terrain[j]];
        if (t.passability === "one_way") {
          // Jump over the ledge in its direction only; land on the next cell.
          if (t.direction !== dir) return;
          const lx = nx + dx;
          const ly = ny + dy;
          if (lx < 0 || ly < 0 || lx >= width || ly >= height) return;
          const l = ly * width + lx;
          // A ledge only ever takes you down (or along the same level).
          if (canStand[l] && tier(l) <= tier(i)) this.out[i * 4 + k] = l;
          return;
        }
        if (canStand[j] && levelOk(i, j)) this.out[i * 4 + k] = j;
      });
    }
  }

  /** Every cell reachable from any start cell (1 = reachable). */
  forward(starts: Iterable<number>): Uint8Array {
    const seen = new Uint8Array(this.view.width * this.view.height);
    const queue: number[] = [];
    for (const s of starts) {
      if (!seen[s]) {
        seen[s] = 1;
        queue.push(s);
      }
    }
    for (let h = 0; h < queue.length; h++) {
      const i = queue[h];
      for (let k = 0; k < 4; k++) {
        const j = this.out[i * 4 + k];
        if (j >= 0 && !seen[j]) {
          seen[j] = 1;
          queue.push(j);
        }
      }
    }
    return seen;
  }

  /** Every cell from which some target cell can be reached (1 = can get there). */
  backward(targets: Iterable<number>): Uint8Array {
    const n = this.view.width * this.view.height;
    // Build the reverse edges once.
    const revStart = new Int32Array(n + 1);
    for (let i = 0; i < n * 4; i++) if (this.out[i] >= 0) revStart[this.out[i] + 1]++;
    for (let i = 0; i < n; i++) revStart[i + 1] += revStart[i];
    const fill = revStart.slice(0, n);
    const rev = new Int32Array(revStart[n]);
    for (let i = 0; i < n * 4; i++) {
      const j = this.out[i];
      if (j >= 0) rev[fill[j]++] = (i / 4) | 0;
    }
    const seen = new Uint8Array(n);
    const queue: number[] = [];
    for (const t of targets) {
      if (!seen[t]) {
        seen[t] = 1;
        queue.push(t);
      }
    }
    for (let h = 0; h < queue.length; h++) {
      const j = queue[h];
      for (let r = revStart[j]; r < revStart[j + 1]; r++) {
        const i = rev[r];
        if (!seen[i]) {
          seen[i] = 1;
          queue.push(i);
        }
      }
    }
    return seen;
  }
}

/** HMs needed to use an entrance: surf entrances need Surf. */
export function openingNeeds(o: Opening): Hm[] {
  return o.kind === "surf" ? ["surf"] : [];
}

/** The edge cells of an opening (cells on the map's outer row or column). */
export function openingCells(o: Opening, width: number, height: number): number[] {
  const out: number[] = [];
  for (let k = 0; k < o.width; k++) {
    const along = o.start + k;
    switch (o.edge) {
      case "north":
        if (along < width) out.push(along);
        break;
      case "south":
        if (along < width) out.push((height - 1) * width + along);
        break;
      case "west":
        if (along < height) out.push(along * width);
        break;
      case "east":
        if (along < height) out.push(along * width + width - 1);
        break;
    }
  }
  return out;
}

/**
 * Heatmap of which HMs are needed to reach each cell from the openings:
 *   -2 = not a walkable cell, -1 = can't be reached even with every HM,
 *    0 = reachable with none of them,
 *    1…6 = needs exactly this one: MOVEMENT_HMS[value - 1],
 *    7 = needs more than one.
 */
export function hmHeatmap(view: MapView, starts: number[]): Int8Array {
  const n = view.width * view.height;
  const out = new Int8Array(n).fill(-2);
  const all = new MoveGraph(view, new Set(MOVEMENT_HMS));
  const allReach = all.forward(starts);
  const none = new MoveGraph(view, new Set()).forward(starts);
  const single = MOVEMENT_HMS.map((h) => new MoveGraph(view, new Set([h])).forward(starts));
  for (let i = 0; i < n; i++) {
    if (!all.canStand[i]) continue;
    if (none[i]) out[i] = 0;
    else {
      const k = single.findIndex((r) => r[i] === 1);
      out[i] = k >= 0 ? k + 1 : allReach[i] ? 7 : -1;
    }
  }
  return out;
}

export function directionName(d: Direction): string {
  return { n: "north", s: "south", e: "east", w: "west" }[d];
}
