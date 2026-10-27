// Elevation: raised plateaus, like Hoenn's routes.
//
// A plateau is a raised area ringed by a cliff (rock wall). Stairs in the rim
// lead up; parts of the south rim (and sometimes the east or west rim) are
// ledges, so the player can jump back down. The interior is ordinary ground,
// grass and trees, one level up. At high elevation settings a smaller second
// plateau can sit on top of a big one.
//
// The "Elevation" setting controls how many plateaus there are and how big.

import { DIRS, T, components } from "../grid";
import type { GenContext } from "./context";
import { LEVEL, Role } from "./context";

export function addPlateaus(ctx: GenContext): void {
  const amount = ctx.params.elevation;
  if (amount <= 0 || ctx.layout === "water") return;
  const area = ctx.width * ctx.height;
  const count = Math.max(1, Math.round(amount * (area / 700)));
  // Cells too close to entrances stay flat, so every entrance starts on the ground.
  const nearEntrance = new Uint8Array(ctx.n);
  for (const o of ctx.input.openings) {
    for (let k = -4; k < o.width + 4; k++)
      for (let d = 0; d < 9; d++) {
        const along = o.start + k;
        let x: number, y: number;
        if (o.edge === "north") [x, y] = [along, d];
        else if (o.edge === "south") [x, y] = [along, ctx.height - 1 - d];
        else if (o.edge === "west") [x, y] = [d, along];
        else [x, y] = [ctx.width - 1 - d, along];
        if (ctx.inside(x, y)) nearEntrance[ctx.idx(x, y)] = 1;
      }
  }
  const eligible = (i: number) =>
    !nearEntrance[i] && ctx.role[i] === Role.None && !ctx.locks[i] && ctx.elevation[i] === LEVEL.ground && ctx.edgeDist(i) >= ctx.params.borderThickness + 1;

  for (let k = 0; k < count; k++) {
    const big = 3 + amount * 5;
    const rx = ctx.rng.range(big * 0.7, big * 1.3);
    const ry = ctx.rng.range(big * 0.6, big * 1.1);
    for (let attempt = 0; attempt < 25; attempt++) {
      const c = ctx.rng.int(0, ctx.n - 1);
      if (!eligible(c)) continue;
      const cells = blob(ctx, c, rx, ry, eligible);
      if (cells && buildPlateau(ctx, cells, LEVEL.raised1)) {
        // A second tier on top of large plateaus when elevation is high.
        if (amount > 0.6 && cells.length > 90) {
          const inner = cells.filter((i) => ctx.role[i] === Role.None && ctx.elevation[i] === LEVEL.raised1);
          const top = inner.length ? inner[Math.floor(inner.length / 2)] : -1;
          const onTop = (i: number) => ctx.role[i] === Role.None && ctx.elevation[i] === LEVEL.raised1 && !ctx.locks[i];
          const second = top >= 0 ? blob(ctx, top, rx * 0.45, ry * 0.45, onTop) : null;
          if (second) buildPlateau(ctx, second, LEVEL.raised2);
        }
        break;
      }
    }
  }
}

/** A noisy ellipse of eligible cells around a centre, or null if it doesn't fit. */
function blob(ctx: GenContext, centre: number, rx: number, ry: number, eligible: (i: number) => boolean): number[] | null {
  const [cx, cy] = ctx.xy(centre);
  const cells: number[] = [];
  const inShape = new Uint8Array(ctx.n);
  for (let y = Math.floor(cy - ry - 2); y <= cy + ry + 2; y++)
    for (let x = Math.floor(cx - rx - 2); x <= cx + rx + 2; x++) {
      if (!ctx.inside(x, y)) continue;
      const i = ctx.idx(x, y);
      const d = Math.hypot((x - cx) / rx, (y - cy) / ry) + (ctx.noise.at(x * 0.45 + 2000, y * 0.45) - 0.5) * 0.5;
      if (d <= 1) {
        if (!eligible(i)) return null;
        inShape[i] = 1;
      }
    }
  // Keep the largest connected piece, then smooth away thin spurs.
  const comp = components(ctx.width, ctx.height, (i) => inShape[i] === 1);
  let best = -1;
  comp.sizes.forEach((s, id) => (best < 0 || s > comp.sizes[best] ? (best = id) : 0));
  for (let i = 0; i < ctx.n; i++) if (inShape[i] && comp.ids[i] === best) cells.push(i);
  const set = new Set(cells);
  for (let pass = 0; pass < 3; pass++) {
    let changed = false;
    for (const i of [...set]) {
      const [x, y] = ctx.xy(i);
      for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const diag = ctx.inside(x + dx, y + dy) ? ctx.idx(x + dx, y + dy) : -1;
        if (diag < 0 || !set.has(diag)) continue;
        const a = ctx.idx(x + dx, y);
        const b = ctx.idx(x, y + dy);
        // Diagonal neighbours with both shared sides missing: fill one side in.
        if (!set.has(a) && !set.has(b)) {
          const add = eligible(a) ? a : eligible(b) ? b : -1;
          if (add < 0) return null;
          set.add(add);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  cells.length = 0;
  cells.push(...set);
  const solid = cells.filter((i) => {
    const [x, y] = ctx.xy(i);
    return DIRS.filter(({ dx, dy }) => set.has(ctx.idx(x + dx, y + dy))).length >= 2;
  });
  if (solid.length < 30) return null;
  // Never span the route's width: there must always be low ground beside a plateau to walk past it.
  const xs = solid.map((i) => i % ctx.width);
  const ys = solid.map((i) => Math.floor(i / ctx.width));
  const crossSpan = ctx.vertical ? Math.max(...xs) - Math.min(...xs) + 1 : Math.max(...ys) - Math.min(...ys) + 1;
  const crossLength = ctx.vertical ? ctx.width : ctx.height;
  if (crossSpan > crossLength - 2 * ctx.params.borderThickness - 8) return null;
  return solid;
}

/** Turn a set of cells into a plateau at `level`. Returns false if it's too thin. */
function buildPlateau(ctx: GenContext, cells: number[], level: number): boolean {
  const inside = new Set(cells);
  const isIn = (x: number, y: number) => ctx.inside(x, y) && inside.has(ctx.idx(x, y));
  // The rim: plateau cells with any outside neighbour, including diagonals, so the cliff has no gaps.
  const rim: number[] = [];
  const interior: number[] = [];
  for (const i of cells) {
    const [x, y] = ctx.xy(i);
    let edge = false;
    for (let dy = -1; dy <= 1 && !edge; dy++) for (let dx = -1; dx <= 1; dx++) if (!isIn(x + dx, y + dy)) edge = true;
    (edge ? rim : interior).push(i);
  }
  if (interior.length < 12) return false;

  for (const i of cells) ctx.elevation[i] = level;
  for (const i of rim) ctx.set(i, T.rockWall, Role.Cliff);
  // The top is mostly open ground (grass grows there later), with a few clumps of trees.
  for (const i of interior) {
    const [x, y] = ctx.xy(i);
    if (ctx.noise.at(x * 0.4 + 4000, y * 0.4) < 0.68) ctx.role[i] = Role.Clearing;
  }

  // Which way each rim cell faces: the side where the low ground is.
  const facing = (i: number) => {
    const [x, y] = ctx.xy(i);
    const outside = DIRS.filter(({ dx, dy }) => !isIn(x + dx, y + dy));
    const inner = DIRS.filter(({ dx, dy }) => isIn(x + dx, y + dy) && interior.includes(ctx.idx(x + dx, y + dy)));
    // A clean straight edge: exactly one outside side and the opposite side is interior.
    if (outside.length !== 1) return null;
    const out = outside[0];
    if (!inner.some((d) => d.dx === -out.dx && d.dy === -out.dy)) return null;
    const ox = x + out.dx;
    const oy = y + out.dy;
    if (!ctx.inside(ox, oy)) return null;
    const below = ctx.idx(ox, oy);
    // The cell outside must be open low ground the player can use (not sea, not another cliff).
    if (ctx.role[below] === Role.Sea || ctx.role[below] === Role.Cliff || ctx.locks[below]) return null;
    return out;
  };

  // Stairs: one or two places in the rim, preferring the north, east and west faces.
  const stairSpots = ctx.rng.shuffle(rim.filter((i) => facing(i) !== null)).sort((a, b) => Number(facing(a)!.dir === "s") - Number(facing(b)!.dir === "s"));
  const stairsWanted = cells.length > 120 ? 2 : 1;
  const placed: number[] = [];
  for (const i of stairSpots) {
    if (placed.length >= stairsWanted) break;
    const [x, y] = ctx.xy(i);
    if (placed.some((p) => {
      const [px, py] = ctx.xy(p);
      return Math.abs(px - x) + Math.abs(py - y) < 8;
    }))
      continue;
    const f = facing(i)!;
    ctx.set(i, T.stairs, Role.Stairs);
    // Keep the cells in front of and behind the stairs open.
    const front = ctx.idx(x + f.dx, y + f.dy);
    const back = ctx.idx(x - f.dx, y - f.dy);
    for (const c of [front, back]) if (!ctx.locks[c]) ctx.set(c, T.ground, Role.Stairs);
    placed.push(i);
  }
  if (!placed.length) {
    // No way up: undo the cliff so the area stays reachable.
    for (const i of rim) {
      ctx.set(i, T.tree, Role.None);
      ctx.role[i] = Role.None;
    }
    for (const i of cells) ctx.elevation[i] = level === LEVEL.raised2 ? LEVEL.raised1 : LEVEL.ground;
    return false;
  }

  // Ledges: runs of the south face (sometimes east or west) become one-way drops.
  const ledgeFor: Record<string, number> = { s: T.ledgeS, e: T.ledgeE, w: T.ledgeW };
  for (const dir of ["s", "e", "w"] as const) {
    if (dir !== "s" && !ctx.rng.chance(0.35)) continue;
    const face = rim.filter((i) => ctx.terrain[i] === T.rockWall && facing(i)?.dir === dir);
    for (const i of face) {
      const [x, y] = ctx.xy(i);
      // Long runs, with gaps of plain cliff between them (noise decides).
      if (ctx.noise.at(x * 0.3 + 3000, y * 0.3) > 0.42) ctx.set(i, ledgeFor[dir], Role.Cliff);
    }
  }
  return true;
}
