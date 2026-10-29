// The region sketch (Milestone 6): a rough plan of the whole region, drawn on a
// coarse grid, from which the maps are built later (part E).
//
//   • Outdoor places are rectangles: a town is one rectangle; a route is a chain
//     of rectangles, one per straight stretch, each touching the one before (a
//     bend is where two meet). A stretch longer than the target segment length
//     is split into segments, at seams the sketch shows.
//   • Inside places (forests, caves) are reached by warps, so their inside takes
//     no room on the outdoor sketch. They are pins on the routes or towns where
//     their entrances are, and their own size is a setting.
//   • Painted areas, one per sketch cell: biomes, lakes and sea. The coastline is
//     the edge of the sea.
//   • Rivers are lines with a width.
//   • An underlay (a PDF page or an image) can sit under it all, to trace over.
//
// Everything is in metatiles, so sizes read the same as on the maps. Rectangles
// and pins snap to the sketch grid of SKETCH_CELL metatiles.

import type { Biome, EngineLimits } from "./model";
import { BIOMES, DEFAULT_ENGINE_LIMITS } from "./model";
import { checkMapSize } from "./sizeRule";
import type { RegionMapPlan } from "./regionMap";
import type { Journey } from "./journey";

/** Metatiles per sketch cell. */
export const SKETCH_CELL = 5;

/** What a sketch cell can be painted as: a biome, a lake, or sea. */
export const SKETCH_AREAS = [...BIOMES, "lake", "sea"] as const;
export type SketchArea = (typeof SKETCH_AREAS)[number];

export const PLACE_KINDS = ["town", "route", "forest", "cave"] as const;
export type SketchPlaceKind = (typeof PLACE_KINDS)[number];

/** Towns and routes are drawn as rectangles; forests and caves are pins inside them. */
export function isOutdoor(kind: SketchPlaceKind): boolean {
  return kind === "town" || kind === "route";
}

export interface SketchRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SketchPin {
  x: number;
  y: number;
}

export interface SketchPlace {
  id: string;
  kind: SketchPlaceKind;
  name: string;
  /** Towns: one rectangle. Routes: a chain of them. Forests and caves: none. */
  rects: SketchRect[];
  /** Forests and caves: where their entrances are, on routes or towns. */
  pins: SketchPin[];
  /** Forests and caves: the size of the map (metatiles). Null for towns and routes. */
  size: { w: number; h: number } | null;
  /** Forests and caves: their own region map section, instead of sharing their route's or town's. */
  ownSection: boolean;
  /** The maps made from this place (filled in when the region is built). */
  mapIds: string[];
}

export interface SketchRiver {
  id: string;
  /** x0, y0, x1, y1, … in metatiles. */
  points: number[];
  /** Metatiles across. */
  width: number;
}

export interface SketchUnderlay {
  kind: "pdf" | "image";
  /** The file's name, for showing. */
  name: string;
  /** The file itself, as a data: URL, so it is saved with the project. */
  data: string;
  /** Which page of a PDF (1 = first). */
  page: number;
  /** Where the drawing's top-left corner sits, in metatiles. */
  x: number;
  y: number;
  /** Metatiles per unit of the drawing (an image pixel, or a PDF point of 1/72 inch). */
  scale: number;
  /** Turned clockwise, in degrees, about its top-left corner. */
  rotation: number;
  opacity: number;
  visible: boolean;
  /** Locked: can't be moved by accident. */
  locked: boolean;
}

export interface Sketch {
  /** The sketch's size in metatiles (a multiple of SKETCH_CELL). */
  width: number;
  height: number;
  /** Painted areas, one value per sketch cell: 0 = nothing, else 1 + the index in SKETCH_AREAS. */
  areas: Uint8Array;
  places: SketchPlace[];
  rivers: SketchRiver[];
  underlay: SketchUnderlay | null;
  /** The in-game region map's grid size and sections placed by hand (see regionMap.ts). */
  regionMap: RegionMapPlan;
  /** The order the player visits the places, and where progression steps start (see journey.ts). */
  journey: Journey;
  /** Counter for new ids ("p1", "r1"…). */
  nextId: number;
}

export const DEFAULT_SKETCH_SIZE = { width: 600, height: 400 };
export const MAX_SKETCH_SIDE = 4000;

export function newSketch(width = DEFAULT_SKETCH_SIZE.width, height = DEFAULT_SKETCH_SIZE.height): Sketch {
  return {
    width,
    height,
    areas: new Uint8Array((width / SKETCH_CELL) * (height / SKETCH_CELL)),
    places: [],
    rivers: [],
    underlay: null,
    // Vanilla Emerald's grid: MAP_WIDTH × MAP_HEIGHT in src/region_map.c (see regionMap.ts).
    regionMap: { width: 28, height: 15, overrides: {} },
    journey: { stops: [], stepStarts: {} },
    nextId: 1,
  };
}

export function sketchCols(s: Sketch): number {
  return s.width / SKETCH_CELL;
}
export function sketchRows(s: Sketch): number {
  return s.height / SKETCH_CELL;
}

/** Round to the nearest sketch grid line. */
export function snap(v: number): number {
  return Math.round(v / SKETCH_CELL) * SKETCH_CELL;
}

/** The rectangle between two corners, snapped to the grid, at least one cell each way. */
export function rectBetween(ax: number, ay: number, bx: number, by: number): SketchRect {
  let x0 = snap(Math.min(ax, bx));
  let y0 = snap(Math.min(ay, by));
  let x1 = snap(Math.max(ax, bx));
  let y1 = snap(Math.max(ay, by));
  if (x1 <= x0) x1 = x0 + SKETCH_CELL;
  if (y1 <= y0) y1 = y0 + SKETCH_CELL;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function inRect(r: SketchRect, x: number, y: number): boolean {
  return x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
}

function overlapArea(a: SketchRect, b: SketchRect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * True when two rectangles share part of a side (they sit edge to edge, with at
 * least one cell of that side in common).
 */
export function touching(a: SketchRect, b: SketchRect): boolean {
  const xs = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const ys = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  const sideBySide = (a.x + a.w === b.x || b.x + b.w === a.x) && ys > 0;
  const aboveBelow = (a.y + a.h === b.y || b.y + b.h === a.y) && xs > 0;
  return sideBySide || aboveBelow;
}

/** True when b carries straight on from a: same width, lined up, end to end. */
function straightOn(a: SketchRect, b: SketchRect): boolean {
  const stacked = a.x === b.x && a.w === b.w && (a.y + a.h === b.y || b.y + b.h === a.y);
  const sideBySide = a.y === b.y && a.h === b.h && (a.x + a.w === b.x || b.x + b.w === a.x);
  return stacked || sideBySide;
}

/**
 * Join a route's rectangles that carry straight on from the one before into one
 * stretch, so a long straight route drawn in several goes splits like one drawn in a
 * single go (100 + 60 makes two maps of 80, not 50 + 50 + 60). Bends stay separate.
 * Returns true if anything was joined.
 */
export function mergeStraightRects(place: SketchPlace): boolean {
  if (place.kind !== "route") return false;
  let changed = false;
  for (let k = 0; k + 1 < place.rects.length; ) {
    const a = place.rects[k];
    const b = place.rects[k + 1];
    if (!straightOn(a, b)) {
      k++;
      continue;
    }
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    place.rects.splice(k, 2, { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y });
    changed = true;
  }
  return changed;
}

/** A piece of an outdoor place that becomes one map. */
export interface SketchPiece {
  placeId: string;
  /** Which rectangle of the place, and which segment of it. */
  rect: number;
  segment: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Split a lengths into n near-equal parts, each a whole number of sketch cells
 * where possible (the last part takes what's left).
 */
function splitLength(length: number, target: number): number[] {
  const n = Math.max(1, Math.ceil(length / target));
  const cells = length / SKETCH_CELL;
  if (n === 1) return [length];
  const out: number[] = [];
  let used = 0;
  for (let k = 0; k < n; k++) {
    const end = Math.round(((k + 1) * cells) / n) * SKETCH_CELL;
    out.push(k === n - 1 ? length - used : end - used);
    used = k === n - 1 ? length : end;
  }
  return out;
}

/**
 * The maps an outdoor place becomes: a town is one map; each stretch of a route
 * is one map, or several segments of at most `target` along its length.
 */
export function placePieces(place: SketchPlace, target: number): SketchPiece[] {
  if (!isOutdoor(place.kind)) return [];
  const out: SketchPiece[] = [];
  place.rects.forEach((r, k) => {
    if (place.kind === "town") {
      out.push({ placeId: place.id, rect: k, segment: 0, ...r });
      return;
    }
    const vertical = r.h >= r.w;
    let at = vertical ? r.y : r.x;
    splitLength(vertical ? r.h : r.w, target).forEach((len, segment) => {
      out.push(vertical ? { placeId: place.id, rect: k, segment, x: r.x, y: at, w: r.w, h: len } : { placeId: place.id, rect: k, segment, x: at, y: r.y, w: len, h: r.h });
      at += len;
    });
  });
  return out;
}

/** The outdoor place under a point (the last drawn wins, as it's drawn on top). */
export function outdoorPlaceAt(sketch: Sketch, x: number, y: number): SketchPlace | null {
  for (let k = sketch.places.length - 1; k >= 0; k--) {
    const p = sketch.places[k];
    if (isOutdoor(p.kind) && p.rects.some((r) => inRect(r, x, y))) return p;
  }
  return null;
}

/** The route or town an inside place belongs to: the one under its first entrance pin. */
export function parentOf(sketch: Sketch, place: SketchPlace): SketchPlace | null {
  const pin = place.pins[0];
  return pin ? outdoorPlaceAt(sketch, pin.x, pin.y) : null;
}

export function areaAt(sketch: Sketch, x: number, y: number): SketchArea | null {
  const cx = Math.floor(x / SKETCH_CELL);
  const cy = Math.floor(y / SKETCH_CELL);
  if (cx < 0 || cy < 0 || cx >= sketchCols(sketch) || cy >= sketchRows(sketch)) return null;
  const v = sketch.areas[cy * sketchCols(sketch) + cx];
  return v ? SKETCH_AREAS[v - 1] : null;
}

/** The biome of a painted area, if it's one (lakes and sea aren't). */
export function areaBiome(area: SketchArea | null): Biome | null {
  return area && (BIOMES as readonly string[]).includes(area) ? (area as Biome) : null;
}

/** Default size of a new forest or cave map (metatiles). */
export const INSIDE_SIZES: Record<"forest" | "cave", { w: number; h: number }> = {
  forest: { w: 50, h: 50 },
  cave: { w: 40, h: 40 },
};

export interface SketchIssue {
  severity: "error" | "warning";
  code: string;
  placeId: string | null;
  message: string;
}

/** Things to fix in the sketch before the region is built. */
export function sketchIssues(sketch: Sketch, target: number, limits: EngineLimits = DEFAULT_ENGINE_LIMITS): SketchIssue[] {
  const out: SketchIssue[] = [];
  const add = (severity: SketchIssue["severity"], code: string, place: SketchPlace | null, message: string) => out.push({ severity, code, placeId: place?.id ?? null, message });
  const outdoor = sketch.places.filter((p) => isOutdoor(p.kind));
  for (const p of outdoor) {
    if (!p.rects.length) add("error", "no-shape", p, `${p.name} has no rectangle. Draw it, or delete it.`);
    for (const r of p.rects)
      if (r.x < 0 || r.y < 0 || r.x + r.w > sketch.width || r.y + r.h > sketch.height) add("error", "outside-sketch", p, `${p.name} runs past the edge of the sketch.`);
    // A route's stretches join end to end.
    for (let k = 1; k < p.rects.length; k++)
      if (!touching(p.rects[k - 1], p.rects[k])) add("error", "route-gap", p, `${p.name}: stretch ${k + 1} doesn't touch stretch ${k}. Stretches of a route join edge to edge.`);
    for (const piece of placePieces(p, target)) {
      const size = checkMapSize(piece.w, piece.h, limits);
      if (!size.ok)
        add(
          "error",
          "too-big",
          p,
          `${p.name}${p.kind === "route" ? ` (${piece.w}×${piece.h} segment)` : ""} is too big for the game: ${piece.w}×${piece.h} needs ${size.used.toLocaleString("en-US")} of ${size.limit.toLocaleString("en-US")}. Make it narrower${p.kind === "route" ? ", or lower the segment length" : ""}.`,
        );
      if (p.kind === "route" && Math.min(piece.w, piece.h) < 15) add("warning", "narrow", p, `${p.name} is ${Math.min(piece.w, piece.h)} wide; routes are usually at least 20 (one screen is 15×10).`);
    }
  }
  // Places sit next to each other, not on top of each other.
  for (let a = 0; a < outdoor.length; a++)
    for (let b = a + 1; b < outdoor.length; b++)
      if (outdoor[a].rects.some((ra) => outdoor[b].rects.some((rb) => overlapArea(ra, rb) > 0)))
        add("error", "overlap", outdoor[b], `${outdoor[a].name} and ${outdoor[b].name} overlap. Places meet edge to edge, where the maps connect.`);
  // Within a route, stretches only overlap at a bend… they shouldn't overlap at all.
  for (const p of outdoor)
    for (let a = 0; a < p.rects.length; a++)
      for (let b = a + 1; b < p.rects.length; b++)
        if (overlapArea(p.rects[a], p.rects[b]) > 0) add("error", "overlap", p, `${p.name}: stretches ${a + 1} and ${b + 1} overlap.`);
  for (const p of sketch.places.filter((x) => !isOutdoor(x.kind))) {
    if (!p.pins.length) add("error", "no-entrance", p, `${p.name} has no entrance. Put a pin on the route or town it's reached from.`);
    p.pins.forEach((pin, k) => {
      if (!outdoorPlaceAt(sketch, pin.x, pin.y)) add("error", "pin-outside", p, `${p.name}: entrance ${k + 1} isn't on a route or town.`);
    });
    if (p.size) {
      const size = checkMapSize(p.size.w, p.size.h, limits);
      if (!size.ok) add("error", "too-big", p, `${p.name} is too big for the game: ${p.size.w}×${p.size.h}.`);
    }
  }
  // Names become map names, so they must differ.
  const seen = new Map<string, SketchPlace>();
  for (const p of sketch.places) {
    const key = p.name.trim().toLowerCase();
    if (seen.has(key)) add("error", "same-name", p, `Two places are called "${p.name}". Give each its own name.`);
    else seen.set(key, p);
  }
  return out;
}

/** A name for a new place: "Route 1", "Town 2"… the first number not in use. */
export function nextPlaceName(sketch: Sketch, kind: SketchPlaceKind): string {
  const base = { town: "Town", route: "Route", forest: "Forest", cave: "Cave" }[kind];
  const used = new Set(sketch.places.map((p) => p.name.trim().toLowerCase()));
  for (let n = 1; ; n++) if (!used.has(`${base} ${n}`.toLowerCase())) return `${base} ${n}`;
}

export function newPlaceId(sketch: Sketch): string {
  return `p${sketch.nextId++}`;
}

/** Add a town or route stretch. A rectangle that touches the end of the selected route extends it. */
export function addOutdoor(sketch: Sketch, kind: "town" | "route", rect: SketchRect, extend: SketchPlace | null = null): SketchPlace {
  if (kind === "route" && extend && extend.kind === "route") {
    extend.rects.push(rect);
    mergeStraightRects(extend);
    return extend;
  }
  const place: SketchPlace = { id: newPlaceId(sketch), kind, name: nextPlaceName(sketch, kind), rects: [rect], pins: [], size: null, ownSection: false, mapIds: [] };
  sketch.places.push(place);
  return place;
}

/** Add a forest or cave with its first entrance pin. */
export function addInside(sketch: Sketch, kind: "forest" | "cave", pin: SketchPin): SketchPlace {
  const place: SketchPlace = { id: newPlaceId(sketch), kind, name: nextPlaceName(sketch, kind), rects: [], pins: [pin], size: { ...INSIDE_SIZES[kind] }, ownSection: false, mapIds: [] };
  sketch.places.push(place);
  return place;
}

/** Paint a square of sketch cells (brush = cells across) with an area, or 0 to clear. Returns true if anything changed. */
export function paintAreas(sketch: Sketch, x: number, y: number, brush: number, value: number): boolean {
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
      if (sketch.areas[i] !== value) {
        sketch.areas[i] = value;
        changed = true;
      }
    }
  return changed;
}

/** Make the sketch bigger or smaller (from the top-left; anything off the new edge is cut). */
export function resizeSketch(sketch: Sketch, width: number, height: number): void {
  const w = Math.max(SKETCH_CELL, Math.min(MAX_SKETCH_SIDE, snap(width)));
  const h = Math.max(SKETCH_CELL, Math.min(MAX_SKETCH_SIDE, snap(height)));
  const oldCols = sketchCols(sketch);
  const areas = new Uint8Array((w / SKETCH_CELL) * (h / SKETCH_CELL));
  const cols = w / SKETCH_CELL;
  for (let y = 0; y < Math.min(sketchRows(sketch), h / SKETCH_CELL); y++)
    for (let x = 0; x < Math.min(oldCols, cols); x++) areas[y * cols + x] = sketch.areas[y * oldCols + x];
  sketch.width = w;
  sketch.height = h;
  sketch.areas = areas;
}

/** A deep copy (for undo). The underlay's file is shared, as it never changes in place. */
export function cloneSketch(s: Sketch): Sketch {
  return {
    ...s,
    areas: s.areas.slice(),
    places: s.places.map((p) => ({ ...p, rects: p.rects.map((r) => ({ ...r })), pins: p.pins.map((q) => ({ ...q })), size: p.size ? { ...p.size } : null, mapIds: [...p.mapIds] })),
    rivers: s.rivers.map((r) => ({ ...r, points: [...r.points] })),
    underlay: s.underlay ? { ...s.underlay } : null,
    journey: { stops: [...s.journey.stops], stepStarts: { ...s.journey.stepStarts } },
    regionMap: { ...s.regionMap, overrides: Object.fromEntries(Object.entries(s.regionMap.overrides).map(([k, r]) => [k, { ...r, ...(r.cells ? { cells: [...r.cells] } : {}) }])) },
  };
}

// ----- editing rivers -----

/** How far a point is from the line segment a–b. */
function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** The river under a point (within `tol` of its edge), the last drawn first, or null. */
export function riverAt(sketch: Sketch, x: number, y: number, tol: number): SketchRiver | null {
  for (let k = sketch.rivers.length - 1; k >= 0; k--) {
    const r = sketch.rivers[k];
    const reach = r.width / 2 + tol;
    for (let i = 0; i + 3 < r.points.length; i += 2)
      if (distToSegment(x, y, r.points[i], r.points[i + 1], r.points[i + 2], r.points[i + 3]) <= reach) return r;
  }
  return null;
}

/** The point of a river within `tol` of (x, y), by point number (0 = first), or -1. */
export function riverPointAt(river: SketchRiver, x: number, y: number, tol: number): number {
  let best = -1;
  let bestD = tol;
  for (let k = 0; k < river.points.length / 2; k++) {
    const d = Math.hypot(river.points[2 * k] - x, river.points[2 * k + 1] - y);
    if (d <= bestD) (best = k), (bestD = d);
  }
  return best;
}

/** The middle of each stretch of a river (where a new point can be added): [x, y] per stretch. */
export function riverMidpoints(river: SketchRiver): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i + 3 < river.points.length; i += 2) out.push([(river.points[i] + river.points[i + 2]) / 2, (river.points[i + 1] + river.points[i + 3]) / 2]);
  return out;
}

/** Add a point to a river in its stretch number `after` (between points after and after + 1). Returns its point number. */
export function insertRiverPoint(river: SketchRiver, after: number, x: number, y: number): number {
  river.points.splice(2 * (after + 1), 0, Math.round(x), Math.round(y));
  return after + 1;
}

/** Take a point off a river. A river keeps at least two points: returns false if it can't. */
export function removeRiverPoint(river: SketchRiver, k: number): boolean {
  if (river.points.length <= 4 || k < 0 || 2 * k >= river.points.length) return false;
  river.points.splice(2 * k, 2);
  return true;
}
