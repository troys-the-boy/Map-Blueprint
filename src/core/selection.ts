// Selections: copy, move, paste, delete, fill, lock and regenerate an area of a
// map, with the things standing in it (trainers, items…).
//
// A selection is a rectangle (from the Select tool) or any shape drawn with the
// Lasso. Either way it's stored as its bounding rectangle plus, for a lasso, a
// mask saying which cells inside the rectangle are selected.
//
// Everything put down by hand is locked, so Generate keeps it. Cells left
// behind by a move, or cleared with Delete, become plain ground, unlocked, so
// Generate (or Regenerate area) can fill them in.

import type { CellRect, Entity, MapBlueprint } from "./model";
import { lineCells } from "./paint";
import { cloneThing, nextEntityId } from "./things";
import { DEFAULT_FILL_TERRAIN, ELEVATION_LEVELS, requireTerrain } from "./terrain";

/** A selected area: a rectangle, plus a mask (1 = selected, row by row) for other shapes. */
export interface Area extends CellRect {
  mask?: Uint8Array;
}

/** A copied area: its cells and the things in it (positions relative to its top-left). */
export interface Clip {
  w: number;
  h: number;
  terrain: Uint8Array;
  elevation: Uint8Array;
  /** Which cells were selected (absent = all of them). */
  mask?: Uint8Array;
  entities: Entity[];
}

/** The rectangle between two corner cells (in any order). */
export function rectFromCorners(ax: number, ay: number, bx: number, by: number): CellRect {
  const x = Math.min(ax, bx);
  const y = Math.min(ay, by);
  return { x, y, w: Math.abs(bx - ax) + 1, h: Math.abs(by - ay) + 1 };
}

export function inRect(r: CellRect, x: number, y: number): boolean {
  return x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
}

/** Is a cell part of the area (inside its rectangle and, for a shape, inside its mask)? */
export function inArea(a: Area, x: number, y: number): boolean {
  return inRect(a, x, y) && (!a.mask || a.mask[(y - a.y) * a.w + (x - a.x)] === 1);
}

/** Every cell of an area, as map indices. */
export function areaCells(map: MapBlueprint, a: Area): number[] {
  const out: number[] = [];
  for (let y = a.y; y < a.y + a.h; y++) for (let x = a.x; x < a.x + a.w; x++) if (inArea(a, x, y)) out.push(y * map.width + x);
  return out;
}

/** The cells of an area as a flat [x0, y0, x1, y1, …] list (for edit records). */
export function areaCellList(map: MapBlueprint, a: Area): number[] {
  const out: number[] = [];
  for (const i of areaCells(map, a)) out.push(i % map.width, Math.floor(i / map.width));
  return out;
}

/**
 * The part of an area inside the map, or null if none of it is. A shape keeps
 * its mask, trimmed to match; a mask with every cell selected is dropped.
 */
export function clipToMap(map: MapBlueprint, a: Area): Area | null {
  const x0 = Math.max(0, a.x);
  const y0 = Math.max(0, a.y);
  const x1 = Math.min(map.width, a.x + a.w);
  const y1 = Math.min(map.height, a.y + a.h);
  if (x1 <= x0 || y1 <= y0) return null;
  const out: Area = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  if (!a.mask) return out;
  const mask = new Uint8Array(out.w * out.h);
  let any = false;
  let all = true;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const v = inArea(a, x, y) ? 1 : 0;
      mask[(y - y0) * out.w + (x - x0)] = v;
      if (v) any = true;
      else all = false;
    }
  if (!any) return null;
  if (!all) out.mask = mask;
  return shrinkToMask(out);
}

/** Trim an area's rectangle to the cells its mask actually selects. */
function shrinkToMask(a: Area): Area {
  if (!a.mask) return a;
  let x0 = a.w;
  let y0 = a.h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < a.h; y++)
    for (let x = 0; x < a.w; x++)
      if (a.mask[y * a.w + x]) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
  if (x0 === 0 && y0 === 0 && x1 === a.w - 1 && y1 === a.h - 1) return a;
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) mask[y * w + x] = a.mask[(y + y0) * a.w + (x + x0)];
  return { x: a.x + x0, y: a.y + y0, w, h, mask };
}

/**
 * The area inside a lasso: the cells along the drawn line, plus every cell whose
 * centre falls inside the closed shape. Points are cell coordinates (fractions
 * allowed); the line is closed back to its start.
 */
export function lassoArea(map: MapBlueprint, points: Array<[number, number]>): Area | null {
  if (!points.length) return null;
  const xs = points.map((p) => Math.floor(p[0]));
  const ys = points.map((p) => Math.floor(p[1]));
  const box = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs) + 1, h: Math.max(...ys) - Math.min(...ys) + 1 };
  const mask = new Uint8Array(box.w * box.h);
  // Cells under the line itself.
  for (let k = 0; k < points.length; k++) {
    const [ax, ay] = points[k];
    const [bx, by] = points[(k + 1) % points.length];
    for (const [cx, cy] of lineCells(Math.floor(ax), Math.floor(ay), Math.floor(bx), Math.floor(by))) mask[(cy - box.y) * box.w + (cx - box.x)] = 1;
  }
  // Cells whose centre is inside the shape (even-odd rule).
  for (let y = 0; y < box.h; y++)
    for (let x = 0; x < box.w; x++) {
      const px = box.x + x + 0.5;
      const py = box.y + y + 0.5;
      let inside = false;
      for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const [xi, yi] = points[i];
        const [xj, yj] = points[j];
        if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
      }
      if (inside) mask[y * box.w + x] = 1;
    }
  return clipToMap(map, { ...box, mask });
}

/** Copy an area (cells and things). */
export function copyArea(map: MapBlueprint, a: Area): Clip {
  const terrain = new Uint8Array(a.w * a.h);
  const elevation = new Uint8Array(a.w * a.h);
  for (let y = 0; y < a.h; y++)
    for (let x = 0; x < a.w; x++) {
      const i = (a.y + y) * map.width + a.x + x;
      terrain[y * a.w + x] = map.layers.terrain.data[i];
      elevation[y * a.w + x] = map.layers.elevation.data[i];
    }
  const entities = map.entities.filter((e) => inArea(a, e.x, e.y)).map((e) => ({ ...cloneThing(e), x: e.x - a.x, y: e.y - a.y }));
  return { w: a.w, h: a.h, terrain, elevation, mask: a.mask?.slice(), entities };
}

/** Clear an area to plain ground (unlocked) and remove the things in it. */
export function clearArea(map: MapBlueprint, a: Area): void {
  const ground = requireTerrain(DEFAULT_FILL_TERRAIN);
  const level = ELEVATION_LEVELS.indexOf("ground");
  for (const i of areaCells(map, a)) {
    map.layers.terrain.data[i] = ground;
    map.layers.elevation.data[i] = level;
    map.layers.locks.data[i] = 0;
  }
  map.entities = map.entities.filter((e) => !inArea(a, e.x, e.y));
}

/**
 * Put a clip down with its top-left at (x, y). Parts that fall off the map are
 * dropped, and cells outside a lasso's shape are left alone. The cells are
 * locked; whatever stood there is replaced. With `newIds`, pasted things get
 * fresh IDs (a copy); otherwise they keep theirs (a move). Returns the area
 * covered on the map, or null if the clip missed the map entirely.
 */
export function pasteClip(map: MapBlueprint, clip: Clip, x: number, y: number, newIds: boolean): Area | null {
  const area = clipToMap(map, { x, y, w: clip.w, h: clip.h, mask: clip.mask });
  if (!area) return null;
  for (let cy = area.y; cy < area.y + area.h; cy++)
    for (let cx = area.x; cx < area.x + area.w; cx++) {
      if (!inArea(area, cx, cy)) continue;
      const k = (cy - y) * clip.w + (cx - x);
      const i = cy * map.width + cx;
      map.layers.terrain.data[i] = clip.terrain[k];
      map.layers.elevation.data[i] = clip.elevation[k];
      map.layers.locks.data[i] = 1;
    }
  map.entities = map.entities.filter((e) => !inArea(area, e.x, e.y));
  for (const src of clip.entities) {
    const ex = src.x + x;
    const ey = src.y + y;
    if (!inArea(area, ex, ey)) continue;
    const e: Entity = { ...cloneThing(src), x: ex, y: ey, locked: true, elevation: ELEVATION_LEVELS[map.layers.elevation.data[ey * map.width + ex]] };
    if (newIds) e.id = nextEntityId(map, e.kind);
    map.entities.push(e);
  }
  return area;
}

/** Move an area so its top-left lands at (toX, toY). Returns the area it now covers. */
export function moveArea(map: MapBlueprint, a: Area, toX: number, toY: number): Area | null {
  const clip = copyArea(map, a);
  clearArea(map, a);
  return pasteClip(map, clip, toX, toY, false);
}
