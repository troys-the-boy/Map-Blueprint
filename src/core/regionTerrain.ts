// Region terrain (land and settlements, part C): the lie of the land across the
// whole region, on the sketch's grid.
//
//   • Every sketch cell has a height band: lowland, hills, highland or peaks.
//     The sea is the painted "sea" area, as before (painting sea makes a cell
//     lowland; painting a height on the sea makes it land).
//   • Generate terrain fills the sketch with a landform (an island, a coast, a
//     valley or a mountain range) from a seed, to edit by hand afterwards.
//   • Suggest rivers and lakes works out where water would run over the bands:
//     downhill to the sea, a lake or the edge of the sketch, pooling in hollows.
//     These are suggestions: each becomes an ordinary river or lake only when
//     accepted.
//
// The water uses well-known terrain-analysis methods, written here for this
// grid (the idea of shaping a region this way comes from the Magna Urbis
// project, github.com/dunkean/magna-urbis; none of its code is used):
//   • Priority-Flood (Barnes, Lehman and Mulla, 2014): working inland from the
//     outlets, lowest ground first, gives every cell a way downhill that climbs
//     out of hollows over their lowest lip. Hollows it has to fill are lakes.
//   • Flow accumulation: each cell passes its rain to the cell it drains to, so
//     the cells that collect the most are the rivers.

import { MinHeap } from "./grid";
import { ValueNoise } from "./noise";
import { Rng, deriveSeed } from "./rng";
import type { Sketch } from "./sketch";
import { SKETCH_AREAS, SKETCH_CELL, sketchCols, sketchRows } from "./sketch";

/** Height bands of the land, lowest first. A cell's value is its index here. */
export const HEIGHT_BANDS = ["lowland", "hills", "highland", "peaks"] as const;
export type HeightBand = (typeof HEIGHT_BANDS)[number];

/** What the height brush paints: a band of land, or the sea. */
export type HeightBrush = number | "sea";

export const TERRAIN_SHAPES = ["island", "coast", "valley", "range"] as const;
export type TerrainShape = (typeof TERRAIN_SHAPES)[number];

const SEA = 1 + SKETCH_AREAS.indexOf("sea");
const LAKE = 1 + SKETCH_AREAS.indexOf("lake");

/** The level of a sketch cell for water and contours: -1 for the sea, else its height band. */
export function levelAt(sketch: Sketch, i: number): number {
  return sketch.areas[i] === SEA ? -1 : sketch.heights[i];
}

/** Paint a square of sketch cells (brush = cells across) with a height band or the sea. Returns true if anything changed. */
export function paintHeights(sketch: Sketch, x: number, y: number, brush: number, value: HeightBrush): boolean {
  const cols = sketchCols(sketch);
  const rows = sketchRows(sketch);
  const cx = Math.floor(x / SKETCH_CELL);
  const cy = Math.floor(y / SKETCH_CELL);
  const lo = -Math.floor((brush - 1) / 2);
  let changed = false;
  for (let dy = lo; dy < lo + brush; dy++)
    for (let dx = lo; dx < lo + brush; dx++) {
      const X = cx + dx;
      const Y = cy + dy;
      if (X < 0 || Y < 0 || X >= cols || Y >= rows) continue;
      const i = Y * cols + X;
      const area = value === "sea" ? SEA : sketch.areas[i] === SEA ? 0 : sketch.areas[i];
      const height = value === "sea" ? 0 : value;
      if (sketch.areas[i] !== area || sketch.heights[i] !== height) {
        sketch.areas[i] = area;
        sketch.heights[i] = height;
        changed = true;
      }
    }
  return changed;
}

/** How much of the sketch is sea for each landform, and how the land is shared between the bands. */
const SEA_SHARE: Record<TerrainShape, number> = { island: 0.38, coast: 0.28, valley: 0, range: 0 };
const BAND_SHARES = [0.45, 0.75, 0.92]; // lowland up to 45% of the land, hills to 75%, highland to 92%, peaks the rest

/**
 * Fill the sketch with a landform: every cell's height band, and the sea. Painted
 * biomes and lakes are kept, except where the new sea covers them; the old sea is
 * replaced. The same seed and shape always give the same land.
 */
export function generateTerrain(sketch: Sketch, seed: number, shape: TerrainShape): void {
  const cols = sketchCols(sketch);
  const rows = sketchRows(sketch);
  const n = cols * rows;
  const rng = new Rng(deriveSeed(seed, `terrain:${shape}`));
  const noise = new ValueNoise(rng.fork("noise"));
  const span = Math.max(cols, rows);
  // The long way across the sketch (valleys and ranges run along it), and which side a coast is on.
  const wide = cols >= rows;
  const side = rng.int(0, 3);
  const tilt = rng.range(-0.25, 0.25);
  const field = new Float32Array(n);
  for (let cy = 0; cy < rows; cy++)
    for (let cx = 0; cx < cols; cx++) {
      const u = (cx + 0.5) / cols;
      const v = (cy + 0.5) / rows;
      const rough = noise.fractal(cx, cy, span / 3.5, 4);
      const along = wide ? u : v;
      const across = wide ? v : u;
      // The line a valley or a range follows: it wanders, and leans a little across the sketch.
      const line = 0.5 + tilt * (along - 0.5) * 2 + (noise.at(along * 3 + 40, 7.5) - 0.5) * 0.3;
      let base: number;
      if (shape === "island") {
        // High in the middle (a little off-centre), falling away to the sea all round.
        const d = Math.hypot((u - 0.5 - tilt * 0.3) * 2, (v - 0.5) * 2);
        base = 1 - d * d;
      } else if (shape === "coast") {
        // The sea along one side, the land rising inland from it.
        base = side === 0 ? u : side === 1 ? 1 - u : side === 2 ? v : 1 - v;
      } else if (shape === "valley") base = Math.min(1, Math.abs(across - line) * 2.4);
      else base = 1 - Math.min(1, Math.abs(across - line) * 2.6);
      field[cy * cols + cx] = 0.7 * base + 0.45 * rough;
    }
  // Sea below a level that leaves the right share of water; the land in bands by height.
  const sorted = Array.from(field).sort((a, b) => a - b);
  const seaLevel = SEA_SHARE[shape] > 0 ? sorted[Math.floor(n * SEA_SHARE[shape])] : -Infinity;
  const land = sorted.filter((h) => h >= seaLevel);
  const cuts = BAND_SHARES.map((s) => land[Math.min(land.length - 1, Math.floor(land.length * s))]);
  const level = new Int8Array(n);
  for (let i = 0; i < n; i++) level[i] = field[i] < seaLevel ? -1 : field[i] < cuts[0] ? 0 : field[i] < cuts[1] ? 1 : field[i] < cuts[2] ? 2 : 3;
  // Tidy: a single cell standing out from all its neighbours joins them.
  for (let pass = 0; pass < 2; pass++)
    for (let cy = 0; cy < rows; cy++)
      for (let cx = 0; cx < cols; cx++) {
        const i = cy * cols + cx;
        const around: number[] = [];
        if (cx > 0) around.push(level[i - 1]);
        if (cx < cols - 1) around.push(level[i + 1]);
        if (cy > 0) around.push(level[i - cols]);
        if (cy < rows - 1) around.push(level[i + cols]);
        if (around.length && around.every((a) => a === around[0]) && around[0] !== level[i]) level[i] = around[0];
      }
  for (let i = 0; i < n; i++) {
    if (level[i] < 0) {
      sketch.areas[i] = SEA;
      sketch.heights[i] = 0;
    } else {
      if (sketch.areas[i] === SEA) sketch.areas[i] = 0;
      sketch.heights[i] = level[i];
    }
  }
}

/** A river the terrain suggests: its points (x0, y0, x1, y1… in metatiles, source first) and width. */
export interface RiverSuggestion {
  points: number[];
  width: number;
}

export interface WaterSuggestions {
  rivers: RiverSuggestion[];
  /** Hollows that would fill with water: each a list of sketch cells (indexes). */
  lakes: number[][];
  /** Why there's nothing to suggest, in plain words (empty when there are suggestions). */
  reason: string;
}

const AROUND: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/**
 * Where rivers and lakes would be, from the height bands: water runs downhill to
 * the sea, a painted lake or the edge of the sketch. Doesn't change the sketch.
 */
export function suggestWater(sketch: Sketch, seed: number): WaterSuggestions {
  const cols = sketchCols(sketch);
  const rows = sketchRows(sketch);
  const n = cols * rows;
  const level = new Int8Array(n);
  let lowest = 9;
  let highest = -9;
  let landCells = 0;
  for (let i = 0; i < n; i++) {
    level[i] = levelAt(sketch, i);
    lowest = Math.min(lowest, level[i]);
    highest = Math.max(highest, level[i]);
    if (level[i] >= 0) landCells++;
  }
  if (!landCells) return { rivers: [], lakes: [], reason: "The sketch is all sea." };
  if (lowest === highest) return { rivers: [], lakes: [], reason: "The land is all one height, so water has nowhere to run. Paint some higher ground or some sea first, or use Generate terrain." };

  // A smooth surface from the bands: within a band the ground rises away from the lower
  // ground beside it, so water runs out of each band toward the next one down. A little
  // noise makes the rivers wander.
  const noise = new ValueNoise(new Rng(deriveSeed(seed, "water")));
  const rise = new Float32Array(n).fill(-1);
  let frontier: number[] = [];
  const each = (i: number, fn: (j: number) => void, diagonal = false) => {
    const x = i % cols;
    const y = (i - x) / cols;
    for (let k = 0; k < (diagonal ? 8 : 4); k++) {
      const X = x + AROUND[k][0];
      const Y = y + AROUND[k][1];
      if (X >= 0 && Y >= 0 && X < cols && Y < rows) fn(Y * cols + X);
    }
  };
  // Where water leaves: the sea, painted lakes, and the lowest land along the edge of the
  // sketch (a river can run off the sketch there, but never out through high ground).
  let lowEdge = 9;
  const onEdge = (i: number) => {
    const x = i % cols;
    const y = (i - x) / cols;
    return x === 0 || y === 0 || x === cols - 1 || y === rows - 1;
  };
  for (let i = 0; i < n; i++) if (level[i] >= 0 && onEdge(i)) lowEdge = Math.min(lowEdge, level[i]);
  const isOutlet = (i: number) => level[i] < 0 || sketch.areas[i] === LAKE || (onEdge(i) && level[i] === lowEdge);
  for (let i = 0; i < n; i++) {
    let lower = isOutlet(i);
    each(i, (j) => {
      if (level[j] < level[i]) lower = true;
    });
    if (lower) {
      rise[i] = 0;
      frontier.push(i);
    }
  }
  for (let d = 1; frontier.length; d++) {
    const next: number[] = [];
    for (const i of frontier)
      each(i, (j) => {
        if (rise[j] < 0 && level[j] === level[i]) {
          rise[j] = d;
          next.push(j);
        }
      });
    frontier = next;
  }
  const ground = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i % cols;
    const y = (i - x) / cols;
    ground[i] = level[i] < 0 ? -100 : level[i] * 100 + Math.min(40, Math.max(0, rise[i])) * 2 + noise.fractal(x, y, 9, 3) * 5;
  }

  // Priority-Flood: from the outlets inland, lowest first. `to` is the cell each cell drains to
  // (-1 for an outlet); `filled` is the level water would stand at.
  const OUTLET = -1;
  const UNSEEN = -2;
  const to = new Int32Array(n).fill(UNSEEN);
  const filled = new Float32Array(n);
  const heap = new MinHeap();
  for (let i = 0; i < n; i++)
    if (isOutlet(i)) {
      to[i] = OUTLET;
      filled[i] = ground[i];
      heap.push(ground[i], i);
    }
  const order: number[] = [];
  while (heap.size) {
    const [, i] = heap.pop();
    order.push(i);
    each(
      i,
      (j) => {
        if (to[j] !== UNSEEN) return;
        to[j] = i;
        filled[j] = Math.max(ground[j], filled[i] + 0.01);
        heap.push(filled[j], j);
      },
      true,
    );
  }

  // Flow accumulation: highest first, each cell hands its rain on (more rain falls on high ground).
  const flow = new Float32Array(n);
  for (let k = order.length - 1; k >= 0; k--) {
    const i = order[k];
    if (level[i] < 0) continue;
    flow[i] += 1 + level[i];
    if (to[i] >= 0) flow[to[i]] += flow[i];
  }
  const feeders: number[][] = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) if (to[i] >= 0 && level[i] >= 0) feeders[to[i]].push(i);

  // River mouths: the land cells that collect the most and drain into the sea, a lake or off
  // the sketch, spaced apart. Each river is traced upstream along its biggest feeder.
  const land = (i: number) => level[i] >= 0 && sketch.areas[i] !== LAKE;
  const mouths: number[] = [];
  for (let i = 0; i < n; i++) if (land(i) && (to[i] === OUTLET || !land(to[i]))) mouths.push(i);
  mouths.sort((a, b) => flow[b] - flow[a]);
  const most = Math.max(1, Math.min(8, Math.round(landCells / 2200)));
  const least = Math.max(40, landCells * 0.012);
  const picked: number[] = [];
  const far = (a: number, b: number, d: number) => Math.abs((a % cols) - (b % cols)) + Math.abs(Math.floor(a / cols) - Math.floor(b / cols)) >= d;
  for (const m of mouths) {
    if (picked.length >= most || flow[m] < least) break;
    if (picked.every((p) => far(p, m, 10))) picked.push(m);
  }
  const used = new Uint8Array(n);
  // Cells within two of a river already suggested: a second river running alongside is left out.
  const beside = new Uint8Array(n);
  const rivers: RiverSuggestion[] = [];
  const peak = Math.max(...picked.map((m) => flow[m]), 1);
  const trace = (mouth: number, end: number): number[] => {
    // Upstream from the mouth while the stream still carries a fair share; then source first.
    const cells = [mouth];
    const stop = Math.max(8, flow[mouth] * 0.04);
    for (let c = mouth; ; ) {
      const up = feeders[c].filter((f) => !used[f]).sort((a, b) => flow[b] - flow[a])[0];
      if (up === undefined || flow[up] < stop) break;
      cells.push(up);
      c = up;
    }
    cells.reverse();
    if (end >= 0) cells.push(end);
    return cells;
  };
  const add = (cells: number[], carried: number) => {
    if (cells.length < 6 || cells.filter((c) => beside[c]).length > cells.length * 0.4) return false;
    for (const c of cells) {
      used[c] = 1;
      const x = c % cols;
      const y = (c - x) / cols;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (x + dx >= 0 && y + dy >= 0 && x + dx < cols && y + dy < rows) beside[(y + dy) * cols + x + dx] = 1;
    }
    const pts = simplify(cells.map((c) => [((c % cols) + 0.5) * SKETCH_CELL, (Math.floor(c / cols) + 0.5) * SKETCH_CELL] as [number, number]), SKETCH_CELL * 0.8);
    rivers.push({ points: pts.flatMap(([px, py]) => [Math.round(px), Math.round(py)]), width: Math.max(2, Math.min(5, 2 + Math.round(3 * Math.sqrt(carried / peak)))) });
    return true;
  };
  for (const m of picked) {
    // The last point is in the water the river runs into, so it meets the shore.
    const stem = trace(m, to[m] >= 0 ? to[m] : -1);
    if (!add(stem, flow[m])) continue;
    // One big tributary, where the stem's second feeder carries a good share of its water.
    let best = -1;
    for (const c of stem) for (const f of feeders[c]) if (!used[f] && flow[f] >= Math.max(least, flow[m] * 0.25) && (best < 0 || flow[f] > flow[best])) best = f;
    if (best >= 0 && rivers.length < 10) add(trace(best, to[best]), flow[best]);
  }

  // Lakes: hollows the flood had to fill well above the ground (more than the little dips the
  // noise makes): land shut in by higher ground, with no way out lower than its rim.
  const hollow = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (land(i) && filled[i] - ground[i] > 8) hollow[i] = 1;
  const lakes: number[][] = [];
  const seen = new Uint8Array(n);
  for (let s = 0; s < n; s++) {
    if (!hollow[s] || seen[s]) continue;
    const cells = [s];
    seen[s] = 1;
    for (let k = 0; k < cells.length; k++)
      each(cells[k], (j) => {
        if (hollow[j] && !seen[j]) {
          seen[j] = 1;
          cells.push(j);
        }
      });
    // The lake lies on the floor of the hollow: its lowest band, not the slopes round it.
    const floor = Math.min(...cells.map((c) => level[c]));
    const bed = cells.filter((c) => level[c] === floor);
    if (bed.length >= 3) lakes.push(bed.sort((a, b) => a - b));
  }
  lakes.sort((a, b) => b.length - a.length);
  const reason = rivers.length || lakes.length ? "" : "No part of the land collects enough water for a river. Try a bigger area of high ground.";
  return { rivers, lakes: lakes.slice(0, 8), reason };
}

/** Fewer points along a line, keeping its shape to within `tolerance` (Douglas–Peucker). */
function simplify(points: Array<[number, number]>, tolerance: number): Array<[number, number]> {
  if (points.length <= 2) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = points[a];
    const [bx, by] = points[b];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    let worst = -1;
    let dist = tolerance;
    for (let k = a + 1; k < b; k++) {
      const d = Math.abs((bx - ax) * (ay - points[k][1]) - (ax - points[k][0]) * (by - ay)) / len;
      if (d > dist) (dist = d, (worst = k));
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  return points.filter((_, k) => keep[k]);
}

/** Add a suggested river to the sketch as an ordinary river. */
export function acceptRiver(sketch: Sketch, r: RiverSuggestion): void {
  sketch.rivers.push({ id: `r${sketch.nextId++}`, points: [...r.points], width: r.width });
}

/** Paint a suggested lake onto the sketch. */
export function acceptLake(sketch: Sketch, cells: readonly number[]): void {
  for (const i of cells) if (i >= 0 && i < sketch.areas.length && sketch.areas[i] !== SEA) sketch.areas[i] = LAKE;
}
