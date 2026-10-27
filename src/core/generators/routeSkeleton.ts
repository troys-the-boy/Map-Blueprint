// Stage 2 for routes: the skeleton.
//
// 1. Carve each entrance through the border.
// 2. Lay the main path from the first entrance to each other one. The path is a
//    cheapest route over a noisy cost field, through a few random waypoints, so
//    the "winding" setting controls how much it wanders.
// 3. Add side branches that end in dead ends.

import type { Edge, Opening } from "../model";
import type { Rng } from "../rng";
import { T, cheapestPath, distanceField } from "../grid";
import { IS_WALKABLE } from "../grid";
import type { GenContext } from "./context";
import { Role } from "./context";
import type { RouteParams } from "./params";

/** Pick default entrances: one on each short end of the map. */
export function defaultOpenings(width: number, height: number, params: RouteParams, rng: Rng): Opening[] {
  const vertical = height >= width;
  const edges: [Edge, Edge] = vertical ? ["north", "south"] : ["west", "east"];
  const edgeLength = vertical ? width : height;
  return edges.map((edge, k) => {
    const w = Math.min(edgeLength, rng.int(params.pathWidthMin, Math.max(params.pathWidthMin, params.pathWidthMax)) + 1);
    const margin = params.borderThickness + 2;
    const lo = Math.min(margin, Math.max(0, edgeLength - w));
    const hi = Math.max(lo, edgeLength - margin - w);
    // Keep entrances in the middle 60% of the edge so the path has room to wander.
    const mid = (lo + hi) / 2;
    const spread = (hi - lo) * 0.3;
    const start = Math.round(Math.min(hi, Math.max(lo, mid + rng.range(-spread, spread))));
    return { id: `o${k + 1}`, edge, start, width: w };
  });
}

/** Cell indices along an opening, from the map edge inwards to `depth`. Also returns the inner end cell. */
function carveOpening(ctx: GenContext, o: Opening): number {
  const depth = ctx.params.borderThickness + 1;
  let inner = 0;
  for (let k = 0; k < o.width; k++) {
    const along = o.start + k;
    for (let d = 0; d <= depth; d++) {
      let x: number, y: number;
      if (o.edge === "north") [x, y] = [along, d];
      else if (o.edge === "south") [x, y] = [along, ctx.height - 1 - d];
      else if (o.edge === "west") [x, y] = [d, along];
      else [x, y] = [ctx.width - 1 - d, along];
      if (!ctx.inside(x, y)) continue;
      const i = ctx.idx(x, y);
      ctx.set(i, T.path, Role.Opening);
      if (k === Math.floor(o.width / 2) && d === depth) inner = i;
    }
  }
  return inner;
}

/** Cost of laying path through a cell: noise makes paths wander; locked walls can't be crossed. */
function pathCost(ctx: GenContext, margin: number) {
  const winding = ctx.params.winding;
  return (i: number) => {
    const [x, y] = ctx.xy(i);
    if (ctx.locks[i]) return IS_WALKABLE[ctx.terrain[i]] ? 1 : Infinity;
    if (ctx.role[i] === Role.Opening) return 1;
    // Never through the border wall; near it only when there's no other way.
    if (ctx.edgeDist(i) < ctx.params.borderThickness) return Infinity;
    const nearEdge = x < margin || y < margin || x >= ctx.width - margin || y >= ctx.height - margin;
    return (nearEdge ? 25 : 1) + winding * 6 * ctx.noise.fractal(x, y, 7, 2);
  };
}

/** Waypoints between two cells, spread along the route's main direction, wandering sideways by `winding`. */
function waypoints(ctx: GenContext, a: number, b: number, margin: number): number[] {
  const [ax, ay] = ctx.xy(a);
  const [bx, by] = ctx.xy(b);
  const length = Math.abs(bx - ax) + Math.abs(by - ay);
  const count = Math.round(ctx.params.winding * (length / 14));
  const out: number[] = [];
  for (let k = 1; k <= count; k++) {
    const t = k / (count + 1);
    let x = Math.round(ax + (bx - ax) * t);
    let y = Math.round(ay + (by - ay) * t);
    const sway = ctx.params.winding;
    if (ctx.vertical) x = Math.round(margin + ctx.rng.range(0, 1) * (ctx.width - 2 * margin - 1) * sway + x * (1 - sway));
    else y = Math.round(margin + ctx.rng.range(0, 1) * (ctx.height - 2 * margin - 1) * sway + y * (1 - sway));
    x = Math.min(ctx.width - margin - 1, Math.max(margin, x));
    y = Math.min(ctx.height - margin - 1, Math.max(margin, y));
    out.push(ctx.idx(x, y));
  }
  return out;
}

export function buildRouteSkeleton(ctx: GenContext): void {
  const p = ctx.params;
  // Keep the path's centre line far enough from the edge that its full width
  // stays clear of the border wall.
  const margin = p.borderThickness + Math.ceil(p.pathWidthMax / 2) + 1;
  const cost = pathCost(ctx, margin);

  ctx.openingEnds = ctx.input.openings.map((o) => carveOpening(ctx, o));
  if (ctx.openingEnds.length === 0) return;

  // Main path: from the first entrance to every other one.
  const first = ctx.openingEnds[0];
  const mainLine: number[] = [];
  for (let k = 1; k < ctx.openingEnds.length; k++) {
    const target = ctx.openingEnds[k];
    // Later entrances join the nearest point of the path so far.
    let from = first;
    if (mainLine.length) {
      const [tx, ty] = ctx.xy(target);
      from = mainLine.reduce((best, c) => {
        const [cx, cy] = ctx.xy(c);
        const [bx, by] = ctx.xy(best);
        return Math.abs(cx - tx) + Math.abs(cy - ty) < Math.abs(bx - tx) + Math.abs(by - ty) ? c : best;
      }, mainLine[0]);
    }
    const stops = [from, ...waypoints(ctx, from, target, margin), target];
    for (let s = 0; s + 1 < stops.length; s++) {
      const leg = cheapestPath(ctx.width, ctx.height, stops[s], stops[s + 1], cost);
      if (!leg) continue; // Blocked by locked cells; validation will report it.
      mainLine.push(...(mainLine.length && mainLine[mainLine.length - 1] === leg[0] ? leg.slice(1) : leg));
    }
  }
  ctx.mainLine = mainLine;

  // Carve it. The width changes now and then, between the min and max.
  let width = ctx.rng.int(p.pathWidthMin, p.pathWidthMax);
  mainLine.forEach((c, k) => {
    if (k % 12 === 0) width = ctx.rng.int(p.pathWidthMin, p.pathWidthMax);
    ctx.stamp(c, width, T.path, Role.MainPath, (j) => ctx.role[j] !== Role.Opening && ctx.edgeDist(j) >= p.borderThickness);
  });

  buildBranches(ctx, cost, margin);
}

function buildBranches(ctx: GenContext, cost: (i: number) => number, margin: number) {
  const p = ctx.params;
  const line = ctx.mainLine;
  if (line.length < 10) return;
  for (let b = 0; b < p.branches; b++) {
    for (let attempt = 0; attempt < 12; attempt++) {
      // Branch off somewhere in the middle 70% of the main path.
      const from = line[Math.floor(line.length * ctx.rng.range(0.15, 0.85))];
      const [fx, fy] = ctx.xy(from);
      const reach = Math.round(5 + p.branchLength * 14 * ctx.rng.range(0.6, 1));
      const side = ctx.rng.chance(0.5) ? 1 : -1;
      const along = ctx.rng.int(-4, 4);
      const tx = Math.min(ctx.width - margin - 1, Math.max(margin, ctx.vertical ? fx + side * reach : fx + along));
      const ty = Math.min(ctx.height - margin - 1, Math.max(margin, ctx.vertical ? fy + along : fy + side * reach));
      const target = ctx.idx(tx, ty);
      // The tip must be well away from existing paths, or it isn't a real branch.
      const dist = distanceField(ctx.width, ctx.height, ctx.mainLine.concat(ctx.deadEnds));
      if (dist[target] < 5) continue;
      const leg = cheapestPath(ctx.width, ctx.height, from, target, cost);
      if (!leg) continue;
      for (const c of leg)
        ctx.stamp(c, p.pathWidthMin, T.path, Role.Branch, (j) => ctx.role[j] !== Role.MainPath && ctx.role[j] !== Role.Opening && ctx.edgeDist(j) >= p.borderThickness);
      ctx.deadEnds.push(target);
      break;
    }
  }
}
