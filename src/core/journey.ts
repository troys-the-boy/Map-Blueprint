// The journey: the order the player first visits the region's places, drawn as
// a line through the sketch. From it come:
//
//   • each place's order, and from that its wild level band (the region's level
//     curve, start to end, spread evenly along the journey);
//   • which progression step (badges and HMs) applies there: a step starts at a
//     stop and lasts until the next step starts;
//   • for each route segment, the edge it's entered by (Start) and left by
//     (Finish), and for a forest or cave, which entrance pin is the way in and
//     which the way out. Building the region (part E) puts these on the maps.
//
// Places off the journey (a side cave, say) take the order and step of the
// route or town they're on.

import type { Edge, ProgressionStep, Region } from "./model";
import type { Sketch, SketchPiece, SketchPlace, SketchRect } from "./sketch";
import { inRect, isOutdoor, parentOf, placePieces } from "./sketch";

export interface Journey {
  /** Place ids, in the order the player first visits them. */
  stops: string[];
  /** Progression step id → the place where it starts (a stop). */
  stepStarts: Record<string, string>;
}

export function newJourney(): Journey {
  return { stops: [], stepStarts: {} };
}

/** One map of a route: where the player comes in and goes out on the first trip. */
export interface PieceTravel extends SketchPiece {
  from: Edge | null;
  to: Edge | null;
}

export interface PlaceJourney {
  placeId: string;
  /** Position on the journey (0 = first stop), or null when it's off the line. */
  stop: number | null;
  /** The stop whose order it takes (its own, or its route's or town's). Null: no order. */
  order: number | null;
  stepId: string | null;
  levels: { min: number; max: number } | null;
  /** Routes on the line: each map in the order they're walked, with Start and Finish edges. */
  pieces: PieceTravel[];
  /** Forests and caves on the line: which entrance pin is the way in and the way out. */
  entryPin: number | null;
  exitPin: number | null;
}

export interface JourneyProblem {
  severity: "error" | "warning";
  placeId: string | null;
  message: string;
}

export interface JourneyPlan {
  places: Map<string, PlaceJourney>;
  problems: JourneyProblem[];
}

const OPPOSITE: Record<Edge, Edge> = { north: "south", south: "north", east: "west", west: "east" };

/** The side of `a` that `b` sits against (they share part of that side), or null. */
export function facingSide(a: SketchRect, b: SketchRect): Edge | null {
  const xs = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const ys = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (xs > 0 && b.y + b.h === a.y) return "north";
  if (xs > 0 && a.y + a.h === b.y) return "south";
  if (ys > 0 && b.x + b.w === a.x) return "west";
  if (ys > 0 && a.x + a.w === b.x) return "east";
  return null;
}

/** The level band of stop i of n, from the level curve. */
export function levelBand(i: number, n: number, curve: { start: number; end: number }): { min: number; max: number } {
  const at = (t: number) => Math.round(curve.start + (curve.end - curve.start) * t);
  const min = at(n > 0 ? i / n : 0);
  return { min, max: Math.max(min, at(n > 0 ? (i + 1) / n : 1)) };
}

/** How the player gets between two neighbouring stops: touching rectangles, or an entrance pin. */
interface Link {
  /** Which rectangle of the outdoor place is used, and its side facing the other place (null for a pin). */
  rect: number;
  side: Edge | null;
  /** For a forest or cave: which of its pins. */
  pin: number;
  /** For a pin: the edge of the rectangle nearest it. */
  near?: Edge;
}

function nearestEdge(r: SketchRect, x: number, y: number): Edge {
  const d: Array<[Edge, number]> = [
    ["north", y - r.y],
    ["south", r.y + r.h - 1 - y],
    ["west", x - r.x],
    ["east", r.x + r.w - 1 - x],
  ];
  // Along the stretch only: a route is entered at its ends, not its sides.
  const vertical = r.h >= r.w;
  return d.filter(([e]) => (vertical ? e === "north" || e === "south" : e === "east" || e === "west")).sort((a, b) => a[1] - b[1])[0][0];
}

function linkBetween(place: SketchPlace, other: SketchPlace): Link | null {
  if (isOutdoor(place.kind) && isOutdoor(other.kind)) {
    for (const [k, r] of place.rects.entries())
      for (const o of other.rects) {
        const side = facingSide(r, o);
        if (side) return { rect: k, side, pin: -1 };
      }
    return null;
  }
  if (isOutdoor(place.kind)) {
    // The forest or cave has an entrance on this place. The route's map is entered (or left)
    // toward the edge nearest that entrance, so it still gets a Start or Finish edge.
    for (const [pin, q] of other.pins.entries()) {
      const k = place.rects.findIndex((r) => inRect(r, q.x, q.y));
      if (k >= 0) return { rect: k, side: null, pin, near: nearestEdge(place.rects[k], q.x, q.y) };
    }
    return null;
  }
  if (isOutdoor(other.kind)) {
    const back = linkBetween(other, place);
    return back ? { rect: -1, side: null, pin: back.pin } : null;
  }
  return null;
}

/** Order a route's maps the way the player walks them, with Start and Finish edges. */
function routePieces(route: SketchPlace, target: number, entry: Link | null, exit: Link | null): PieceTravel[] {
  const pieces = placePieces(route, target);
  const last = route.rects.length - 1;
  // Walk the chain forwards (first stretch first) or backwards, whichever runs from the entry to the exit.
  let reverse: boolean;
  if (entry && exit && entry.rect !== exit.rect) reverse = entry.rect > exit.rect;
  else if (entry && (!exit || entry.rect === exit.rect)) reverse = entry.rect === last && last > 0;
  else if (exit) reverse = exit.rect === 0 && last > 0;
  else reverse = false;
  // Within one stretch the segments run first to last; flip them if the player enters at the far end.
  const stretchOrder = reverse ? [...route.rects.keys()].reverse() : [...route.rects.keys()];
  const ordered: SketchPiece[] = [];
  for (const k of stretchOrder) {
    const own = pieces.filter((p) => p.rect === k);
    const r = route.rects[k];
    const vertical = r.h >= r.w;
    // The segment nearest where the player comes into this stretch goes first.
    const prev = ordered[ordered.length - 1];
    let startsHigh: boolean;
    if (prev) {
      // Whichever end segment touches the stretch walked before (at a bend that can be its side).
      startsHigh = own.length > 1 && !!facingSide(own[own.length - 1], prev) && !facingSide(own[0], prev);
    } else {
      let comesFrom: Edge | null = k === entry?.rect ? (entry.side ?? entry.near ?? null) : null;
      if (!comesFrom && own.length > 1) {
        // No neighbour yet (the route starts here): run toward the way out.
        const goesTo = k === exit?.rect ? (exit.side ?? exit.near ?? null) : null;
        comesFrom = goesTo ? OPPOSITE[goesTo] : null;
      }
      startsHigh = comesFrom === (vertical ? "south" : "east");
    }
    ordered.push(...(startsHigh ? [...own].reverse() : own));
  }
  return ordered.map((p, k) => {
    const before = ordered[k - 1];
    const after = ordered[k + 1];
    let from = before ? facingSide(p, before) : entry?.side ?? entry?.near ?? null;
    let to = after ? facingSide(p, after) : exit?.side ?? exit?.near ?? null;
    // An end with no neighbour on an edge (a cave or forest, or the journey's ends): the far side.
    if (!from && to) from = OPPOSITE[to];
    if (!to && from) to = OPPOSITE[from];
    if (from && from === to) to = null;
    return { ...p, from, to };
  });
}

/** Work out the journey's order, levels, steps and Start/Finish edges. */
export function planJourney(sketch: Sketch, region: Pick<Region, "progression" | "settings">): JourneyPlan {
  const journey = sketch.journey;
  const byId = new Map(sketch.places.map((p) => [p.id, p]));
  const stops = journey.stops.map((id) => byId.get(id)).filter((p): p is SketchPlace => !!p);
  const n = stops.length;
  const target = region.settings.targetSegmentLength;
  const problems: JourneyProblem[] = [];
  const places = new Map<string, PlaceJourney>();

  // Steps: each starts at a stop and lasts until the next one starts.
  const stopIndex = new Map(stops.map((p, i) => [p.id, i]));
  const starts = region.progression
    .map((step, listed) => ({ step, listed, at: stopIndex.get(journey.stepStarts[step.id] ?? "") }))
    .filter((x): x is { step: ProgressionStep; listed: number; at: number } => x.at !== undefined)
    .sort((a, b) => a.at - b.at || a.listed - b.listed);
  for (let k = 1; k < starts.length; k++)
    if (starts[k].listed < starts[k - 1].listed)
      problems.push({ severity: "warning", placeId: null, message: `"${starts[k].step.name}" starts after "${starts[k - 1].step.name}" on the journey but comes before it in the list of steps.` });
  const stepAt = (i: number) => {
    let id: string | null = null;
    for (const s of starts) if (s.at <= i) id = s.step.id;
    return id;
  };

  stops.forEach((p, i) => {
    const prev = stops[i - 1];
    const next = stops[i + 1];
    const entry = prev ? linkBetween(p, prev) : null;
    const exit = next ? linkBetween(p, next) : null;
    if (prev && !entry)
      problems.push({
        severity: !isOutdoor(p.kind) && !isOutdoor(prev.kind) ? "warning" : "error",
        placeId: p.id,
        message: !isOutdoor(p.kind) && !isOutdoor(prev.kind) ? `${prev.name} and ${p.name} are both reached by warps: make sure a warp joins them, or put a route between them.` : `${prev.name} and ${p.name} don't meet, so the player can't walk from one to the other. Make them touch, or put the ${isOutdoor(p.kind) ? (isOutdoor(prev.kind) ? "two places" : `${prev.name}'s entrance`) : `${p.name}'s entrance`} on the other.`,
      });
    places.set(p.id, {
      placeId: p.id,
      stop: i,
      order: i,
      stepId: stepAt(i),
      levels: levelBand(i, n, region.settings.levelCurve),
      pieces: p.kind === "route" ? routePieces(p, target, entry, exit) : [],
      entryPin: !isOutdoor(p.kind) ? (entry?.pin ?? (p.pins.length ? 0 : null)) : null,
      exitPin: !isOutdoor(p.kind) ? (exit?.pin ?? (p.pins.length > 1 ? p.pins.length - 1 : null)) : null,
    });
  });

  // Places off the line take their route's or town's order.
  for (const p of sketch.places) {
    if (places.has(p.id)) continue;
    const parent = isOutdoor(p.kind) ? null : parentOf(sketch, p);
    const from = parent ? places.get(parent.id) : undefined;
    places.set(p.id, { placeId: p.id, stop: null, order: from?.order ?? null, stepId: from?.stepId ?? null, levels: from?.levels ?? null, pieces: [], entryPin: null, exitPin: null });
    if (n > 0 && isOutdoor(p.kind)) problems.push({ severity: "warning", placeId: p.id, message: `${p.name} isn't on the journey, so it has no levels or step. Add it with the Journey tool.` });
  }
  return { places, problems };
}

/**
 * The journey line through the sketch, as x0, y0, x1, y1… (metatiles): through each
 * town's middle, along each route's stretches in the order walked, and through
 * forest and cave entrances.
 */
export function journeyLine(sketch: Sketch, plan: JourneyPlan): number[] {
  return stopPoints(sketch, plan).flat();
}

/** Each stop's points along the journey line (see journeyLine), one list per stop. */
export function stopPoints(sketch: Sketch, plan: JourneyPlan): number[][] {
  const all: number[][] = [];
  const byId = new Map(sketch.places.map((p) => [p.id, p]));
  for (const id of sketch.journey.stops) {
    const p = byId.get(id);
    const pj = plan.places.get(id);
    if (!p || !pj) continue;
    const out: number[] = [];
    all.push(out);
    if (p.kind === "town") for (const r of p.rects) out.push(r.x + r.w / 2, r.y + r.h / 2);
    else if (p.kind === "route") for (const piece of pj.pieces) out.push(piece.x + piece.w / 2, piece.y + piece.h / 2);
    else {
      const pins = [pj.entryPin, pj.exitPin].filter((k, i, a): k is number => k !== null && a.indexOf(k) === i);
      for (const k of pins) out.push(p.pins[k].x + 0.5, p.pins[k].y + 0.5);
    }
  }
  return all;
}
