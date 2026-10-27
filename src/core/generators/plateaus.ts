// Elevation: raised plateaus, like Hoenn's routes.
//
// A plateau is a raised area ringed by a cliff (rock wall). Stairs in the rim
// lead up; parts of the south rim (and sometimes the east or west rim) are
// ledges, so the player can jump back down. The interior is ordinary ground,
// grass and trees, one level up.
//
// Every route with Elevation above 0 gets hillsides: stretches of ground along
// the sides of the route rise in terraces toward the map edge, leaving a valley
// floor for the path. They fit even the narrowest route size. Higher settings
// give longer stretches and more levels (up to 3); wide routes also get
// free-standing plateaus out in the middle.
//
// Alpine routes are mountains: the ground on both sides rises the whole length
// of the route, up to 4 levels (Porymap elevations 4–7).
//
// The stairs of each terrace sit away from the stairs below, so a climb switches
// back and forth. Coastal and river routes measure their hills from the shore.
// Alpine routes count as more mountainous (see effectiveElevation).
// With a travel direction the hillsides are low near the start and rise toward
// the end, so the route climbs as the player goes.

import { DIRS, T, components, distanceField } from "../grid";
import type { GenContext } from "./context";
import { LEVEL, RAISED, Role } from "./context";
import { effectiveElevation } from "./params";
import { backDir, progress } from "./travel";

export function addPlateaus(ctx: GenContext): void {
  const amount = effectiveElevation(ctx.params, ctx.input.biome);
  if (amount <= 0 || ctx.layout === "water") return;
  const alpine = ctx.input.biome === "alpine";
  const crossLength = ctx.vertical ? ctx.width : ctx.height;
  // Cells too close to entrances stay flat, so every entrance starts on the ground.
  // Entrances in a long side get a flat way all the way to the middle of the route.
  const nearEntrance = new Uint8Array(ctx.n);
  for (const o of ctx.input.openings) {
    const side = ctx.vertical ? o.edge === "east" || o.edge === "west" : o.edge === "north" || o.edge === "south";
    const depth = side ? Math.ceil(crossLength / 2) + 2 : 9;
    for (let k = -4; k < o.width + 4; k++)
      for (let d = 0; d < depth; d++) {
        const along = o.start + k;
        let x: number, y: number;
        if (o.edge === "north") [x, y] = [along, d];
        else if (o.edge === "south") [x, y] = [along, ctx.height - 1 - d];
        else if (o.edge === "west") [x, y] = [d, along];
        else [x, y] = [ctx.width - 1 - d, along];
        if (ctx.inside(x, y)) nearEntrance[ctx.idx(x, y)] = 1;
      }
  }
  // Separate plateaus keep a cell of ground inside the border; terraces run right up to it.
  const eligibleFrom = (edge: number) => (i: number) =>
    !nearEntrance[i] && ctx.role[i] === Role.None && !ctx.locks[i] && ctx.elevation[i] === LEVEL.ground && ctx.edgeDist(i) >= edge;
  const bt = ctx.params.borderThickness;
  // If no stretch of hillside came out (small maps, low settings), widen the hilly stretches and try again.
  for (let more = 0; more < 3; more++) if (addTerraces(ctx, amount, eligibleFrom(bt), alpine, more * 0.2) > 0) break;
  // Wide routes also get free-standing plateaus out in the middle.
  if (!alpine && crossLength >= 34) addSeparatePlateaus(ctx, amount, eligibleFrom(bt + 1));
}

/** Where a level may be built on top of the level below: away from its stairs, and two cells from
 *  its cliff edge, so the ledge of ground left between the two cliffs is 2 cells wide. */
function onTopOf(ctx: GenContext, level: number) {
  return (i: number) =>
    ctx.elevation[i] === level &&
    !ctx.locks[i] &&
    (ctx.role[i] === Role.None || ctx.role[i] === Role.Clearing) &&
    !nearRole(ctx, i, Role.Cliff, 2) &&
    !nearRole(ctx, i, Role.Stairs, 2);
}

/** Separate plateaus along the route, sometimes with a second level on top. */
function addSeparatePlateaus(ctx: GenContext, amount: number, eligible: (i: number) => boolean) {
  const count = Math.max(1, Math.round(amount * ((ctx.width * ctx.height) / 700)));
  // The setting each extra level needs.
  const tiers = [0, 0.6, 0.9];
  for (let k = 0; k < count; k++) {
    const big = 3 + amount * 5;
    const wantCross = ctx.rng.range(big * 0.7, big * 1.2);
    const along = ctx.rng.range(big * 0.8, big * 1.2);
    for (let attempt = 0; attempt < 25; attempt++) {
      const c = ctx.rng.int(0, ctx.n - 1);
      if (!eligible(c)) continue;
      // Size it to the open land across the route at this spot (less on coasts
      // and rivers), keeping 8 cells free to walk past.
      const cross = Math.min(wantCross, (crossRun(ctx, c, eligible) - 8) / 2 - 0.5);
      if (cross < 3) continue;
      const cells = blob(ctx, c, ctx.vertical ? cross : along, ctx.vertical ? along : cross, eligible);
      const stairs = cells ? buildPlateau(ctx, cells, RAISED[0], []) : null;
      if (!stairs) continue;
      // Higher levels, each smaller and on top of the one below.
      let below = cells!;
      let belowStairs = stairs;
      for (let t = 1; t < tiers.length && amount > tiers[t]; t++) {
        const onTop = onTopOf(ctx, RAISED[t - 1]);
        const tops = below.filter(onTop);
        if (tops.length < 30) break;
        // Centre it where the level below is widest, sized to fit inside.
        const runs = tops.map((i) => crossRun(ctx, i, onTop));
        const widest = Math.max(...runs);
        const centres = tops.filter((_, j) => runs[j] >= widest - 1);
        let next: number[] | null = null;
        let nextStairs: number[] | null = null;
        for (let tries = 0; tries < 8 && !nextStairs; tries++) {
          const centre = centres[Math.floor(((tries + 0.5) / 8) * centres.length)];
          const r = Math.min(cross * 0.7 ** t, widest / 2 - 0.8 - tries * 0.15);
          if (r < 2.6) break;
          const a = along * 0.65 ** t * (1 - tries * 0.06);
          next = blob(ctx, centre, ctx.vertical ? r : a, ctx.vertical ? a : r, onTop);
          nextStairs = next ? buildPlateau(ctx, next, RAISED[t], belowStairs) : null;
        }
        if (!nextStairs) break;
        below = next!;
        belowStairs = nextStairs;
      }
      break;
    }
  }
}

/**
 * Hillsides and terraces. A height is worked out for every cell: zero along a
 * valley down the middle of the route, rising toward the map edges, with noise
 * so the valley wanders and the hillsides are uneven. Each whole step of height
 * is one more level. Every terrace is built like a plateau (cliff rim, stairs,
 * ledges), with each level inside the one below, leaning against the border.
 *
 * Alpine routes rise along their whole length, up to 4 levels. Other routes get
 * hills along stretches of each side (more and higher with the Elevation
 * setting, up to 3 levels), so they work on narrow routes too.
 */
function addTerraces(ctx: GenContext, amount: number, eligible: (i: number) => boolean, alpine: boolean, widen = 0): number {
  const bt = ctx.params.borderThickness;
  const crossLength = ctx.vertical ? ctx.width : ctx.height;
  const alongLength = ctx.vertical ? ctx.height : ctx.width;
  // On coastal and river routes the low ground runs along the water, so hills are
  // measured from the shore, and only the land counts as room for them.
  // (Only the layout's own sea or river counts: water zones elsewhere don't reshape the hills.)
  const sea: number[] = [];
  if (ctx.layout === "coastal" || ctx.layout === "river") for (let i = 0; i < ctx.n; i++) if (ctx.role[i] === Role.Sea) sea.push(i);
  const fromSea = sea.length ? distanceField(ctx.width, ctx.height, sea) : null;
  let halfOpen = (crossLength - 2 * bt) / 2;
  if (fromSea) {
    let land = 0;
    for (let i = 0; i < ctx.n; i++) if (ctx.role[i] !== Role.Sea && ctx.edgeDist(i) >= bt) land++;
    halfOpen = land / alongLength / (ctx.layout === "river" ? 2 : 1);
  }
  const maxLevel = alpine ? (amount > 0.7 ? 4 : amount > 0.45 ? 3 : amount > 0.2 ? 2 : 1) : amount > 0.75 ? 3 : amount > 0.4 ? 2 : 1;
  // Half-width of the valley floor (always room for the path), and the width of each
  // terrace step (a cliff, then a ledge of ground at least 2 wide).
  const floor = Math.max(3, ctx.params.pathWidthMax + (amount > 0.7 ? 0 : 1));
  const valley = Math.max(floor, halfOpen * (alpine ? 0.6 - 0.35 * amount : 0.7 - 0.35 * amount));
  const step = Math.max(3, (halfOpen - valley) / maxLevel);
  const centre = (crossLength - 1) / 2;
  // Only some stretches of each side are hills: more of them at higher settings.
  // Alpine mountains run almost the whole route, with a few low gaps at low settings.
  const cut = (alpine ? 0.5 - 0.6 * amount : 0.85 - 0.75 * amount) - widen;

  const height = new Float32Array(ctx.n);
  for (let i = 0; i < ctx.n; i++) {
    const [x, y] = ctx.xy(i);
    const across = ctx.vertical ? x : y;
    const along = ctx.vertical ? y : x;
    const side = across < centre ? 0 : 1;
    // The valley wanders, and each side rises at its own pace.
    const wander = (ctx.noise.at(along * 0.05 + 6100, 0.5) - 0.5) * valley;
    const offset = fromSea ? fromSea[i] - 1 : Math.abs(across - centre - wander);
    const bumps = (ctx.noise.fractal(x + 6300 + side * 400, y + 6700, 9, 3) - 0.5) * 1.4;
    // Ends of the route (near the entrances) stay lower.
    const ends = Math.min(along, alongLength - 1 - along) < 6 ? -1 : 0;
    const hills = Math.min(0, (ctx.noise.at(along * 0.07 + 7100 + side * 311, side * 7.3) - cut) * 8);
    // With a travel direction: about one level lower than usual at the start, one higher at the end.
    const climb = ctx.travel ? (progress(ctx.travel, x, y, ctx.width, ctx.height) - 0.5) * 2 : 0;
    // The valley floor itself always stays low.
    height[i] = offset < valley ? 0 : (offset - valley) / step + 1 + bumps + ends + hills + climb;
  }

  // Build level by level. Each terrace is one connected piece of high-enough ground.
  let stairsBelow: number[] = [];
  let terraces = 0;
  for (let level = 1; level <= maxLevel; level++) {
    const ok = level === 1 ? eligible : onTopOf(ctx, RAISED[level - 2]);
    const high = new Uint8Array(ctx.n);
    for (let i = 0; i < ctx.n; i++) if (height[i] >= level && ok(i)) high[i] = 1;
    const comp = components(ctx.width, ctx.height, (i) => high[i] === 1);
    const pieces: number[][] = comp.sizes.map(() => []);
    for (let i = 0; i < ctx.n; i++) if (high[i]) pieces[comp.ids[i]].push(i);
    const built: number[] = [];
    for (const piece of pieces) {
      if (piece.length < 30) continue;
      const cells = tidy(ctx, piece, ok, false);
      const stairs = cells ? buildPlateau(ctx, cells, RAISED[level - 1], stairsBelow, true) : null;
      if (stairs) {
        built.push(...stairs);
        terraces++;
      }
    }
    if (!built.length) break;
    stairsBelow = built;
  }
  return terraces;
}

/** How many eligible cells in a row run across the route through a cell. */
function crossRun(ctx: GenContext, c: number, eligible: (i: number) => boolean): number {
  const [x, y] = ctx.xy(c);
  const [dx, dy] = ctx.vertical ? [1, 0] : [0, 1];
  let run = 1;
  for (const sign of [1, -1])
    for (let k = 1; ctx.inside(x + sign * k * dx, y + sign * k * dy) && eligible(ctx.idx(x + sign * k * dx, y + sign * k * dy)); k++) run++;
  return run;
}

/** True if a cell within `r` steps (square) has this role. */
function nearRole(ctx: GenContext, i: number, role: number, r: number): boolean {
  const [x, y] = ctx.xy(i);
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) if (ctx.inside(x + dx, y + dy) && ctx.role[ctx.idx(x + dx, y + dy)] === role) return true;
  return false;
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
  for (let i = 0; i < ctx.n; i++) if (inShape[i]) cells.push(i);
  return tidy(ctx, cells, eligible, true);
}

/**
 * Clean up a plateau shape: keep its largest connected piece, fill diagonal-only
 * joins, and drop one-cell spurs. With `spanCheck`, refuse shapes that would
 * stretch across the route. Returns null if what's left is too small.
 */
function tidy(ctx: GenContext, shape: number[], eligible: (i: number) => boolean, spanCheck: boolean): number[] | null {
  const inShape = new Uint8Array(ctx.n);
  for (const i of shape) inShape[i] = 1;
  const cells: number[] = [];
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
  if (!spanCheck) return solid;
  // Never span the route's width: there must always be low ground beside a plateau to walk past it.
  const xs = solid.map((i) => i % ctx.width);
  const ys = solid.map((i) => Math.floor(i / ctx.width));
  const crossSpan = ctx.vertical ? Math.max(...xs) - Math.min(...xs) + 1 : Math.max(...ys) - Math.min(...ys) + 1;
  const crossLength = ctx.vertical ? ctx.width : ctx.height;
  if (crossSpan > crossLength - 2 * ctx.params.borderThickness - 8) return null;
  return solid;
}

/**
 * Turn a set of cells into a plateau at `level`. Returns its stairs, or null if it's
 * too thin or has no room for stairs. Stairs go as far as possible from `avoid`
 * (the stairs of the level below), so a climb over several tiers switches back.
 * With `againstBorder`, the map's border counts as part of the plateau, so there's
 * no cliff along that side (alpine terraces rise straight into the mountains).
 */
function buildPlateau(ctx: GenContext, cells: number[], level: number, avoid: number[], againstBorder = false): number[] | null {
  const inside = new Set(cells);
  // Terraces lean against the border wall: no cliff is needed on that side.
  const bt = ctx.params.borderThickness;
  const isIn = (x: number, y: number) =>
    againstBorder && (!ctx.inside(x, y) || ctx.edgeDist(ctx.idx(x, y)) < bt) ? true : ctx.inside(x, y) && inside.has(ctx.idx(x, y));
  // The rim: plateau cells with any outside neighbour, including diagonals, so the cliff has no gaps.
  const rim: number[] = [];
  const interior: number[] = [];
  for (const i of cells) {
    const [x, y] = ctx.xy(i);
    let edge = false;
    for (let dy = -1; dy <= 1 && !edge; dy++) for (let dx = -1; dx <= 1; dx++) if (!isIn(x + dx, y + dy)) edge = true;
    (edge ? rim : interior).push(i);
  }
  if (interior.length < 12) return null;

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
    if (ctx.role[below] === Role.Sea || ctx.role[below] === Role.Cliff || ctx.role[below] === Role.Border || ctx.role[below] === Role.Keep || ctx.locks[below]) return null;
    // …and not where the border wall will go.
    if (ctx.edgeDist(below) < ctx.params.borderThickness + 1) return null;
    return out;
  };

  // Stairs: one or two places in the rim, preferring the north, east and west faces.
  const farFromBelow = (i: number) => {
    const [x, y] = ctx.xy(i);
    return avoid.length ? Math.min(...avoid.map((a) => Math.abs((a % ctx.width) - x) + Math.abs(Math.floor(a / ctx.width) - y))) : 0;
  };
  const stairSpots = ctx.rng
    .shuffle(rim.filter((i) => facing(i) !== null))
    .map((i) => ({ i, south: facing(i)!.dir === "s", far: farFromBelow(i) }))
    .sort((a, b) => (avoid.length ? b.far - a.far : Number(a.south) - Number(b.south)))
    .map((s) => s.i);
  const stairsWanted = Math.min(4, 1 + Math.floor(cells.length / 120));
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
    ctx.stairs.push({ cell: i, front, back });
    placed.push(i);
  }
  if (!placed.length) {
    // No way up: undo the cliff so the area stays reachable.
    for (const i of rim) {
      ctx.set(i, T.tree, Role.None);
      ctx.role[i] = Role.None;
    }
    const k = RAISED.indexOf(level);
    for (const i of cells) ctx.elevation[i] = k > 0 ? RAISED[k - 1] : LEVEL.ground;
    return null;
  }

  // Ledges: runs of the south face (sometimes east or west) become one-way drops.
  // On a route travelled east or west, no drop faces the way forward (they're for coming back).
  const back = ctx.travel && !ctx.vertical ? backDir(ctx.travel) : null;
  const ledgeFor: Record<string, number> = { s: T.ledgeS, e: T.ledgeE, w: T.ledgeW };
  for (const dir of ["s", "e", "w"] as const) {
    if (dir !== "s" && !ctx.rng.chance(0.7)) continue;
    if (back && dir !== "s" && dir !== back) continue;
    const face = rim.filter((i) => ctx.terrain[i] === T.rockWall && facing(i)?.dir === dir);
    for (const i of face) {
      const [x, y] = ctx.xy(i);
      // Long runs, with gaps of plain cliff between them (noise decides).
      if (ctx.noise.at(x * 0.3 + 3000, y * 0.3) > 0.42) ctx.set(i, ledgeFor[dir], Role.Cliff);
    }
  }
  return placed;
}

/**
 * Make sure every flight of stairs can be reached: lay a narrow trail from the
 * foot of each flight to the nearest path on the same level (the main path,
 * a branch, or the top of the flight below). Lower levels go first, so a climb
 * over several terraces joins up flight by flight.
 */
export function connectStairs(ctx: GenContext): void {
  const trailRoles = new Set<number>([Role.MainPath, Role.Branch, Role.Opening, Role.Bridge]);
  const flights = [...ctx.stairs].sort((a, b) => levelRank(ctx.elevation[a.front]) - levelRank(ctx.elevation[b.front]));
  const tops: number[] = [];
  for (const f of flights) {
    if (ctx.terrain[f.cell] !== T.stairs) continue;
    const level = ctx.elevation[f.front];
    const sources: number[] = [];
    for (let i = 0; i < ctx.n; i++) if (ctx.elevation[i] === level && trailRoles.has(ctx.role[i])) sources.push(i);
    for (const t of tops) if (ctx.elevation[t] === level) sources.push(t);
    const passable = (i: number) =>
      ctx.elevation[i] === level &&
      !ctx.locks[i] &&
      ctx.edgeDist(i) >= ctx.params.borderThickness &&
      ctx.role[i] !== Role.Cliff &&
      ctx.role[i] !== Role.Border &&
      ctx.role[i] !== Role.Sea &&
      ctx.role[i] !== Role.Pocket &&
      (ctx.role[i] !== Role.Stairs || i === f.front || tops.includes(i));
    const dist = distanceField(ctx.width, ctx.height, sources, passable);
    if (dist[f.front] === Infinity) continue;
    // Walk downhill from the foot of the stairs to the nearest path, paving as we go.
    let c = f.front;
    while (dist[c] > 0) {
      const [x, y] = ctx.xy(c);
      let next = -1;
      for (const { dx, dy } of DIRS) {
        if (!ctx.inside(x + dx, y + dy)) continue;
        const j = ctx.idx(x + dx, y + dy);
        if (dist[j] < dist[c] && (next < 0 || dist[j] < dist[next])) next = j;
      }
      if (next < 0) break;
      c = next;
      // As wide as the narrowest path setting, where the ground allows.
      if (dist[c] > 0) ctx.stamp(c, ctx.params.pathWidthMin, T.path, Role.Branch, (j) => passable(j) && ctx.role[j] !== Role.Stairs && ctx.role[j] !== Role.Opening);
    }
    tops.push(f.back);
  }
}

function levelRank(level: number): number {
  return level === LEVEL.ground || level === LEVEL.water ? 0 : RAISED.indexOf(level) + 1;
}
