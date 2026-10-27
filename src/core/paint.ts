// Painting cells: the pure logic behind the pencil and eraser.
//
// The UI turns pointer movement into cell coordinates; this module changes the
// map and returns a "diff" (what each cell was before and after) so the change
// can be undone, and so the same stroke can be replayed later as an Edit.

import type { Edit, MapBlueprint } from "./model";
import { ELEVATION_LEVELS, requireTerrain } from "./terrain";

/** Cells touched by a straight line from (x0, y0) to (x1, y1), with no gaps (Bresenham). */
export function lineCells(x0: number, y0: number, x1: number, y1: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    out.push([x, y]);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
  return out;
}

/** The cells covered by a square brush of the given width centred on (x, y). */
export function brushCells(x: number, y: number, brush: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const start = -Math.floor((brush - 1) / 2);
  for (let dy = 0; dy < brush; dy++) for (let dx = 0; dx < brush; dx++) out.push([x + start + dx, y + start + dy]);
  return out;
}

/** Before/after values for every cell a stroke changed, for undo and redo. */
export interface CellDiff {
  /** Cell indices (y * width + x). */
  index: number[];
  terrainBefore: number[];
  terrainAfter: number[];
  lockBefore: number[];
  lockAfter: number[];
  elevationBefore: number[];
  elevationAfter: number[];
}

export function emptyDiff(): CellDiff {
  return { index: [], terrainBefore: [], terrainAfter: [], lockBefore: [], lockAfter: [], elevationBefore: [], elevationAfter: [] };
}

/**
 * Set one cell's terrain, elevation and lock. Returns true if anything changed.
 * `seen` (cell index → position in the diff) stops a stroke from recording the
 * same cell twice, so the diff's "before" is the value from before the stroke started.
 */
function setCell(
  map: MapBlueprint,
  x: number,
  y: number,
  terrain: number | null,
  elevation: number | null,
  lock: 0 | 1 | null,
  diff: CellDiff,
  seen: Map<number, number>,
): boolean {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return false;
  const i = y * map.width + x;
  const t = map.layers.terrain.data;
  const e = map.layers.elevation.data;
  const l = map.layers.locks.data;
  const nt = terrain ?? t[i];
  const ne = elevation ?? e[i];
  const nl = lock ?? l[i];
  if (t[i] === nt && e[i] === ne && l[i] === nl) return false;
  const k = seen.get(i);
  if (k === undefined) {
    seen.set(i, diff.index.length);
    diff.index.push(i);
    diff.terrainBefore.push(t[i]);
    diff.elevationBefore.push(e[i]);
    diff.lockBefore.push(l[i]);
    diff.terrainAfter.push(nt);
    diff.elevationAfter.push(ne);
    diff.lockAfter.push(nl);
  } else {
    diff.terrainAfter[k] = nt;
    diff.elevationAfter[k] = ne;
    diff.lockAfter[k] = nl;
  }
  t[i] = nt;
  e[i] = ne;
  l[i] = nl;
  return true;
}

/** Paint one cell's terrain (pencil and eraser). Returns true if anything changed. */
export function paintCell(map: MapBlueprint, x: number, y: number, terrain: number, lock: 0 | 1, diff: CellDiff, seen: Map<number, number>): boolean {
  return setCell(map, x, y, terrain, null, lock, diff, seen);
}

/** Paint one cell's elevation level (elevation brush), keeping its terrain. */
export function paintElevation(map: MapBlueprint, x: number, y: number, level: number, lock: 0 | 1, diff: CellDiff, seen: Map<number, number>): boolean {
  return setCell(map, x, y, null, level, lock, diff, seen);
}

/** Lock or unlock one cell (lock brush), keeping its terrain and elevation. */
export function paintLock(map: MapBlueprint, x: number, y: number, lock: 0 | 1, diff: CellDiff, seen: Map<number, number>): boolean {
  return setCell(map, x, y, null, null, lock, diff, seen);
}

/**
 * Re-apply a recorded stroke (pencil, eraser, elevation brush or lock brush) to a map.
 * Selection and Things-tool edits are records only (their result is in the layers), so
 * they change nothing here.
 */
export function replayStroke(map: MapBlueprint, edit: Edit): CellDiff {
  const diff = emptyDiff();
  if (edit.type === "area" || edit.type === "entity" || edit.type === "smart") return diff;
  const lock = edit.locked ? 1 : 0;
  const seen = new Map<number, number>();
  if (edit.type === "lock") {
    for (let k = 0; k < edit.cells.length; k += 2) paintLock(map, edit.cells[k], edit.cells[k + 1], lock, diff, seen);
    return diff;
  }
  if (edit.type === "elevation") {
    const level = ELEVATION_LEVELS.indexOf(edit.level);
    for (let k = 0; k < edit.cells.length; k += 2) paintElevation(map, edit.cells[k], edit.cells[k + 1], level, lock, diff, seen);
    return diff;
  }
  const terrain = requireTerrain(edit.terrain);
  for (let k = 0; k < edit.cells.length; k += 2) paintCell(map, edit.cells[k], edit.cells[k + 1], terrain, lock, diff, seen);
  return diff;
}


/** Apply the "before" (undo) or "after" (redo) side of a diff. */
export function applyDiff(map: MapBlueprint, diff: CellDiff, side: "before" | "after"): void {
  const t = map.layers.terrain.data;
  const e = map.layers.elevation.data;
  const l = map.layers.locks.data;
  const ev = side === "before" ? diff.elevationBefore : diff.elevationAfter;
  const tv = side === "before" ? diff.terrainBefore : diff.terrainAfter;
  const lv = side === "before" ? diff.lockBefore : diff.lockAfter;
  for (let k = 0; k < diff.index.length; k++) {
    t[diff.index[k]] = tv[k];
    e[diff.index[k]] = ev[k];
    l[diff.index[k]] = lv[k];
  }
}

/** Set one cell's terrain and elevation level together (smart strokes). Returns true if anything changed. */
export function paintCellLevel(map: MapBlueprint, x: number, y: number, terrain: number, level: number, lock: 0 | 1, diff: CellDiff, seen: Map<number, number>): boolean {
  return setCell(map, x, y, terrain, level, lock, diff, seen);
}
