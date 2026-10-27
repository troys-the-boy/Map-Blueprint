// Smart strokes: draw a line or an area and the tool makes it valid.
//
//   • Path: widened to at least the narrowest-path setting; where it crosses
//     water it becomes a bridge.
//   • Stream: 2 cells of deep water (or wider), with a bank of open ground on
//     both sides where it runs through trees or rock; where it crosses a path
//     it becomes a bridge.
//   • Tree wall: at least 2 cells thick.
//   • Grass patch: a freehand area of tall grass (paths and water stay).
//   • Water body: a freehand area of deep water, with its shoreline tidied (no
//     one-cell spikes or notches); paths across it become bridges.
//   • Ledge: a line of ledges. The jump direction comes from the line (across a
//     mostly level line: south; down a mostly upright line: east) unless set.
//
// Everything a stroke changes is locked, so Generate keeps it. Elevation follows
// the terrain: water on low ground is Porymap's water level (1), bridges are 15.

import { IS_WALL, IS_WATER, T } from "./grid";
import type { MapBlueprint, SmartEdit } from "./model";
import type { CellDiff } from "./paint";
import { brushCells, lineCells, paintCellLevel } from "./paint";
import { areaCells, lassoArea } from "./selection";
import { ELEVATION_LEVELS } from "./terrain";

export const SMART_KINDS = ["path", "stream", "tree_wall", "grass", "water", "ledge"] as const;
export type SmartKind = (typeof SMART_KINDS)[number];

/** Kinds drawn as an outline that's filled in, rather than as a line. */
export const AREA_KINDS: ReadonlySet<SmartKind> = new Set(["grass", "water"]);

export const SMART_LABELS: Record<SmartKind, string> = {
  path: "Path",
  stream: "Stream",
  tree_wall: "Tree wall",
  grass: "Grass patch",
  water: "Water body",
  ledge: "Ledge",
};

/** The terrain each stroke mostly paints (for its swatch). */
export const SMART_TERRAIN: Record<SmartKind, number> = {
  path: T.path,
  stream: T.waterDeep,
  tree_wall: T.tree,
  grass: T.tallGrass,
  water: T.waterDeep,
  ledge: T.ledgeS,
};

/** Narrowest each line stroke may be, in cells. */
const MIN_WIDTH: Record<SmartKind, number> = { path: 1, stream: 2, tree_wall: 2, grass: 1, water: 1, ledge: 1 };

const LEVEL = {
  water: ELEVATION_LEVELS.indexOf("water"),
  ground: ELEVATION_LEVELS.indexOf("ground"),
  bridge: ELEVATION_LEVELS.indexOf("bridge"),
};
const PATH_LIKE = new Set<number>([T.path, T.road, T.bridge]);

/** How wide a line stroke is drawn: the brush size, but never under the stroke's minimum. */
export function strokeWidth(kind: SmartKind, brush: number, pathWidthMin: number): number {
  if (kind === "ledge") return 1;
  return Math.max(brush, MIN_WIDTH[kind], kind === "path" ? pathWidthMin : 0);
}

/** The jump direction for a ledge line: as set, or worked out from the way the line runs. */
export function ledgeDirection(points: number[], set: "s" | "e" | "w" | null): "s" | "e" | "w" {
  if (set) return set;
  const dx = Math.abs(points[points.length - 2] - points[0]);
  const dy = Math.abs(points[points.length - 1] - points[1]);
  return dx >= dy ? "s" : "e";
}

/** Every cell the drawn line passes through, in order, without repeats. */
function lineOf(points: number[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const seen = new Set<string>();
  const add = (x: number, y: number) => {
    const k = `${x},${y}`;
    if (!seen.has(k)) {
      seen.add(k);
      out.push([x, y]);
    }
  };
  if (points.length === 2) add(points[0], points[1]);
  for (let k = 0; k + 3 < points.length; k += 2) for (const [x, y] of lineCells(points[k], points[k + 1], points[k + 2], points[k + 3])) add(x, y);
  return out;
}

/** The line, widened with a square brush (the same footprint as the pencil). */
function widened(map: MapBlueprint, points: number[], width: number): number[] {
  const set = new Set<number>();
  for (const [x, y] of lineOf(points))
    for (const [bx, by] of brushCells(x, y, width)) if (bx >= 0 && by >= 0 && bx < map.width && by < map.height) set.add(by * map.width + bx);
  return [...set];
}

/** The cells inside a drawn outline (for grass and water areas). */
function filled(map: MapBlueprint, points: number[]): number[] {
  const pts: Array<[number, number]> = [];
  for (let k = 0; k + 1 < points.length; k += 2) pts.push([points[k] + 0.5, points[k + 1] + 0.5]);
  const area = lassoArea(map, pts);
  return area ? areaCells(map, area) : [];
}

/**
 * Apply a smart stroke to a map, recording every change in `diff` (for undo).
 * `points` are the cells the pointer went through: [x0, y0, x1, y1, …].
 */
export function applySmartStroke(map: MapBlueprint, edit: SmartEdit, diff: CellDiff, seen: Map<number, number>): void {
  const t = map.layers.terrain.data;
  const e = map.layers.elevation.data;
  const set = (i: number, terrain: number, level: number) => paintCellLevel(map, i % map.width, Math.floor(i / map.width), terrain, level, 1, diff, seen);
  // Land keeps its level (it may be a plateau); land that was water goes back to ground.
  const landLevel = (i: number) => (e[i] === LEVEL.water || e[i] === LEVEL.bridge ? LEVEL.ground : e[i]);
  const width = Math.max(1, edit.width);
  const isWaterNow = (i: number) => IS_WATER[t[i]];

  switch (edit.kind) {
    case "path":
      for (const i of widened(map, edit.points, width)) {
        if (isWaterNow(i)) set(i, T.bridge, LEVEL.bridge);
        else set(i, T.path, landLevel(i));
      }
      return;

    case "stream": {
      const cells = widened(map, edit.points, width);
      const inStream = new Set(cells);
      for (const i of cells) {
        if (PATH_LIKE.has(t[i])) set(i, T.bridge, LEVEL.bridge);
        else set(i, T.waterDeep, LEVEL.water);
      }
      // Banks: trees or rock right beside the water open up into ground.
      for (const i of cells) {
        const x = i % map.width;
        const y = (i - x) / map.width;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
          const j = ny * map.width + nx;
          if (!inStream.has(j) && IS_WALL[t[j]]) set(j, T.ground, landLevel(j));
        }
      }
      return;
    }

    case "tree_wall":
      for (const i of widened(map, edit.points, width)) set(i, T.tree, landLevel(i));
      return;

    case "grass":
      for (const i of filled(map, edit.points)) {
        if (IS_WATER[t[i]] || PATH_LIKE.has(t[i]) || t[i] === T.stairs || t[i] === T.ledgeS || t[i] === T.ledgeE || t[i] === T.ledgeW) continue;
        set(i, T.tallGrass, landLevel(i));
      }
      return;

    case "water": {
      const cells = filled(map, edit.points);
      const inside = new Set(cells);
      const n4 = (i: number) => {
        const x = i % map.width;
        const y = (i - x) / map.width;
        return [[1, 0], [-1, 0], [0, 1], [0, -1]]
          .map(([dx, dy]) => [x + dx, y + dy])
          .filter(([nx, ny]) => nx >= 0 && ny >= 0 && nx < map.width && ny < map.height)
          .map(([nx, ny]) => ny * map.width + nx);
      };
      // Tidy the shoreline: drop one-cell spikes, fill one-cell notches.
      for (const i of cells) if (n4(i).filter((j) => inside.has(j)).length <= 1 && cells.length > 2) inside.delete(i);
      for (const i of cells)
        for (const j of n4(i)) if (!inside.has(j) && n4(j).filter((k) => inside.has(k)).length >= 3) inside.add(j);
      for (const i of inside) {
        if (PATH_LIKE.has(t[i])) set(i, T.bridge, LEVEL.bridge);
        else set(i, T.waterDeep, LEVEL.water);
      }
      return;
    }

    case "ledge": {
      const dir = ledgeDirection(edit.points, edit.direction);
      const ledge = dir === "s" ? T.ledgeS : dir === "e" ? T.ledgeE : T.ledgeW;
      for (const [x, y] of lineOf(edit.points)) if (x >= 0 && y >= 0 && x < map.width && y < map.height) set(y * map.width + x, ledge, landLevel(y * map.width + x));
      return;
    }
  }
}
