// Resizing a map after it was made. The anchor says which side stays put: with
// the anchor top-left, cells are added or cut on the right and bottom; with it
// in the middle, equally on every side.
//
// New cells are plain ground, unlocked, so Generate fills them in. Everything
// on the map moves with its cells: things, warps, locks, zones, entrances and
// the recorded edits. Whatever ends up outside the new size is cut off, and
// resizePreview() lists it first so the user can be warned.

import type { Edit, Edge, Grid, MapBlueprint, Opening } from "./model";
import { makeGrid } from "./model";
import { DEFAULT_FILL_TERRAIN, ELEVATION_LEVELS, requireTerrain } from "./terrain";
import { THING_LABELS } from "./things";

/** 0 = left/top, 1 = middle, 2 = right/bottom. */
export type AnchorPart = 0 | 1 | 2;
export interface Anchor {
  x: AnchorPart;
  y: AnchorPart;
}

/** How far the old map's cells move in the new one. */
export function resizeShift(map: { width: number; height: number }, width: number, height: number, anchor: Anchor): { dx: number; dy: number } {
  return { dx: Math.trunc(((width - map.width) * anchor.x) / 2), dy: Math.trunc(((height - map.height) * anchor.y) / 2) };
}

/** What a resize would cut off. Empty lists and zero counts mean nothing is lost. */
export interface ResizeLoss {
  /** Cells of the old map that fall outside. */
  cells: number;
  /** Of those, cells you locked (painted, pasted or locked by hand). */
  lockedCells: number;
  /** Things that would be removed, e.g. "Trainer t3 (12, 40)". */
  things: string[];
  warps: string[];
  /** Zones that would vanish entirely, and zones that would lose part of their area. */
  zonesRemoved: string[];
  zonesTrimmed: string[];
  /** Entrances that would vanish, and entrances that would get narrower. */
  openingsRemoved: string[];
  openingsTrimmed: string[];
}

export function hasLoss(loss: ResizeLoss): boolean {
  return loss.cells > 0 || loss.things.length + loss.warps.length + loss.zonesRemoved.length + loss.zonesTrimmed.length + loss.openingsRemoved.length + loss.openingsTrimmed.length > 0;
}

const EDGE_LABEL: Record<Edge, string> = { north: "North", south: "South", east: "East", west: "West" };

function openingLabel(o: Opening) {
  return `${EDGE_LABEL[o.edge]} entrance at ${o.start}–${o.start + o.width - 1}`;
}

/** An entrance moved along its edge into the new size: the part that's left, or null if none is. */
function shiftOpening(o: Opening, dx: number, dy: number, width: number, height: number): Opening | null {
  const along = o.edge === "north" || o.edge === "south";
  const start = o.start + (along ? dx : dy);
  const length = along ? width : height;
  const a = Math.max(0, start);
  const b = Math.min(length, start + o.width);
  return b > a ? { ...o, start: a, width: b - a } : null;
}

export function resizePreview(map: MapBlueprint, width: number, height: number, anchor: Anchor): ResizeLoss {
  const { dx, dy } = resizeShift(map, width, height, anchor);
  const inside = (x: number, y: number) => x + dx >= 0 && y + dy >= 0 && x + dx < width && y + dy < height;
  const loss: ResizeLoss = { cells: 0, lockedCells: 0, things: [], warps: [], zonesRemoved: [], zonesTrimmed: [], openingsRemoved: [], openingsTrimmed: [] };
  for (let y = 0; y < map.height; y++)
    for (let x = 0; x < map.width; x++)
      if (!inside(x, y)) {
        loss.cells++;
        if (map.layers.locks.data[y * map.width + x]) loss.lockedCells++;
      }
  for (const e of map.entities) if (!inside(e.x, e.y)) loss.things.push(`${THING_LABELS[e.kind] ?? e.kind} ${e.id} (${e.x}, ${e.y})`);
  for (const w of map.warps) if (!inside(w.x, w.y)) loss.warps.push(`${w.kind} warp (${w.x}, ${w.y})`);
  for (const z of map.layers.zones) {
    let kept = 0;
    let cut = 0;
    for (let i = 0; i < z.mask.data.length; i++) {
      if (!z.mask.data[i]) continue;
      if (inside(i % map.width, Math.floor(i / map.width))) kept++;
      else cut++;
    }
    if (cut && !kept) loss.zonesRemoved.push(z.name);
    else if (cut) loss.zonesTrimmed.push(z.name);
  }
  for (const o of map.openings) {
    const moved = shiftOpening(o, dx, dy, width, height);
    if (!moved) loss.openingsRemoved.push(openingLabel(o));
    else if (moved.width < o.width) loss.openingsTrimmed.push(openingLabel(o));
  }
  return loss;
}

function moveGrid(grid: Grid, width: number, height: number, dx: number, dy: number, fill: number): Grid {
  const out = makeGrid(width, height, fill);
  for (let y = 0; y < grid.height; y++) {
    const ny = y + dy;
    if (ny < 0 || ny >= height) continue;
    for (let x = 0; x < grid.width; x++) {
      const nx = x + dx;
      if (nx >= 0 && nx < width) out.data[ny * width + nx] = grid.data[y * grid.width + x];
    }
  }
  return out;
}

/** Move a flat [x0, y0, x1, y1, …] list, dropping points that end up outside. */
function movePoints(points: number[], dx: number, dy: number, width: number, height: number): number[] {
  const out: number[] = [];
  for (let k = 0; k + 1 < points.length; k += 2) {
    const x = points[k] + dx;
    const y = points[k + 1] + dy;
    if (x >= 0 && y >= 0 && x < width && y < height) out.push(x, y);
  }
  return out;
}

/** An edit record moved with the map, or null if nothing of it is left inside. */
function moveEdit(e: Edit, dx: number, dy: number, width: number, height: number): Edit | null {
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height;
  switch (e.type) {
    case "stroke":
    case "elevation":
    case "lock": {
      const cells = movePoints(e.cells, dx, dy, width, height);
      return cells.length ? { ...e, cells } : null;
    }
    case "smart": {
      const points = movePoints(e.points, dx, dy, width, height);
      return points.length ? { ...e, points } : null;
    }
    case "entity":
      return inside(e.x + dx, e.y + dy) ? { ...e, x: e.x + dx, y: e.y + dy } : null;
    case "area": {
      const x0 = Math.max(0, e.area.x + dx);
      const y0 = Math.max(0, e.area.y + dy);
      const x1 = Math.min(width, e.area.x + dx + e.area.w);
      const y1 = Math.min(height, e.area.y + dy + e.area.h);
      if (x1 <= x0 || y1 <= y0) return null;
      const moved = { ...e, area: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } };
      if (e.toX !== null) {
        const tx = e.toX + dx;
        const ty = (e.toY ?? 0) + dy;
        if (!inside(tx, ty)) return null;
        moved.toX = tx;
        moved.toY = ty;
      }
      if (e.cells) {
        // Keep only the lasso cells inside the clipped rectangle.
        const cells = movePoints(e.cells, dx, dy, width, height);
        const kept: number[] = [];
        for (let k = 0; k < cells.length; k += 2)
          if (cells[k] >= x0 && cells[k] < x1 && cells[k + 1] >= y0 && cells[k + 1] < y1) kept.push(cells[k], cells[k + 1]);
        if (!kept.length) return null;
        moved.cells = kept;
      }
      return moved;
    }
  }
}

/**
 * Resize the map in place. Cells, things and everything else move with the
 * anchor; anything outside the new size is removed (see resizePreview).
 * Connection offsets change by the same shift, so neighbours stay lined up.
 */
export function resizeMap(map: MapBlueprint, width: number, height: number, anchor: Anchor): void {
  const { dx, dy } = resizeShift(map, width, height, anchor);
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height;
  const ground = requireTerrain(DEFAULT_FILL_TERRAIN);
  const level = ELEVATION_LEVELS.indexOf("ground");
  map.layers.terrain = moveGrid(map.layers.terrain, width, height, dx, dy, ground);
  map.layers.elevation = moveGrid(map.layers.elevation, width, height, dx, dy, level);
  map.layers.locks = moveGrid(map.layers.locks, width, height, dx, dy, 0);
  map.layers.zones = map.layers.zones
    .map((z) => ({ ...z, mask: moveGrid(z.mask, width, height, dx, dy, 0) }))
    .filter((z) => z.mask.data.some((v) => v === 1));
  map.entities = map.entities.map((e) => ({ ...e, x: e.x + dx, y: e.y + dy })).filter((e) => inside(e.x, e.y));
  map.warps = map.warps.map((w) => ({ ...w, x: w.x + dx, y: w.y + dy })).filter((w) => inside(w.x, w.y));
  map.openings = map.openings.map((o) => shiftOpening(o, dx, dy, width, height)).filter((o): o is Opening => o !== null);
  // Porymap's offset is the neighbour's position along the shared edge, measured
  // from this map's top-left corner, so it moves with this map's cells.
  map.connections = map.connections.map((c) =>
    c.direction === "up" || c.direction === "down" ? { ...c, offset: c.offset + dx } : c.direction === "left" || c.direction === "right" ? { ...c, offset: c.offset + dy } : c,
  );
  map.edits = map.edits.map((e) => moveEdit(e, dx, dy, width, height)).filter((e): e is Edit => e !== null);
  map.width = width;
  map.height = height;
}
