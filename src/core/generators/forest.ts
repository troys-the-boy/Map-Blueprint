// The forest generator (Milestone 5, part B), like Petalburg Woods: a maze of
// paths through dense forest.
//
//   1. Dense forest everywhere, the entrances carved through the border.
//   2. A maze on a coarse grid of junctions (a "growing tree" maze): the Maze
//      density setting picks how often it carries on from the newest junction
//      (long winding ways, long dead ends) rather than a random one (more,
//      shorter side paths). Low settings also add a few loops.
//   3. Each entrance joins the maze; the way between the entrances is the main
//      path (trainers watch it), the rest are side paths ending in dead ends.
//   4. The walls are roughened so the paths don't look ruled, clearings open at
//      some junctions, and long grass grows along the paths.
//   5. The edge of the dense forest is drawn as single trees.
//
// The biome sets the look: wetland clearings hold pools and mud, meadow forests
// grow tall grass instead of long grass, alpine ones have snowy grass and outcrops of rock.

import { DIRS, IS_WALKABLE, T, cheapestPath } from "../grid";
import type { GenContext } from "./context";
import { Role } from "./context";
import { carveOpening } from "./routeSkeleton";
import { cleanup } from "./cleanup";

export function buildForest(ctx: GenContext): void {
  const fp = ctx.input.forest!;
  const p = ctx.params;
  const bt = p.borderThickness;
  const biome = ctx.input.biome;

  // 1. Dense forest, and the entrances.
  for (let i = 0; i < ctx.n; i++) if (!ctx.locks[i]) ctx.set(i, T.denseForest, ctx.edgeDist(i) < bt ? Role.Border : Role.None);
  const ends = ctx.input.openings.map((o) => ({ o, end: carveOpening(ctx, o) }));
  ctx.openingEnds = ends.filter((e) => e.o.kind === "walk").map((e) => e.end);

  // 2. The maze. Junctions are cw×cw squares; walls between them are 2 thick.
  const cw = Math.max(1, Math.min(3, p.pathWidthMin));
  const step = cw + 2;
  const m = bt + 1;
  const gx = Math.floor((ctx.width - 2 * m - cw) / step) + 1;
  const gy = Math.floor((ctx.height - 2 * m - cw) / step) + 1;
  const open = (i: number) => !ctx.locks[i] && ctx.role[i] !== Role.Border;
  const pave = (i: number, role: Role) => {
    if (open(i) || (ctx.locks[i] && IS_WALKABLE[ctx.terrain[i]])) ctx.set(i, T.ground, role);
  };
  if (gx < 2 || gy < 2) {
    // Too small for a maze: just join the entrances.
    for (let k = 1; k < ctx.openingEnds.length; k++) {
      const leg = cheapestPath(ctx.width, ctx.height, ctx.openingEnds[0], ctx.openingEnds[k], (i) => (open(i) ? 1 : Infinity));
      for (const c of leg ?? []) ctx.stamp(c, cw, T.ground, Role.MainPath, open);
    }
    return;
  }
  const node = (a: number, b: number) => a + b * gx;
  const nodeXY = (k: number): [number, number] => [m + (k % gx) * step, m + Math.floor(k / gx) * step];
  const nodeCentre = (k: number) => {
    const [x, y] = nodeXY(k);
    return ctx.idx(x + Math.floor(cw / 2), y + Math.floor(cw / 2));
  };
  const nearestNode = (cell: number) => {
    const [x, y] = ctx.xy(cell);
    let best = 0;
    let bestD = Infinity;
    for (let k = 0; k < gx * gy; k++) {
      const [nx, ny] = nodeXY(k);
      const d = Math.abs(nx - x) + Math.abs(ny - y);
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
    return best;
  };
  const neighbours = (k: number) => {
    const a = k % gx;
    const b = Math.floor(k / gx);
    const out: number[] = [];
    if (a > 0) out.push(node(a - 1, b));
    if (a < gx - 1) out.push(node(a + 1, b));
    if (b > 0) out.push(node(a, b - 1));
    if (b < gy - 1) out.push(node(a, b + 1));
    return out;
  };
  const links = new Map<number, Set<number>>();
  const link = (a: number, b: number) => {
    (links.get(a) ?? links.set(a, new Set()).get(a)!).add(b);
    (links.get(b) ?? links.set(b, new Set()).get(b)!).add(a);
  };
  const start = nearestNode(ctx.openingEnds[0] ?? ctx.idx(ctx.width >> 1, ctx.height >> 1));
  const visited = new Uint8Array(gx * gy);
  visited[start] = 1;
  const stack = [start];
  while (stack.length) {
    const at = ctx.rng.chance(fp.mazeDensity) ? stack.length - 1 : ctx.rng.int(0, stack.length - 1);
    const k = stack[at];
    const next = ctx.rng.shuffle(neighbours(k).filter((n) => !visited[n]));
    if (!next.length) {
      stack.splice(at, 1);
      continue;
    }
    visited[next[0]] = 1;
    link(k, next[0]);
    stack.push(next[0]);
  }
  // Loops: an open forest has a few ways round; a dense maze has none.
  const loops = Math.round((1 - fp.mazeDensity) * 0.25 * gx * gy);
  for (let t = 0; t < loops * 4 && loops > 0; t++) {
    const k = ctx.rng.int(0, gx * gy - 1);
    const n = ctx.rng.pick(neighbours(k));
    if (!links.get(k)?.has(n)) link(k, n);
    if ([...links.values()].reduce((s, l) => s + l.size, 0) / 2 >= gx * gy - 1 + loops) break;
  }

  // 3. The main path: through the maze from the first entrance's junction to each other's.
  const entranceNodes = ctx.openingEnds.map(nearestNode);
  const onMain = new Set<number>();
  const mainLinks = new Set<string>();
  for (const target of entranceNodes.slice(1)) {
    const prev = new Map<number, number>([[entranceNodes[0], -1]]);
    const queue = [entranceNodes[0]];
    while (queue.length) {
      const k = queue.shift()!;
      if (k === target) break;
      for (const n of links.get(k) ?? []) if (!prev.has(n)) (prev.set(n, k), queue.push(n));
    }
    for (let k = target; k >= 0 && prev.has(k); k = prev.get(k)!) {
      onMain.add(k);
      const before = prev.get(k)!;
      if (before >= 0) mainLinks.add(`${Math.min(k, before)}-${Math.max(k, before)}`);
    }
  }
  onMain.add(entranceNodes[0]);
  // Carve junctions, then the passages between them.
  for (let k = 0; k < gx * gy; k++) {
    const [x, y] = nodeXY(k);
    for (let dy = 0; dy < cw; dy++) for (let dx = 0; dx < cw; dx++) pave(ctx.idx(x + dx, y + dy), onMain.has(k) ? Role.MainPath : Role.Branch);
  }
  for (const [a, set] of links)
    for (const b of set) {
      if (b < a) continue;
      const [ax, ay] = nodeXY(a);
      const [bx, by] = nodeXY(b);
      const role = mainLinks.has(`${a}-${b}`) ? Role.MainPath : Role.Branch;
      for (let y = Math.min(ay, by); y < Math.max(ay, by) + cw; y++) for (let x = Math.min(ax, bx); x < Math.max(ax, bx) + cw; x++) pave(ctx.idx(x, y), role);
    }
  // Each entrance joins its junction.
  ctx.openingEnds.forEach((end, k) => {
    const leg = cheapestPath(ctx.width, ctx.height, end, nodeCentre(entranceNodes[k]), (i) => (open(i) || ctx.role[i] === Role.Opening ? 1 : Infinity));
    for (const c of leg ?? []) ctx.stamp(c, cw, T.ground, Role.MainPath, (j) => open(j) && ctx.role[j] !== Role.Opening);
  });
  ctx.mainLine = [];
  for (let i = 0; i < ctx.n; i++) if (ctx.role[i] === Role.MainPath) ctx.mainLine.push(i);
  // Dead ends: junctions with one way in (not where an entrance joins). The deepest ones (furthest
  // from the main path) get the items, as many as the Extra items setting plus two; the rest are
  // left for hidden items.
  const deadEnds: Array<{ k: number; depth: number }> = [];
  for (let k = 0; k < gx * gy; k++) {
    if ((links.get(k)?.size ?? 0) !== 1 || entranceNodes.includes(k)) continue;
    let depth = 0;
    const seen = new Set([k]);
    let frontier = [k];
    while (frontier.length && !frontier.some((f) => onMain.has(f))) {
      frontier = frontier.flatMap((f) => [...(links.get(f) ?? [])].filter((n) => !seen.has(n)));
      for (const f of frontier) seen.add(f);
      depth++;
    }
    deadEnds.push({ k, depth });
  }
  deadEnds.sort((a, b) => b.depth - a.depth || a.k - b.k);
  ctx.deadEnds = deadEnds.slice(0, p.items + 2).map((e) => nodeCentre(e.k));
  ctx.quietEnds = deadEnds.slice(p.items + 2).map((e) => nodeCentre(e.k));

  // 4. Roughen the walls: bite into them here and there, never through one.
  const walkable = (i: number) => IS_WALKABLE[ctx.terrain[i]];
  const openNeighbours = (i: number) => {
    const [x, y] = ctx.xy(i);
    return DIRS.filter(({ dx, dy }) => ctx.inside(x + dx, y + dy) && walkable(ctx.idx(x + dx, y + dy))).length;
  };
  const bites: number[] = [];
  for (let i = 0; i < ctx.n; i++) if (ctx.terrain[i] === T.denseForest && ctx.role[i] === Role.None && !ctx.locks[i] && openNeighbours(i) === 1) bites.push(i);
  for (const i of bites) {
    const [x, y] = ctx.xy(i);
    if (ctx.noise.at(x * 0.45 + 900, y * 0.45) < 0.38) continue;
    // Only if the cell behind it is still forest, so the wall stays a wall.
    const away = DIRS.find(({ dx, dy }) => ctx.inside(x + dx, y + dy) && walkable(ctx.idx(x + dx, y + dy)))!;
    const bx = x - away.dx;
    const by = y - away.dy;
    if (!ctx.inside(bx, by) || walkable(ctx.idx(bx, by))) continue;
    ctx.set(i, T.ground, Role.Clearing);
  }

  // Clearings at some junctions where three or more ways meet.
  const junctions = ctx.rng.shuffle([...Array(gx * gy).keys()].filter((k) => (links.get(k)?.size ?? 0) >= 3));
  const wet = biome === "wetland";
  for (const k of junctions.slice(0, fp.clearings)) {
    const c = nodeCentre(k);
    const [cx, cy] = ctx.xy(c);
    const r = cw + 1.5;
    const cells: number[] = [];
    for (let dy = -3; dy <= 3; dy++)
      for (let dx = -3; dx <= 3; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (!ctx.inside(x, y) || dx * dx + dy * dy > r * r) continue;
        const i = ctx.idx(x, y);
        if (!open(i) || ctx.role[i] === Role.Opening) continue;
        cells.push(i);
        if (!walkable(i)) ctx.set(i, T.ground, Role.Clearing);
      }
    ctx.clearings.push(c);
    // A wetland clearing has a little pool off to one side, with mud round it (never on the main path).
    if (wet) {
      const side = cells.filter((i) => ctx.role[i] === Role.Clearing);
      const pool = side.slice(0, 3);
      for (const i of pool) ctx.set(i, T.waterShallow, Role.Clearing);
      for (const i of side.slice(3, 7)) ctx.set(i, T.mud, Role.Clearing);
    } else
      for (const i of cells.filter((j) => ctx.role[j] === Role.Clearing && ctx.rng.chance(0.25))) ctx.set(i, T.flowers, Role.Clearing);
  }

  // Long grass along the paths (tall grass in meadow and urban-edge woods).
  const grassType = biome === "meadow" || biome === "urban_edge" ? T.tallGrass : biome === "alpine" ? T.snowGrass : T.longGrass;
  // Patches, not a carpet: big soft noise, so the paths stay easy to read.
  const threshold = 0.82 - 0.3 * p.grass;
  for (let i = 0; i < ctx.n; i++) {
    if (ctx.terrain[i] !== T.ground || ctx.locks[i] || ctx.role[i] === Role.Opening) continue;
    const [x, y] = ctx.xy(i);
    if (ctx.noise.fractal(x + 4100, y + 4300, 11, 2) > threshold) ctx.set(i, grassType);
  }
  // Tidy up: no one-cell notches or stray single cells, and no trees touching only at a corner.
  cleanup(ctx);

  // 5. The forest's edge as single trees (in the mountains, conifers with outcrops of rock).
  for (let i = 0; i < ctx.n; i++) {
    if (ctx.terrain[i] !== T.denseForest || ctx.locks[i] || openNeighbours(i) === 0) continue;
    const [x, y] = ctx.xy(i);
    ctx.set(i, biome === "alpine" && ctx.noise.at(x * 0.2 + 5100, y * 0.2) > 0.62 ? T.rockWall : T.tree);
  }
}

/** Hidden items the forest always gets: at quiet dead ends first, then in corners off the paths. */
export function addGuaranteedHidden(ctx: GenContext): void {
  const want = ctx.input.forest?.guaranteedHidden ?? 0;
  if (!want) return;
  const flagBase = ctx.input.labelBase.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase();
  const taken = new Set(ctx.entities.map((e) => ctx.idx(e.x, e.y)));
  for (const i of ctx.keepClear) taken.add(i);
  let n = ctx.entities.filter((e) => e.kind === "hidden_item").length;
  const corner = (i: number) => {
    const [x, y] = ctx.xy(i);
    return DIRS.filter(({ dx, dy }) => !ctx.inside(x + dx, y + dy) || !IS_WALKABLE[ctx.terrain[ctx.idx(x + dx, y + dy)]]).length >= 2;
  };
  const spots = [
    ...ctx.quietEnds.filter((d) => !taken.has(d)),
    ...ctx.deadEnds.filter((d) => !taken.has(d)),
    ...ctx.rng.shuffle([...Array(ctx.n).keys()].filter((i) => IS_WALKABLE[ctx.terrain[i]] && ctx.role[i] !== Role.MainPath && ctx.role[i] !== Role.Opening && corner(i) && !taken.has(i))),
  ];
  let placed = 0;
  for (const i of spots) {
    if (placed >= want) break;
    if (taken.has(i) || !IS_WALKABLE[ctx.terrain[i]]) continue;
    const [x, y] = ctx.xy(i);
    if (ctx.entities.some((e) => e.kind === "hidden_item" && Math.abs(e.x - x) + Math.abs(e.y - y) < 6)) continue;
    n++;
    placed++;
    taken.add(i);
    ctx.entities.push({ id: `H${n}`, kind: "hidden_item", x, y, elevation: "ground", fields: { item: "ITEM_POTION", tier: "uncommon", flag: `FLAG_HIDDEN_ITEM_${flagBase}_${n}` } });
  }
}
