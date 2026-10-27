// The cave generator (Milestone 5, part C): one floor of a cave, like Granite
// Cave or Rusturf Tunnel.
//
//   1. Rock everywhere (except the user's zones and locked cells).
//   2. Chambers grown by cellular automata: random floor, smoothed until it
//      forms rounded caverns (the Openness setting sets how much floor). Tiny
//      pockets are filled back in.
//   3. Exits: cave mouths in the rock (a warp each), spread out, with the floor
//      in front of them. Exits placed by hand (or edited in Details) are kept
//      and used; Generate only adds the rest.
//   4. Every chamber and exit is joined by winding tunnels. The way between the
//      exits is the main way (trainers watch it).
//   5. Raised rock platforms with stairs (reusing the route's plateau builder),
//      underground water away from the main way (it needs Surf), and Rock Smash
//      rocks closing side passages, each with an item behind it.
//
// Things are placed by the shared placement stage: trainers, items at dead
// ends, hidden items. Wild encounters use the cave rate (land 10).

import { IS_WALKABLE, T, cheapestPath, components, distanceField } from "../grid";
import type { Warp } from "../model";
import { MOVEMENT_HMS, MoveGraph } from "../reach";
import type { GenContext } from "./context";
import { LEVEL, RAISED, Role } from "./context";
import { blobShape, buildPlateau, connectStairs } from "./plateaus";

export function buildCave(ctx: GenContext): void {
  const cp = ctx.input.cave!;
  const p = ctx.params;
  const bt = p.borderThickness;
  ctx.floor = T.caveFloor;
  ctx.wallFill = T.rockWall;
  ctx.trail = T.caveFloor;
  const open = (i: number) => !ctx.locks[i] && ctx.role[i] === Role.None && ctx.edgeDist(i) >= bt + 1;

  // 1–2. Rock, then chambers by cellular automata.
  for (let i = 0; i < ctx.n; i++) {
    if (ctx.locks[i] || ctx.role[i] !== Role.None) continue;
    ctx.set(i, T.rockWall, ctx.edgeDist(i) < bt ? Role.Border : Role.None);
  }
  let floor = new Uint8Array(ctx.n);
  const fill = 0.36 + 0.14 * cp.openness;
  for (let i = 0; i < ctx.n; i++) if (open(i) && ctx.rng.next() < fill) floor[i] = 1;
  for (let pass = 0; pass < 4; pass++) {
    const next = new Uint8Array(ctx.n);
    for (let i = 0; i < ctx.n; i++) {
      if (!open(i)) continue;
      const [x, y] = ctx.xy(i);
      let walls = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const xx = x + dx;
          const yy = y + dy;
          if (!ctx.inside(xx, yy) || !floor[ctx.idx(xx, yy)]) walls++;
        }
      next[i] = walls >= 5 ? 0 : 1;
    }
    floor = next;
  }
  const comp = components(ctx.width, ctx.height, (i) => floor[i] === 1);
  for (let i = 0; i < ctx.n; i++) if (floor[i] && comp.sizes[comp.ids[i]] >= 14) ctx.set(i, T.caveFloor, Role.None);
  const walkable = (i: number) => IS_WALKABLE[ctx.terrain[i]];
  const isFloor = (i: number) => ctx.terrain[i] === T.caveFloor;

  // 3. Exits. Cave mouths placed by hand are kept; the rest are made: a cave mouth in the rock
  // with floor right in front (south of it), spread out across the floor.
  const kept = ctx.input.warps.filter((w) => w.locked && (w.kind === "cave_mouth" || w.kind === "stairs" || w.kind === "other"));
  const fronts: number[] = [];
  for (const w of kept) {
    if (!ctx.inside(w.x, w.y)) continue;
    const below = w.y + 1 < ctx.height ? ctx.idx(w.x, w.y + 1) : ctx.idx(w.x, w.y);
    if (!ctx.locks[below] && ctx.role[below] !== Role.Border) ctx.set(below, T.caveFloor, Role.Opening);
    fronts.push(below);
  }
  const wanted = Math.max(0, cp.exits - kept.length);
  const spots: number[] = [];
  for (let i = 0; i < ctx.n; i++) {
    if (!open(i) || isFloor(i)) continue;
    const [x, y] = ctx.xy(i);
    if (y + 1 >= ctx.height || !isFloor(ctx.idx(x, y + 1))) continue;
    // Rock on both sides, so the mouth reads as a doorway in the cave wall.
    if (x < 1 || x >= ctx.width - 1 || isFloor(ctx.idx(x - 1, y)) || isFloor(ctx.idx(x + 1, y))) continue;
    spots.push(i);
  }
  for (let k = 0; k < wanted && spots.length; k++) {
    // The first near the bottom of the map (where the player comes in), then each as far as possible from the others.
    let best = -1;
    let bestScore = -Infinity;
    for (const s of spots) {
      const [x, y] = ctx.xy(s);
      const d = fronts.length ? Math.min(...fronts.map((f) => Math.abs((f % ctx.width) - x) + Math.abs(Math.floor(f / ctx.width) - y))) : y;
      const score = d + ctx.rng.next() * 4;
      if (score > bestScore) (bestScore = score, (best = s));
    }
    if (best < 0) break;
    const [x, y] = ctx.xy(best);
    ctx.set(best, T.caveEntrance, Role.Opening);
    const front = ctx.idx(x, y + 1);
    ctx.role[front] = Role.Opening;
    ctx.keepClear.add(front);
    fronts.push(front);
    const warp: Warp = { id: `w${ctx.warps.length + 1}`, kind: "cave_mouth", x, y, elevation: "ground", destMap: "", destWarpId: 0 };
    ctx.warps.push(warp);
  }
  // The checks and the placement stage start from the exits.
  ctx.openingEnds = fronts;

  // 4. Tunnels: join every chamber (and exit) to the nearest one already joined.
  const tunnelCost = (i: number) => {
    if (ctx.role[i] === Role.Border || (ctx.locks[i] && !walkable(i))) return Infinity;
    if (ctx.role[i] === Role.Sea) return ctx.crossable[i] ? 14 : Infinity;
    if (walkable(i)) return 1;
    const [x, y] = ctx.xy(i);
    return 3 + 4 * ctx.noise.fractal(x + 800, y + 600, 6, 2);
  };
  const pieces = (): number[][] => {
    const c = components(ctx.width, ctx.height, walkable);
    const out: number[][] = c.sizes.map(() => []);
    for (let i = 0; i < ctx.n; i++) if (c.ids[i] >= 0) out[c.ids[i]].push(i);
    return out.filter((list) => list.length);
  };
  const all = pieces();
  if (all.length) {
    const startPiece = all.find((list) => fronts.length && list.includes(fronts[0])) ?? all[0];
    const joined: number[] = [...startPiece];
    for (const piece of all.filter((l) => l !== startPiece)) {
      const sample = (list: number[]) => (list.length > 50 ? list.filter((_, k) => k % Math.ceil(list.length / 50) === 0) : list);
      let best: [number, number] | null = null;
      let bestD = Infinity;
      for (const a of sample(piece))
        for (const b of sample(joined)) {
          const d = Math.abs((a % ctx.width) - (b % ctx.width)) + Math.abs(Math.floor(a / ctx.width) - Math.floor(b / ctx.width));
          if (d < bestD) (bestD = d, (best = [a, b]));
        }
      if (best) {
        const leg = cheapestPath(ctx.width, ctx.height, best[0], best[1], tunnelCost);
        for (const c of leg ?? []) {
          if (ctx.role[c] === Role.Sea) ctx.bridge(c);
          else if (!walkable(c)) ctx.stamp(c, ctx.rng.chance(0.4) ? 2 : 1, T.caveFloor, Role.Branch, (j) => !ctx.locks[j] && ctx.role[j] === Role.None && ctx.edgeDist(j) >= bt);
        }
      }
      joined.push(...piece);
    }
  }

  // The main way: from the first exit to each other one (or, with one exit, to the far end of the cave).
  const floorCells: number[] = [];
  for (let i = 0; i < ctx.n; i++) if (walkable(i)) floorCells.push(i);
  if (fronts.length) {
    const from = fronts[0];
    let targets = fronts.slice(1);
    if (!targets.length) {
      const d = distanceField(ctx.width, ctx.height, [from], walkable);
      let far = from;
      for (const c of floorCells) if (d[c] !== Infinity && d[c] > d[far]) far = c;
      targets = [far];
    }
    for (const t of targets) {
      const leg = cheapestPath(ctx.width, ctx.height, from, t, (i) => (walkable(i) ? 1 : Infinity));
      for (const c of leg ?? []) if (ctx.role[c] === Role.None || ctx.role[c] === Role.Branch) ctx.role[c] = Role.MainPath;
    }
  }
  for (const c of floorCells) if (ctx.role[c] === Role.None) ctx.role[c] = Role.Branch;
  ctx.mainLine = floorCells.filter((c) => ctx.role[c] === Role.MainPath);
  const fromMain = distanceField(ctx.width, ctx.height, ctx.mainLine.length ? ctx.mainLine : fronts, walkable);

  // Dead ends: the floor cells furthest from the main way, one per far-off area.
  const ends = floorCells.filter((c) => fromMain[c] !== Infinity && fromMain[c] >= 6 && ctx.role[c] !== Role.Opening).sort((a, b) => fromMain[b] - fromMain[a]);
  const picked: number[] = [];
  for (const c of ends) {
    const [x, y] = ctx.xy(c);
    if (picked.some((q) => Math.abs((q % ctx.width) - x) + Math.abs(Math.floor(q / ctx.width) - y) < 10)) continue;
    picked.push(c);
  }
  ctx.deadEnds = picked.slice(0, p.items + 2);
  ctx.quietEnds = picked.slice(p.items + 2);

  // 5a. Raised platforms: in chambers off the main way, with stairs up and a trail to them.
  for (let k = 0; k < cp.platforms; k++) {
    const eligible = (i: number) => ctx.role[i] === Role.Branch && isFloor(i) && ctx.elevation[i] === LEVEL.ground && fromMain[i] >= 3 && ctx.edgeDist(i) >= bt + 2 && !ctx.keepClear.has(i);
    const seeds = ctx.rng.shuffle(floorCells.filter(eligible));
    for (const c of seeds.slice(0, 20)) {
      const shape = blobShape(ctx, c, ctx.rng.range(3, 5), ctx.rng.range(3, 5), eligible);
      if (shape && buildPlateau(ctx, shape, RAISED[0], [])) break;
    }
  }
  if (ctx.stairs.length) connectStairs(ctx);

  // 5b. Underground water: pools in the far parts of the cave (never on the main way).
  if (cp.waterLevel > 0) {
    const threshold = 0.28 + 0.3 * cp.waterLevel;
    for (const c of floorCells) {
      if (!isFloor(c) || ctx.role[c] !== Role.Branch || fromMain[c] < 3 || ctx.keepClear.has(c) || ctx.elevation[c] !== LEVEL.ground) continue;
      const [x, y] = ctx.xy(c);
      if (ctx.noise.fractal(x + 9100, y + 9300, 7, 2) < threshold) ctx.set(c, T.waterDeep, Role.Water);
    }
  }

  // 5c. Rock Smash rocks: each closes a one-cell side passage; an item waits beyond it.
  if (cp.rockSmash > 0) addSmashRocks(ctx, cp.rockSmash);

  // Items only where the player can get to (a platform whose stairs couldn't be joined up isn't).
  const reach = new MoveGraph({ width: ctx.width, height: ctx.height, terrain: ctx.terrain, entities: ctx.entities, elevation: ctx.elevation }, new Set(MOVEMENT_HMS)).forward(ctx.openingEnds);
  ctx.deadEnds = ctx.deadEnds.filter((c) => reach[c]);
  ctx.quietEnds = ctx.quietEnds.filter((c) => reach[c]);
}

/** Rock Smash rocks in side passages that, closed off, leave an area with no exit in it. */
function addSmashRocks(ctx: GenContext, count: number): void {
  const walk = (i: number) => IS_WALKABLE[ctx.terrain[i]];
  const view = () => ({ width: ctx.width, height: ctx.height, terrain: ctx.terrain, entities: ctx.entities, elevation: ctx.elevation });
  const before = new MoveGraph(view(), new Set()).forward(ctx.openingEnds);
  const candidates: number[] = [];
  for (let i = 0; i < ctx.n; i++) {
    if (!walk(i) || ctx.role[i] !== Role.Branch || ctx.locks[i] || ctx.keepClear.has(i) || !before[i]) continue;
    const [x, y] = ctx.xy(i);
    const w = (dx: number, dy: number) => ctx.inside(x + dx, y + dy) && walk(ctx.idx(x + dx, y + dy));
    // A narrow passage: open in a straight line, rock on both sides.
    if ((w(-1, 0) && w(1, 0) && !w(0, -1) && !w(0, 1)) || (w(0, -1) && w(0, 1) && !w(-1, 0) && !w(1, 0))) candidates.push(i);
  }
  let placed = 0;
  for (const c of ctx.rng.shuffle(candidates)) {
    if (placed >= count) break;
    const [x, y] = ctx.xy(c);
    if (ctx.entities.some((e) => Math.abs(e.x - x) + Math.abs(e.y - y) < 6)) continue;
    // With the rock in place (no Rock Smash yet), what can the player still reach?
    const rock = { id: "tmp", kind: "smash_rock" as const, x, y, elevation: "ground" as const, fields: {} };
    ctx.entities.push(rock);
    const after = new MoveGraph(view(), new Set()).forward(ctx.openingEnds);
    ctx.entities.pop();
    const cutOff: number[] = [];
    for (let i = 0; i < ctx.n; i++) if (before[i] && !after[i] && i !== c) cutOff.push(i);
    const behind = new Set(cutOff);
    // Worth closing: a real area behind it, and every exit still reachable.
    if (cutOff.length < 6 || ctx.openingEnds.some((f) => !after[f])) continue;
    placed++;
    ctx.entities.push({
      id: `R${placed}`,
      kind: "smash_rock",
      x,
      y,
      elevation: "ground",
      fields: { graphics_id: "OBJ_EVENT_GFX_BREAKABLE_ROCK", movement_type: "MOVEMENT_TYPE_LOOK_AROUND", script: "EventScript_RockSmash", flag: "0" },
    });
    // The item: the cell furthest from the rock in the area behind it.
    const d = distanceField(ctx.width, ctx.height, [c], (i) => i === c || behind.has(i));
    const far = cutOff.reduce((a, b) => (d[b] !== Infinity && d[b] > d[a] ? b : a), cutOff[0]);
    ctx.pockets.push({ center: far, hm: "rock_smash", zoneId: "" });
  }
}
