// The forest generator (Milestone 5, part B), like Petalburg Woods: a maze of
// winding paths through dense forest.
//
//   1. Dense forest everywhere (except the user's zones and locked cells), the
//      entrances carved through the border.
//   2. A maze of junctions (a "growing tree" maze): the Maze density setting
//      picks how often it carries on from the newest junction (long winding
//      ways, long dead ends) rather than a random one (more, shorter side
//      paths). Low settings also add a few loops. The junctions are scattered,
//      not on a grid.
//   3. Each passage between two junctions winds over the ground (a cheapest
//      path over noise) and keeps its distance from the other passages, so the
//      forest between them grows in thick, uneven clumps. Its width wanders too.
//      Rivers and water the user locked are crossed on bridges.
//   4. The way between the entrances is the main path (trainers watch it), the
//      rest are side paths ending in dead ends; clearings open at some
//      junctions, sometimes round a clump of trees; long grass grows along the
//      paths.
//   5. The edge of the dense forest is drawn as single trees.
//   6. With a travel direction, ledges in the walls jump from deep in the maze
//      back toward the start: a shortcut home (see addForestLedges).
//
// The biome sets the look: wetland clearings hold pools and mud, meadow forests
// grow tall grass and lots of flowers, alpine ones have snowy grass and
// outcrops of rock.

import { DIRS, IS_WALKABLE, T, cheapestPath } from "../grid";
import type { GenContext } from "./context";
import { LEVEL, Role } from "./context";
import { carveOpening } from "./routeSkeleton";
import { cleanup } from "./cleanup";
import { backDir } from "./travel";

export function buildForest(ctx: GenContext): void {
  const fp = ctx.input.forest!;
  const p = ctx.params;
  const bt = p.borderThickness;
  const biome = ctx.input.biome;

  // 1. Dense forest, except the user's zones (water, edges, keep-clear ground) and locked cells.
  for (let i = 0; i < ctx.n; i++) {
    if (ctx.locks[i] || ctx.role[i] !== Role.None) continue;
    ctx.set(i, T.denseForest, ctx.edgeDist(i) < bt ? Role.Border : Role.None);
  }
  const ends = ctx.input.openings.map((o) => ({ o, end: carveOpening(ctx, o) }));
  ctx.openingEnds = ends.filter((e) => e.o.kind === "walk").map((e) => e.end);

  // Where paths may go: not through the border, cliffs, the sea or locked walls; rivers and
  // locked water only on a bridge (expensive, so crossings are short).
  const blocked = (i: number) => {
    const r = ctx.role[i];
    if (r === Role.Border || r === Role.Cliff) return true;
    if (r === Role.Sea) return !ctx.crossable[i];
    return !!ctx.locks[i] && !IS_WALKABLE[ctx.terrain[i]];
  };
  const baseCost = (i: number) => {
    if (blocked(i)) return Infinity;
    if (ctx.role[i] === Role.Sea) return 14;
    const [x, y] = ctx.xy(i);
    return 1 + 3 * ctx.noise.fractal(x + 1700, y + 1900, 6, 2);
  };
  const paveCell = (i: number, role: Role) => {
    if (ctx.role[i] === Role.Sea) return; // only the centre line crosses water, as a bridge
    if (blocked(i) || ctx.role[i] === Role.Opening || ctx.role[i] === Role.Bridge) return;
    if (ctx.locks[i]) {
      if (IS_WALKABLE[ctx.terrain[i]]) ctx.role[i] = role;
      return;
    }
    if (ctx.role[i] === Role.Keep) return void (ctx.role[i] = role);
    ctx.set(i, T.ground, role);
  };
  const paveCentre = (i: number, role: Role) => {
    if (ctx.role[i] === Role.Sea) ctx.bridge(i);
    else paveCell(i, role);
  };

  // 2. Junctions: one per (cw + 6)-cell square, scattered inside it.
  const cw = Math.max(1, Math.min(3, p.pathWidthMin));
  const S = cw + 6;
  const m = bt + 2;
  const gx = Math.max(1, Math.floor((ctx.width - 2 * m) / S));
  const gy = Math.max(1, Math.floor((ctx.height - 2 * m) / S));
  const spanX = (ctx.width - 2 * m) / gx;
  const spanY = (ctx.height - 2 * m) / gy;
  const centres: number[] = [];
  for (let b = 0; b < gy; b++)
    for (let a = 0; a < gx; a++) {
      const x = Math.round(m + (a + 0.5) * spanX + ctx.rng.range(-0.3, 0.3) * spanX);
      const y = Math.round(m + (b + 0.5) * spanY + ctx.rng.range(-0.3, 0.3) * spanY);
      centres.push(ctx.idx(Math.min(ctx.width - m - 1, Math.max(m, x)), Math.min(ctx.height - m - 1, Math.max(m, y))));
    }
  const usable = centres.map((c) => !blocked(c) && ctx.role[c] !== Role.Sea);
  const count = gx * gy;
  const neighbours = (k: number) => {
    const a = k % gx;
    const b = Math.floor(k / gx);
    const out: number[] = [];
    if (a > 0) out.push(k - 1);
    if (a < gx - 1) out.push(k + 1);
    if (b > 0) out.push(k - gx);
    if (b < gy - 1) out.push(k + gx);
    return out.filter((n) => usable[n]);
  };
  const nearestNode = (cell: number) => {
    const [x, y] = ctx.xy(cell);
    let best = -1;
    let bestD = Infinity;
    for (let k = 0; k < count; k++) {
      if (!usable[k]) continue;
      const [nx, ny] = ctx.xy(centres[k]);
      const d = Math.abs(nx - x) + Math.abs(ny - y);
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
    return best;
  };
  const links = new Map<number, Set<number>>();
  const link = (a: number, b: number) => {
    (links.get(a) ?? links.set(a, new Set()).get(a)!).add(b);
    (links.get(b) ?? links.set(b, new Set()).get(b)!).add(a);
  };
  const entranceNodes = ctx.openingEnds.map(nearestNode);
  const start = entranceNodes[0] ?? nearestNode(ctx.idx(ctx.width >> 1, ctx.height >> 1));
  if (start < 0) return;
  const visited = new Uint8Array(count);
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
  const loops = Math.round((1 - fp.mazeDensity) * 0.25 * count);
  for (let t = 0, added = 0; t < loops * 6 && added < loops; t++) {
    const k = ctx.rng.int(0, count - 1);
    const ns = neighbours(k);
    if (!usable[k] || !visited[k] || !ns.length) continue;
    const n = ctx.rng.pick(ns);
    if (visited[n] && !links.get(k)?.has(n)) {
      link(k, n);
      added++;
    }
  }

  // The main path through the maze: from the first entrance's junction to each other's.
  const onMain = new Set<number>([start]);
  const mainLinks = new Set<string>();
  const key = (a: number, b: number) => `${Math.min(a, b)}-${Math.max(a, b)}`;
  for (const target of entranceNodes.slice(1)) {
    if (target < 0) continue;
    const prev = new Map<number, number>([[start, -1]]);
    const queue = [start];
    while (queue.length) {
      const k = queue.shift()!;
      if (k === target) break;
      for (const n of links.get(k) ?? []) if (!prev.has(n)) (prev.set(n, k), queue.push(n));
    }
    for (let k = target; k >= 0 && prev.has(k); k = prev.get(k)!) {
      onMain.add(k);
      const before = prev.get(k)!;
      if (before >= 0) mainLinks.add(key(k, before));
    }
  }

  // 3. Carve the passages: winding, keeping their distance from each other.
  const owner = new Int32Array(ctx.n).fill(-1);
  const near = (i: number, linkId: number, a: number, b: number) => {
    const [x, y] = ctx.xy(i);
    // Close to the passage's own ends it may meet the others (that's the junction).
    for (const c of [centres[a], centres[b]]) {
      const [cx, cy] = ctx.xy(c);
      if (Math.abs(cx - x) + Math.abs(cy - y) <= cw + 2) return false;
    }
    for (let dy = -3; dy <= 3; dy++)
      for (let dx = -3; dx <= 3; dx++) {
        if (!ctx.inside(x + dx, y + dy)) continue;
        const o = owner[ctx.idx(x + dx, y + dy)];
        if (o >= 0 && o !== linkId) return true;
      }
    return false;
  };
  const linkList: Array<[number, number]> = [];
  for (const [a, set] of links) for (const b of set) if (a < b) linkList.push([a, b]);
  // The main path first, so it's the most direct.
  linkList.sort((u, v) => Number(mainLinks.has(key(v[0], v[1]))) - Number(mainLinks.has(key(u[0], u[1]))));
  linkList.forEach(([a, b], linkId) => {
    const role = mainLinks.has(key(a, b)) ? Role.MainPath : Role.Branch;
    const leg = cheapestPath(ctx.width, ctx.height, centres[a], centres[b], (i) => {
      const c = baseCost(i);
      return c === Infinity ? c : near(i, linkId, a, b) ? c + 60 : c;
    });
    if (!leg) return;
    for (const c of leg) {
      const [x, y] = ctx.xy(c);
      // The width wanders a little around the path width.
      const v = ctx.noise.at(x * 0.15 + 2300, y * 0.15);
      const w = Math.max(1, Math.min(3, cw + (v > 0.8 ? 1 : v < 0.3 ? -1 : 0)));
      paveCentre(c, role);
      ctx.stamp(c, w, T.ground, role, (j) => j !== c && ctx.role[j] !== Role.Sea && !blocked(j) && ctx.role[j] !== Role.Opening && ctx.role[j] !== Role.Bridge && ctx.role[j] !== Role.MainPath);
      for (let dy = -1; dy <= w; dy++) for (let dx = -1; dx <= w; dx++) if (ctx.inside(x + dx, y + dy)) owner[ctx.idx(x + dx, y + dy)] = linkId;
    }
  });
  // Junctions open out a little.
  for (let k = 0; k < count; k++) {
    if (!visited[k]) continue;
    const [cx, cy] = ctx.xy(centres[k]);
    const r = cw / 2 + 0.8;
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++)
        if (dx * dx + dy * dy <= r * r && ctx.inside(cx + dx, cy + dy)) paveCell(ctx.idx(cx + dx, cy + dy), onMain.has(k) ? Role.MainPath : Role.Branch);
  }
  // Each entrance joins its junction.
  ctx.openingEnds.forEach((end, k) => {
    if (entranceNodes[k] < 0) return;
    const leg = cheapestPath(ctx.width, ctx.height, end, centres[entranceNodes[k]], (i) => (ctx.role[i] === Role.Opening ? 1 : baseCost(i)));
    for (const c of leg ?? []) {
      paveCentre(c, Role.MainPath);
      ctx.stamp(c, cw, T.ground, Role.MainPath, (j) => j !== c && ctx.role[j] !== Role.Sea && !blocked(j) && ctx.role[j] !== Role.Opening && ctx.role[j] !== Role.Bridge);
    }
  });
  ctx.mainLine = [];
  for (let i = 0; i < ctx.n; i++) if (ctx.role[i] === Role.MainPath) ctx.mainLine.push(i);

  // Dead ends: junctions with one way in (not where an entrance joins). The deepest ones (furthest
  // from the main path) get the items, as many as the Extra items setting plus two; the rest are
  // left for hidden items.
  const deadEnds: Array<{ k: number; depth: number }> = [];
  for (let k = 0; k < count; k++) {
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
  ctx.deadEnds = deadEnds.slice(0, p.items + 2).map((e) => centres[e.k]);
  ctx.quietEnds = deadEnds.slice(p.items + 2).map((e) => centres[e.k]);

  // 4. Clearings at some junctions where three or more ways meet: irregular open ground, the
  // bigger ones round a clump of trees.
  const walkable = (i: number) => IS_WALKABLE[ctx.terrain[i]];
  const junctions = ctx.rng.shuffle([...Array(count).keys()].filter((k) => (links.get(k)?.size ?? 0) >= 3));
  const wet = biome === "wetland";
  for (const k of junctions.slice(0, fp.clearings)) {
    const c = centres[k];
    const [cx, cy] = ctx.xy(c);
    const r = ctx.rng.range(2.5, 4.2);
    const cells: number[] = [];
    for (let dy = -5; dy <= 5; dy++)
      for (let dx = -5; dx <= 5; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (!ctx.inside(x, y)) continue;
        const wobble = 0.7 + 0.6 * ctx.noise.at(x * 0.5 + 3100, y * 0.5);
        if (Math.hypot(dx, dy) > r * wobble) continue;
        const i = ctx.idx(x, y);
        if (blocked(i) || ctx.role[i] === Role.Sea || ctx.role[i] === Role.Opening || ctx.locks[i]) continue;
        cells.push(i);
        if (!walkable(i)) ctx.set(i, T.ground, Role.Clearing);
      }
    ctx.clearings.push(c);
    const side = cells.filter((i) => ctx.role[i] === Role.Clearing);
    // A clump of trees standing in a big clearing, off the paths.
    if (r > 3.4 && side.length > 12) {
      const clump = ctx.rng.pick(side);
      const [ux, uy] = ctx.xy(clump);
      const two = [clump, ctx.idx(Math.min(ctx.width - 1, ux + 1), uy), ctx.idx(ux, Math.min(ctx.height - 1, uy + 1)), ctx.idx(Math.min(ctx.width - 1, ux + 1), Math.min(ctx.height - 1, uy + 1))];
      if (two.every((i) => ctx.role[i] === Role.Clearing)) for (const i of two) ctx.set(i, T.tree, Role.Clearing);
    }
    // A wetland clearing has a little pool off to one side, with mud round it (never on a path).
    const ground = side.filter((i) => ctx.terrain[i] === T.ground);
    if (wet) {
      for (const i of ground.slice(0, 3)) ctx.set(i, T.waterShallow, Role.Clearing);
      for (const i of ground.slice(3, 7)) ctx.set(i, T.mud, Role.Clearing);
    } else for (const i of ground.filter(() => ctx.rng.chance(biome === "meadow" ? 0.6 : 0.25))) ctx.set(i, T.flowers, Role.Clearing);
  }

  // Long grass along the paths (tall grass in meadow and urban-edge woods), in patches.
  const grassType = biome === "meadow" || biome === "urban_edge" ? T.tallGrass : biome === "alpine" ? T.snowGrass : T.longGrass;
  const threshold = 0.82 - 0.3 * p.grass;
  for (let i = 0; i < ctx.n; i++) {
    if (ctx.terrain[i] !== T.ground || ctx.locks[i] || ctx.role[i] === Role.Opening) continue;
    const [x, y] = ctx.xy(i);
    if (ctx.noise.fractal(x + 4100, y + 4300, 11, 2) > threshold) ctx.set(i, grassType);
    // Meadow woods: flowers along the path edges.
    else if (biome === "meadow" && ctx.noise.at(x * 0.6 + 5300, y * 0.6) > 0.66) ctx.set(i, T.flowers);
  }
  // Tidy up: no one-cell notches or stray single cells, and no trees touching only at a corner.
  cleanup(ctx);

  // 5. The forest's edge as single trees (in the mountains, conifers with outcrops of rock).
  const openNeighbours = (i: number) => {
    const [x, y] = ctx.xy(i);
    return DIRS.filter(({ dx, dy }) => ctx.inside(x + dx, y + dy) && walkable(ctx.idx(x + dx, y + dy))).length;
  };
  for (let i = 0; i < ctx.n; i++) {
    if (ctx.terrain[i] !== T.denseForest || ctx.locks[i] || openNeighbours(i) === 0) continue;
    const [x, y] = ctx.xy(i);
    ctx.set(i, biome === "alpine" && ctx.noise.at(x * 0.2 + 5100, y * 0.2) > 0.62 ? T.rockWall : T.tree);
  }
}

/**
 * Ledge shortcuts (with a travel direction): where a path deep in the maze runs
 * past a thin stretch of forest (up to 3 cells) with a path much nearer the start on the other
 * side, the wall becomes a ledge jumping back toward the start. Going forward
 * it's just a wall with a ledge face; coming back, the player jumps it instead
 * of finding the way round. Gen 3 has no north-facing ledge, so a forest
 * travelled north to south gets none. Up to the Ledge rows setting (Ledge shortcuts in the Forest group).
 */
export function addForestLedges(ctx: GenContext): void {
  const t = ctx.travel;
  if (!t) return;
  const back = backDir(t);
  if (back === "n") return;
  const d = DIRS.find((x) => x.dir === back)!;
  const ledge = back === "s" ? T.ledgeS : back === "e" ? T.ledgeE : T.ledgeW;
  const walk = (i: number) => IS_WALKABLE[ctx.terrain[i]] && ctx.elevation[i] === LEVEL.ground;
  // Steps from the start entrance along the paths.
  const starts = ctx.input.openings.filter((o) => o.edge === t.from && o.kind === "walk");
  const dist = new Int32Array(ctx.n).fill(-1);
  let frontier: number[] = [];
  for (const o of starts)
    for (let k = 0; k < o.width; k++) {
      const x = o.edge === "north" || o.edge === "south" ? o.start + k : o.edge === "west" ? 0 : ctx.width - 1;
      const y = o.edge === "east" || o.edge === "west" ? o.start + k : o.edge === "north" ? 0 : ctx.height - 1;
      const i = ctx.idx(x, y);
      if (walk(i)) (dist[i] = 0, frontier.push(i));
    }
  for (let step = 1; frontier.length; step++) {
    const next: number[] = [];
    for (const c of frontier) {
      const [x, y] = ctx.xy(c);
      for (const { dx, dy } of DIRS) {
        if (!ctx.inside(x + dx, y + dy)) continue;
        const j = ctx.idx(x + dx, y + dy);
        if (dist[j] < 0 && walk(j)) (dist[j] = step, next.push(j));
      }
    }
    frontier = next;
  }
  // Candidates: forest 1–3 cells thick in the jump direction, with a big saving.
  type Cand = { wall: number[]; ledgeCell: number; gain: number };
  const cands: Cand[] = [];
  const wallOk = (i: number) => !ctx.locks[i] && !walk(i) && (ctx.terrain[i] === T.tree || ctx.terrain[i] === T.denseForest) && ctx.role[i] === Role.None && ctx.edgeDist(i) >= ctx.params.borderThickness;
  for (let i = 0; i < ctx.n; i++) {
    if (!wallOk(i)) continue;
    const [x, y] = ctx.xy(i);
    const bx = x + d.dx;
    const by = y + d.dy;
    if (!ctx.inside(bx, by) || dist[ctx.idx(bx, by)] < 0) continue;
    // Through 1–3 cells of forest: the cells before the ledge become a short path up to it.
    const wall = [i];
    for (let thick = 1; thick <= 3; thick++) {
      const ax = x - d.dx * thick;
      const ay = y - d.dy * thick;
      if (!ctx.inside(ax, ay)) break;
      const a = ctx.idx(ax, ay);
      if (dist[a] >= 0) {
        const gain = dist[a] - dist[ctx.idx(bx, by)];
        if (gain >= 20) cands.push({ wall: [...wall], ledgeCell: i, gain });
        break;
      }
      if (!wallOk(a)) break;
      wall.push(a);
    }
  }
  cands.sort((a, b) => b.gain - a.gain || a.ledgeCell - b.ledgeCell);
  const want = ctx.params.ledges;
  const used: number[] = [];
  for (const c of cands) {
    if (used.length >= want) break;
    const [x, y] = ctx.xy(c.ledgeCell);
    if (used.some((u) => {
      const [ux, uy] = ctx.xy(u);
      return Math.abs(ux - x) + Math.abs(uy - y) < 10;
    }))
      continue;
    // The forest before the ledge becomes a short path up to it.
    for (const w of c.wall.slice(1)) ctx.set(w, T.ground, Role.Branch);
    ctx.set(c.ledgeCell, ledge, Role.Corridor);
    used.push(c.ledgeCell);
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
