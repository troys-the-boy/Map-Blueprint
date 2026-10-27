// Small helpers shared by the generators, validation and exporters.

import type { Direction } from "./terrain";
import { TERRAIN_TYPES, requireTerrain } from "./terrain";

/** Steps for the four directions. y grows downward (south). */
export const DIRS: ReadonlyArray<{ dir: Direction; dx: number; dy: number }> = [
  { dir: "n", dx: 0, dy: -1 },
  { dir: "e", dx: 1, dy: 0 },
  { dir: "s", dx: 0, dy: 1 },
  { dir: "w", dx: -1, dy: 0 },
];

export function dirStep(d: Direction): { dx: number; dy: number } {
  return DIRS.find((s) => s.dir === d)!;
}

/** Terrain indices the generators use, looked up once by name. */
export const T = {
  path: requireTerrain("path"),
  road: requireTerrain("road"),
  ground: requireTerrain("ground"),
  tallGrass: requireTerrain("tall_grass"),
  longGrass: requireTerrain("long_grass"),
  sand: requireTerrain("sand"),
  snow: requireTerrain("snow"),
  snowGrass: requireTerrain("snow_grass"),
  ice: requireTerrain("ice"),
  snowdrift: requireTerrain("snowdrift"),
  mud: requireTerrain("mud"),
  flowers: requireTerrain("flowers"),
  tree: requireTerrain("tree"),
  denseForest: requireTerrain("dense_forest"),
  rockWall: requireTerrain("rock_wall"),
  ledgeS: requireTerrain("ledge_s"),
  ledgeE: requireTerrain("ledge_e"),
  ledgeW: requireTerrain("ledge_w"),
  waterShallow: requireTerrain("water_shallow"),
  waterDeep: requireTerrain("water_deep"),
  bridge: requireTerrain("bridge"),
  stairs: requireTerrain("stairs"),
  signTile: requireTerrain("sign_tile"),
  caveEntrance: requireTerrain("cave_entrance"),
  building: requireTerrain("building"),
  fence: requireTerrain("fence"),
  void: requireTerrain("void"),
} as const;

/** True for terrain that blocks walking outright (trees, walls, signs…). */
export const IS_BLOCKED: readonly boolean[] = TERRAIN_TYPES.map((t) => t.passability === "blocked");
/** True for terrain you can walk on with no HM. */
export const IS_WALKABLE: readonly boolean[] = TERRAIN_TYPES.map((t) => t.passability === "walk" || t.passability === "warp");
/** True for "wall" terrain: trees, dense forest, rock walls. */
export const IS_WALL: readonly boolean[] = TERRAIN_TYPES.map((t) => t.category === "blocking");
/** True for grass you can get encounters in. */
export const IS_GRASS: readonly boolean[] = TERRAIN_TYPES.map((t) => t.encounters === "land");
/** True for ice the player slides across. */
export const IS_ICE: readonly boolean[] = TERRAIN_TYPES.map((t) => t.slide === true);
/** True for water types. */
export const IS_WATER: readonly boolean[] = TERRAIN_TYPES.map((t) => t.category === "water");

/**
 * Distance (in 4-neighbour steps) from every cell to the nearest source cell.
 * Cells for which `passable` is false are never entered. Unreached cells get Infinity.
 */
export function distanceField(
  width: number,
  height: number,
  sources: Iterable<number>,
  passable: (i: number) => boolean = () => true,
): Float64Array {
  const dist = new Float64Array(width * height).fill(Infinity);
  const queue: number[] = [];
  for (const s of sources) {
    if (dist[s] !== 0) {
      dist[s] = 0;
      queue.push(s);
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head];
    const x = i % width;
    const y = (i - x) / width;
    for (const { dx, dy } of DIRS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const j = ny * width + nx;
      if (dist[j] !== Infinity || !passable(j)) continue;
      dist[j] = dist[i] + 1;
      queue.push(j);
    }
  }
  return dist;
}

/** Group cells into 4-connected components of cells where `member` is true. Returns component id per cell (-1 = none). */
export function components(width: number, height: number, member: (i: number) => boolean): { ids: Int32Array; sizes: number[] } {
  const ids = new Int32Array(width * height).fill(-1);
  const sizes: number[] = [];
  const stack: number[] = [];
  for (let start = 0; start < width * height; start++) {
    if (ids[start] !== -1 || !member(start)) continue;
    const id = sizes.length;
    let size = 0;
    ids[start] = id;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop()!;
      size++;
      const x = i % width;
      const y = (i - x) / width;
      for (const { dx, dy } of DIRS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const j = ny * width + nx;
        if (ids[j] === -1 && member(j)) {
          ids[j] = id;
          stack.push(j);
        }
      }
    }
    sizes.push(size);
  }
  return { ids, sizes };
}

/** Binary min-heap of (priority, value) pairs, for shortest-path searches. */
export class MinHeap {
  private pri: number[] = [];
  private val: number[] = [];

  get size() {
    return this.val.length;
  }

  push(priority: number, value: number) {
    const p = this.pri;
    const v = this.val;
    p.push(priority);
    v.push(value);
    let i = v.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      // Ties broken by value so results never depend on insertion quirks.
      if (p[parent] < p[i] || (p[parent] === p[i] && v[parent] <= v[i])) break;
      [p[parent], p[i]] = [p[i], p[parent]];
      [v[parent], v[i]] = [v[i], v[parent]];
      i = parent;
    }
  }

  pop(): [number, number] {
    const p = this.pri;
    const v = this.val;
    const top: [number, number] = [p[0], v[0]];
    const lastP = p.pop()!;
    const lastV = v.pop()!;
    if (v.length) {
      p[0] = lastP;
      v[0] = lastV;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < v.length && (p[l] < p[m] || (p[l] === p[m] && v[l] < v[m]))) m = l;
        if (r < v.length && (p[r] < p[m] || (p[r] === p[m] && v[r] < v[m]))) m = r;
        if (m === i) break;
        [p[m], p[i]] = [p[i], p[m]];
        [v[m], v[i]] = [v[i], v[m]];
        i = m;
      }
    }
    return top;
  }
}

/**
 * Cheapest 4-neighbour path from `from` to `to` (cell indices) given a cost per
 * cell (Infinity = impassable). Returns the cells in order, or null if no path.
 */
export function cheapestPath(width: number, height: number, from: number, to: number, cost: (i: number) => number): number[] | null {
  const n = width * height;
  const best = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const heap = new MinHeap();
  const tx = to % width;
  const ty = (to - tx) / width;
  best[from] = 0;
  heap.push(0, from);
  while (heap.size) {
    const [, i] = heap.pop();
    if (i === to) break;
    const x = i % width;
    const y = (i - x) / width;
    for (const { dx, dy } of DIRS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const j = ny * width + nx;
      const c = cost(j);
      if (c === Infinity) continue;
      const g = best[i] + c;
      if (g < best[j]) {
        best[j] = g;
        prev[j] = i;
        // A* with a Manhattan estimate (costs are at least 1 per step).
        heap.push(g + Math.abs(nx - tx) + Math.abs(ny - ty), j);
      }
    }
  }
  if (best[to] === Infinity) return null;
  const out: number[] = [];
  for (let i = to; i !== -1; i = prev[i]) out.push(i);
  return out.reverse();
}
