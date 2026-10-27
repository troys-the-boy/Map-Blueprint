// Rectangle selections: copy, move, paste and delete an area of a map, with the
// things standing in it (trainers, items…).
//
// Everything put down by hand is locked, so Generate keeps it. Cells left
// behind by a move, or cleared with Delete, become plain ground, unlocked, so
// Generate (or Regenerate area) can fill them in.

import type { CellRect, Entity, MapBlueprint } from "./model";
import { cloneThing, nextEntityId } from "./things";
import { DEFAULT_FILL_TERRAIN, ELEVATION_LEVELS, requireTerrain } from "./terrain";

/** A copied area: its cells and the things in it (positions relative to its top-left). */
export interface Clip {
  w: number;
  h: number;
  terrain: Uint8Array;
  elevation: Uint8Array;
  entities: Entity[];
}

/** The rectangle between two corner cells (in any order). */
export function rectFromCorners(ax: number, ay: number, bx: number, by: number): CellRect {
  const x = Math.min(ax, bx);
  const y = Math.min(ay, by);
  return { x, y, w: Math.abs(bx - ax) + 1, h: Math.abs(by - ay) + 1 };
}

/** The part of a rectangle inside the map, or null if none of it is. */
export function clipToMap(map: MapBlueprint, r: CellRect): CellRect | null {
  const x0 = Math.max(0, r.x);
  const y0 = Math.max(0, r.y);
  const x1 = Math.min(map.width, r.x + r.w);
  const y1 = Math.min(map.height, r.y + r.h);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

export function inRect(r: CellRect, x: number, y: number): boolean {
  return x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
}

/** Copy an area (cells and things). */
export function copyArea(map: MapBlueprint, r: CellRect): Clip {
  const terrain = new Uint8Array(r.w * r.h);
  const elevation = new Uint8Array(r.w * r.h);
  for (let y = 0; y < r.h; y++)
    for (let x = 0; x < r.w; x++) {
      const i = (r.y + y) * map.width + r.x + x;
      terrain[y * r.w + x] = map.layers.terrain.data[i];
      elevation[y * r.w + x] = map.layers.elevation.data[i];
    }
  const entities = map.entities.filter((e) => inRect(r, e.x, e.y)).map((e) => ({ ...cloneThing(e), x: e.x - r.x, y: e.y - r.y }));
  return { w: r.w, h: r.h, terrain, elevation, entities };
}

/** Clear an area to plain ground (unlocked) and remove the things in it. */
export function clearArea(map: MapBlueprint, r: CellRect): void {
  const ground = requireTerrain(DEFAULT_FILL_TERRAIN);
  const level = ELEVATION_LEVELS.indexOf("ground");
  for (let y = r.y; y < r.y + r.h; y++)
    for (let x = r.x; x < r.x + r.w; x++) {
      const i = y * map.width + x;
      map.layers.terrain.data[i] = ground;
      map.layers.elevation.data[i] = level;
      map.layers.locks.data[i] = 0;
    }
  map.entities = map.entities.filter((e) => !inRect(r, e.x, e.y));
}

/**
 * Put a clip down with its top-left at (x, y). Parts that fall off the map are
 * dropped. The cells are locked; whatever stood in the area is replaced. With
 * `newIds`, pasted things get fresh IDs (a copy); otherwise they keep theirs (a move).
 * Returns the area covered on the map, or null if the clip missed the map entirely.
 */
export function pasteClip(map: MapBlueprint, clip: Clip, x: number, y: number, newIds: boolean): CellRect | null {
  const area = clipToMap(map, { x, y, w: clip.w, h: clip.h });
  if (!area) return null;
  for (let cy = area.y; cy < area.y + area.h; cy++)
    for (let cx = area.x; cx < area.x + area.w; cx++) {
      const k = (cy - y) * clip.w + (cx - x);
      const i = cy * map.width + cx;
      map.layers.terrain.data[i] = clip.terrain[k];
      map.layers.elevation.data[i] = clip.elevation[k];
      map.layers.locks.data[i] = 1;
    }
  map.entities = map.entities.filter((e) => !inRect(area, e.x, e.y));
  for (const src of clip.entities) {
    const ex = src.x + x;
    const ey = src.y + y;
    if (!inRect(area, ex, ey)) continue;
    const e: Entity = { ...cloneThing(src), x: ex, y: ey, locked: true, elevation: ELEVATION_LEVELS[map.layers.elevation.data[ey * map.width + ex]] };
    if (newIds) e.id = nextEntityId(map, e.kind);
    map.entities.push(e);
  }
  return area;
}

/** Move an area so its top-left lands at (toX, toY). Returns the area it now covers. */
export function moveArea(map: MapBlueprint, r: CellRect, toX: number, toY: number): CellRect | null {
  const clip = copyArea(map, r);
  clearArea(map, r);
  return pasteClip(map, clip, toX, toY, false);
}
