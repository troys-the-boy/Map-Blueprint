// Route layouts: the big shapes laid down before anything else.
//
//   land     – no layout water (today's routes).
//   coastal  – the sea fills one long side, with a ragged shoreline and a beach.
//              The map edge on that side is water, not trees.
//   river    – a river runs the length of the route. The path follows it and
//              crosses it on bridges.
//   water    – open water (sea or lake) with islands; a surfing route.
//
// Entrance positions depend on the layout (surf entrances sit on the water),
// so both are worked out from the same "geometry", which comes from a seed
// that doesn't change between retries.

import { T, cheapestPath, distanceField } from "../grid";
import type { Edge, Opening } from "../model";
import { Rng } from "../rng";
import { ValueNoise } from "../noise";
import type { GenContext } from "./context";
import { Role } from "./context";
import type { Layout, RouteParams } from "./params";
import { travelOf, travelVertical } from "./travel";

/** Layout geometry, in "along" (the long axis) and "cross" (the short axis) coordinates. */
export interface Geometry {
  vertical: boolean;
  alongLength: number;
  crossLength: number;
  /** Coastal: which side of the cross axis the sea is on, and how wide it is on average. */
  seaLow: boolean;
  seaWidth: number;
  /** River: cross position where it meets each short edge, and its width. */
  riverStart: number;
  riverEnd: number;
  riverWidth: number;
}

export function computeGeometry(width: number, height: number, p: RouteParams, layout: Layout, seed: number): Geometry {
  const rng = new Rng(seed);
  // A travel direction sets which way the route runs; otherwise it runs along the map's long side.
  const travel = travelOf(p.travel);
  const vertical = travel ? travelVertical(travel) : height >= width;
  const crossLength = vertical ? width : height;
  const alongLength = vertical ? height : width;
  const seaLow = rng.chance(0.5);
  // The sea takes 30–50% of the width, more with the Water setting, but always leaves room for the path.
  const minLand = p.borderThickness + p.pathWidthMax + 8;
  const seaWidth = Math.max(4, Math.min(crossLength - minLand, Math.round(crossLength * (0.3 + 0.2 * p.water))));
  const riverWidth = Math.min(Math.max(3, Math.round(3 + p.water * 2)), Math.max(3, crossLength - 2 * minLand));
  const margin = p.borderThickness + Math.ceil(riverWidth / 2) + 4;
  const riverAt = () => Math.round(Math.min(crossLength - margin, Math.max(margin, crossLength * rng.range(0.3, 0.7))));
  return { vertical, alongLength, crossLength, seaLow, seaWidth, riverStart: riverAt(), riverEnd: riverAt(), riverWidth };
}

/** The two short edges: where the route starts and ends. */
function shortEdges(g: Geometry): [Edge, Edge] {
  return g.vertical ? ["north", "south"] : ["west", "east"];
}

/** Default entrances for a layout. */
export function layoutOpenings(g: Geometry, p: RouteParams, layout: Layout, rng: Rng): Opening[] {
  const out: Opening[] = [];
  const edges = shortEdges(g);
  const walkWidth = () => Math.min(g.crossLength, rng.int(p.pathWidthMin, Math.max(p.pathWidthMin, p.pathWidthMax)) + 1);
  /** Somewhere in the middle 60% of an allowed interval [lo, hi] (first cell positions). */
  const place = (lo: number, hi: number, w: number) => {
    const a = Math.max(0, Math.min(lo, g.crossLength - w));
    const b = Math.max(a, Math.min(hi, g.crossLength - w));
    const mid = (a + b) / 2;
    const spread = (b - a) * 0.3;
    return Math.round(Math.min(b, Math.max(a, mid + rng.range(-spread, spread))));
  };
  const bt = p.borderThickness;
  edges.forEach((edge, k) => {
    const id = (n: number) => `o${out.length + n}`;
    if (layout === "land") {
      const w = walkWidth();
      out.push({ id: id(1), edge, start: place(bt + 2, g.crossLength - bt - 2 - w, w), width: w, kind: "walk" });
    } else if (layout === "coastal") {
      const w = walkWidth();
      // Land part: away from the sea side, past the beach.
      // Keep clear of the shoreline, which wanders up to 3 cells either way.
      const landLo = g.seaLow ? g.seaWidth + 6 : bt + 2;
      const landHi = g.seaLow ? g.crossLength - bt - 2 - w : g.crossLength - g.seaWidth - 6 - w;
      out.push({ id: id(1), edge, start: place(landLo, landHi, w), width: w, kind: "walk" });
      if (p.surfEntrances) {
        const sw = Math.max(2, Math.min(5, g.seaWidth - 4));
        const seaLo = g.seaLow ? 1 : g.crossLength - g.seaWidth + 2;
        const seaHi = g.seaLow ? g.seaWidth - 3 - sw : g.crossLength - 1 - sw;
        out.push({ id: id(1), edge, start: place(seaLo, seaHi, sw), width: sw, kind: "surf" });
      }
    } else if (layout === "river") {
      const r = k === 0 ? g.riverStart : g.riverEnd;
      const half = Math.ceil(g.riverWidth / 2);
      const w = walkWidth();
      // Walk entrance on whichever bank has more room at this end.
      const lowRoom = r - half - 2 - (bt + 2);
      const highRoom = g.crossLength - bt - 2 - (r + half + 2);
      const start = lowRoom >= highRoom ? place(bt + 2, r - half - 3 - w, w) : place(r + half + 3, g.crossLength - bt - 2 - w, w);
      out.push({ id: id(1), edge, start, width: w, kind: "walk" });
      if (p.surfEntrances) out.push({ id: id(1), edge, start: r - Math.floor(g.riverWidth / 2), width: g.riverWidth, kind: "surf" });
    } else {
      const sw = rng.int(4, 6);
      out.push({ id: id(1), edge, start: place(3, g.crossLength - 3 - sw, sw), width: sw, kind: "surf" });
    }
  });
  return out;
}

/** Convert (along, cross) to a cell index. */
function at(ctx: GenContext, g: Geometry, along: number, cross: number) {
  return g.vertical ? ctx.idx(cross, along) : ctx.idx(along, cross);
}

/** Lay down the layout's water (and beaches) before the path is planned. */
export function applyLayout(ctx: GenContext, g: Geometry): void {
  // Shapes come from the layout seed, not the attempt seed, so they stay put if Generate retries.
  const nz = new ValueNoise(new Rng(ctx.input.layoutSeed));
  if (ctx.layout === "coastal") coast(ctx, g, nz);
  else if (ctx.layout === "river") river(ctx, g, nz);
  else if (ctx.layout === "water") openWater(ctx, g, nz);
}

function sea(ctx: GenContext, i: number) {
  ctx.set(i, T.waterDeep, Role.Sea);
}

function coast(ctx: GenContext, g: Geometry, nz: ValueNoise) {
  const seaCells: number[] = [];
  for (let along = 0; along < g.alongLength; along++) {
    // A ragged shoreline: the sea's width wanders by a few cells along the route.
    const wobble = (nz.fractal(along * 1.0, 37.5, 9, 3) - 0.5) * 6;
    const reach = Math.round(g.seaWidth + wobble);
    for (let c = 0; c < reach; c++) {
      const cross = g.seaLow ? c : g.crossLength - 1 - c;
      const i = at(ctx, g, along, cross);
      sea(ctx, i);
      seaCells.push(i);
    }
  }
  beachAround(ctx, seaCells, 2);
}

/** Sand along the shore: 1–3 cells wide, wandering with noise (mud in wetland). */
export function beachAround(ctx: GenContext, waterCells: number[], baseWidth: number) {
  const dist = distanceField(ctx.width, ctx.height, waterCells);
  for (let i = 0; i < ctx.n; i++) {
    if (dist[i] === 0 || dist[i] === Infinity || ctx.role[i] !== Role.None) continue;
    const [x, y] = ctx.xy(i);
    const width = baseWidth + Math.round((ctx.noise.at(x * 0.35 + 500, y * 0.35) - 0.5) * 2);
    if (dist[i] <= width) ctx.set(i, ctx.biomeAt(i) === "wetland" ? T.mud : T.sand, Role.Beach);
  }
}

function river(ctx: GenContext, g: Geometry, nz: ValueNoise) {
  const start = at(ctx, g, 0, g.riverStart);
  const end = at(ctx, g, g.alongLength - 1, g.riverEnd);
  const margin = ctx.params.borderThickness + Math.ceil(g.riverWidth / 2) + 2;
  const line = cheapestPath(ctx.width, ctx.height, start, end, (i) => {
    const [x, y] = ctx.xy(i);
    const cross = g.vertical ? x : y;
    if (cross < margin || cross > g.crossLength - 1 - margin) return Infinity;
    if (ctx.locks[i]) return 30;
    return 1 + 4 * nz.fractal(x + 700, y + 300, 8, 2);
  });
  if (!line) return;
  const cells: number[] = [];
  for (const c of line) ctx.stamp(c, g.riverWidth, T.waterDeep, Role.Sea);
  for (let i = 0; i < ctx.n; i++)
    if (ctx.role[i] === Role.Sea) {
      cells.push(i);
      ctx.crossable[i] = 1;
    }
  // Short stretches of muddy or sandy bank.
  const dist = distanceField(ctx.width, ctx.height, cells);
  for (let i = 0; i < ctx.n; i++) {
    if (dist[i] !== 1 || ctx.role[i] !== Role.None) continue;
    const [x, y] = ctx.xy(i);
    const v = ctx.noise.at(x * 0.4 + 900, y * 0.4);
    if (v > 0.62) ctx.set(i, ctx.biomeAt(i) === "wetland" ? T.mud : T.sand, Role.Beach);
  }
}

function openWater(ctx: GenContext, g: Geometry, nz: ValueNoise) {
  const p = ctx.params;
  const surf = ctx.input.openings.filter((o) => o.kind === "surf");
  // A guaranteed surfing lane between the first two surf entrances, kept clear of islands.
  const lane = new Uint8Array(ctx.n);
  const centre = (o: Opening) => {
    const along = o.start + Math.floor(o.width / 2);
    if (o.edge === "north") return ctx.idx(along, 0);
    if (o.edge === "south") return ctx.idx(along, ctx.height - 1);
    if (o.edge === "west") return ctx.idx(0, along);
    return ctx.idx(ctx.width - 1, along);
  };
  if (surf.length >= 2) {
    const line = cheapestPath(ctx.width, ctx.height, centre(surf[0]), centre(surf[1]), (i) => {
      const [x, y] = ctx.xy(i);
      return ctx.locks[i] ? 30 : 1 + 4 * nz.fractal(x + 1100, y + 1300, 9, 2);
    });
    if (line) {
      ctx.mainLine = line;
      for (const c of line) {
        const [cx, cy] = ctx.xy(c);
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (ctx.inside(cx + dx, cy + dy)) lane[ctx.idx(cx + dx, cy + dy)] = 1;
      }
    }
  }
  // Islands: the highest points of a noise field, away from the lane and the map edge.
  const candidates: Array<{ i: number; v: number }> = [];
  for (let i = 0; i < ctx.n; i++) {
    if (lane[i] || ctx.edgeDist(i) < 2 || ctx.locks[i]) continue;
    const [x, y] = ctx.xy(i);
    candidates.push({ i, v: nz.fractal(x + 1500, y + 1700, 11, 2) });
  }
  candidates.sort((a, b) => b.v - a.v || a.i - b.i);
  const landShare = 0.12 + 0.25 * (1 - p.water);
  const island = new Uint8Array(ctx.n);
  for (let k = 0; k < Math.round(ctx.n * landShare) && k < candidates.length; k++) island[candidates[k].i] = 1;
  // Smooth the coastlines: no one-cell spits or inlets.
  for (let pass = 0; pass < 2; pass++) {
    const next = island.slice();
    for (let i = 0; i < ctx.n; i++) {
      if (lane[i] || ctx.edgeDist(i) < 2) continue;
      const [x, y] = ctx.xy(i);
      let count = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (ctx.inside(x + dx, y + dy) && island[ctx.idx(x + dx, y + dy)]) count++;
      next[i] = count >= 5 ? 1 : 0;
    }
    island.set(next);
  }
  for (let i = 0; i < ctx.n; i++) if (!island[i]) sea(ctx, i);
  // Tiny islands become water again.
  const comps = new Map<number, number[]>();
  const seen = new Uint8Array(ctx.n);
  for (let i = 0; i < ctx.n; i++) {
    if (!island[i] || seen[i]) continue;
    const stack = [i];
    const cells: number[] = [];
    seen[i] = 1;
    while (stack.length) {
      const c = stack.pop()!;
      cells.push(c);
      const [x, y] = ctx.xy(c);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (!ctx.inside(x + dx, y + dy)) continue;
        const j = ctx.idx(x + dx, y + dy);
        if (island[j] && !seen[j]) {
          seen[j] = 1;
          stack.push(j);
        }
      }
    }
    comps.set(i, cells);
  }
  for (const cells of comps.values()) if (cells.length < 16) for (const c of cells) sea(ctx, c);
  const allWater: number[] = [];
  for (let i = 0; i < ctx.n; i++) if (ctx.role[i] === Role.Sea) allWater.push(i);
  beachAround(ctx, allWater, 1);
}
