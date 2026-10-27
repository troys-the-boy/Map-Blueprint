// Stage 6: placing things (basic version; Milestone 4 adds the other kinds).
//
//   • a sign beside the path at the first entrance;
//   • item balls at dead ends and inside every HM pocket (plus extras off the path);
//   • hidden items in odd corners;
//   • trainers beside the path, facing it, so their sight line crosses the path.
//     With a grass shortcut, trainers favour the stretch of path it bypasses
//     (taking the path means battles) and at most one watches the grass.
//   • on open water: swimmers beside the surfing lane, and items on islands.
// With a travel direction (see travel.ts): the sign is at the start, ledge
// pockets get an item, trainers face the player coming from the start, wait on
// the way round ledge rows, and none stand right by the start entrance.
// All field values are suggestions for Porymap and can be edited later.

import { FACE_MOVEMENT, trainerSight } from "../entities";
import { DIRS, IS_WALKABLE, IS_WALL, IS_WATER, T, distanceField } from "../grid";
import type { Entity } from "../model";
import type { Hm } from "../constants";
import { MoveGraph, openingCells } from "../reach";
import type { GenContext } from "./context";
import { backDir, fromStart } from "./travel";
import { Role } from "./context";

const TRAINER_GRAPHICS = ["YOUNGSTER", "LASS", "BUG_CATCHER", "HIKER", "PICNICKER", "CAMPER", "TWIN", "MANIAC"];
const ITEM_BY_TIER: Record<string, string> = { common: "ITEM_POTION", uncommon: "ITEM_GREAT_BALL", rare: "ITEM_RARE_CANDY" };

/** "Route1" → "ROUTE1"; "MistyWoods2" → "MISTY_WOODS2". */
function constantBase(labelBase: string) {
  return labelBase.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase() || "MAP";
}

export function placeEntities(ctx: GenContext): void {
  const { width, height, n } = ctx;
  const p = ctx.params;
  const rng = ctx.rng.fork("placement");
  const label = ctx.input.labelBase;
  const flagBase = constantBase(label);
  const taken = new Uint8Array(n);
  for (const e of ctx.entities) taken[ctx.idx(e.x, e.y)] = 1;
  for (const i of ctx.keepClear) taken[i] = 1;

  const water = ctx.layout === "water";
  // On open water the route is the surfing lane, travelled with Surf; elsewhere it's the path, on foot.
  const routeOpenings = ctx.input.openings.filter((o) => o.kind === (water ? "surf" : "walk"));
  const hms = new Set<Hm>(water ? ["surf"] : []);
  const view = (terrain: Uint8Array) => ({ width, height, terrain, entities: ctx.entities, elevation: ctx.elevation });
  const starts = routeOpenings.flatMap((o) => openingCells(o, width, height));
  const fromOpenings = distanceField(width, height, ctx.input.openings.flatMap((o) => openingCells(o, width, height)));
  const reachNoHm = new MoveGraph(view(ctx.terrain), hms).forward(starts);
  const lane = new Set(water ? ctx.mainLine : []);
  const pathish = (i: number) => {
    if (water) return lane.has(i);
    const r = ctx.role[i];
    return r === Role.MainPath || r === Role.Branch || r === Role.Corridor || r === Role.Opening || r === Role.Bridge || r === Role.GrassRoute;
  };
  const add = (e: Omit<Entity, "elevation">) => {
    ctx.entities.push({ ...e, elevation: "ground" });
    taken[ctx.idx(e.x, e.y)] = 1;
  };

  // --- Sign at the first entrance (the start, with a travel direction) ----------------
  const travel = ctx.travel;
  const startDist = (i: number) => {
    const [x, y] = ctx.xy(i);
    return travel ? fromStart(travel, x, y, width, height) : 0;
  };
  if (ctx.openingEnds.length) {
    const end = travel ? ctx.openingEnds.reduce((a, b) => (startDist(b) < startDist(a) ? b : a)) : ctx.openingEnds[0];
    const [ex, ey] = ctx.xy(end);
    let best = -1;
    let bestScore = Infinity;
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const x = ex + dx;
        const y = ey + dy;
        if (!ctx.inside(x, y)) continue;
        const i = ctx.idx(x, y);
        if (pathish(i) || ctx.locks[i] || taken[i] || ctx.isProtected(i) || ctx.role[i] === Role.Border) continue;
        // Beside the path, on a cell that isn't the only way anywhere (a wall-side cell).
        const t = ctx.terrain[i];
        // Plain ground or a tree only, so the sign never splits a grass or sand patch.
        if (t !== T.ground && t !== T.tree) continue;
        const besidePath = DIRS.some(({ dx: ddx, dy: ddy }) => ctx.inside(x + ddx, y + ddy) && pathish(ctx.idx(x + ddx, y + ddy)));
        if (!besidePath) continue;
        // The path cell next to the sign must still have walkable ground on its far side.
        const pinches = DIRS.some(({ dx: ddx, dy: ddy }) => {
          const px = x + ddx;
          const py = y + ddy;
          if (!ctx.inside(px, py) || !pathish(ctx.idx(px, py))) return false;
          const fx = px + ddx;
          const fy = py + ddy;
          return !ctx.inside(fx, fy) || !IS_WALKABLE[ctx.terrain[ctx.idx(fx, fy)]];
        });
        if (pinches) continue;
        const score = Math.abs(dx) + Math.abs(dy) + (IS_WALKABLE[t] ? 0 : 2);
        if (score < bestScore) {
          bestScore = score;
          best = i;
        }
      }
    if (best >= 0) {
      ctx.set(best, T.signTile);
      const [x, y] = ctx.xy(best);
      add({
        id: "S1",
        kind: "sign",
        x,
        y,
        fields: {
          player_facing_dir: "BG_EVENT_PLAYER_FACING_ANY",
          script: `${label}_EventScript_${ctx.input.mapType === "town" ? "TownSign" : "RouteSign"}`,
          text: label.replace(/([a-z])(\d)/, "$1 $2").replace(/([a-z])([A-Z])/g, "$1 $2"),
        },
      });
    }
  }

  // --- Items ------------------------------------------------------------------------
  let itemNo = 0;
  const addItem = (i: number, tier: "common" | "uncommon" | "rare") => {
    const [x, y] = ctx.xy(i);
    itemNo++;
    add({
      id: `I${itemNo}`,
      kind: "item_ball",
      x,
      y,
      fields: {
        graphics_id: "OBJ_EVENT_GFX_ITEM_BALL",
        movement_type: "MOVEMENT_TYPE_LOOK_AROUND",
        item: ITEM_BY_TIER[tier],
        tier,
        script: `${label}_EventScript_Item${itemNo}`,
        flag: `FLAG_ITEM_${flagBase}_${itemNo}`,
      },
    });
  };
  for (const pocket of ctx.pockets) if (!taken[pocket.center]) addItem(pocket.center, "rare");
  for (const c of ctx.ledgePockets) if (!taken[c]) addItem(c, "uncommon");
  if (p.deadEndRewards)
    for (const d of ctx.deadEnds) if (!taken[d] && IS_WALKABLE[ctx.terrain[d]]) addItem(d, "uncommon");
  // In a forest, the Extra items setting is spent on its deepest dead ends (see forest.ts).
  let budget = ctx.input.mapType === "forest" ? 0 : p.items;
  // Extra items: reachable spots a few steps off the path.
  const pathCells: number[] = [];
  for (let i = 0; i < n; i++) if (pathish(i)) pathCells.push(i);
  const fromPath = distanceField(width, height, pathCells);
  const offPath: number[] = [];
  const farthest = water ? 14 : 6;
  for (let i = 0; i < n; i++)
    if (reachNoHm[i] && !taken[i] && !pathish(i) && fromPath[i] >= 2 && fromPath[i] <= farthest && IS_WALKABLE[ctx.terrain[i]] && fromOpenings[i] > 5) offPath.push(i);
  for (const i of rng.shuffle(offPath)) {
    if (budget <= 0) break;
    if (taken[i] || tooClose(ctx, i, "item_ball", 6)) continue;
    addItem(i, "common");
    budget--;
  }

  // --- Hidden items in corners -----------------------------------------------------
  const corners: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!reachNoHm[i] || taken[i] || pathish(i) || !IS_WALKABLE[ctx.terrain[i]]) continue;
    const [x, y] = ctx.xy(i);
    let walls = 0;
    for (const { dx, dy } of DIRS) if (!ctx.inside(x + dx, y + dy) || IS_WALL[ctx.terrain[ctx.idx(x + dx, y + dy)]]) walls++;
    if (walls >= 2) corners.push(i);
  }
  let hidden = 0;
  for (const i of rng.shuffle(corners)) {
    if (hidden >= p.hiddenItems) break;
    if (taken[i] || tooClose(ctx, i, "hidden_item", 8) || tooClose(ctx, i, "item_ball", 4)) continue;
    hidden++;
    const [x, y] = ctx.xy(i);
    add({
      id: `H${hidden}`,
      kind: "hidden_item",
      x,
      y,
      fields: { item: "ITEM_POTION", tier: "common", flag: `FLAG_HIDDEN_ITEM_${flagBase}_${hidden}` },
    });
  }

  // --- Trainers ---------------------------------------------------------------------------
  type Spot = { i: number; dir: (typeof DIRS)[number]; range: number; score: number; watchesGrass: boolean };
  const spots: Spot[] = [];
  // Main-path cells on the stretch the grass shortcut bypasses: trainers here force battles on the path.
  const bypassed = new Set<number>();
  if (ctx.shortcut) {
    for (let k = ctx.shortcut.from; k <= ctx.shortcut.to; k++) {
      const [cx, cy] = ctx.xy(ctx.mainLine[k]);
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) if (ctx.inside(cx + dx, cy + dy) && ctx.role[ctx.idx(cx + dx, cy + dy)] === Role.MainPath) bypassed.add(ctx.idx(cx + dx, cy + dy));
    }
  }
  for (let i = 0; i < n; i++) {
    if (!reachNoHm[i] || taken[i] || pathish(i) || ctx.role[i] === Role.Pocket || ctx.role[i] === Role.Stairs || fromOpenings[i] < 6) continue;
    // Give the player a few steps into the route before the first battle.
    if (travel && startDist(i) < 10) continue;
    const t = ctx.terrain[i];
    // Swimmers stand on open water; everyone else on walkable land.
    if (water ? !IS_WATER[t] : !IS_WALKABLE[t] || t === T.signTile) continue;
    const seeThrough = (j: number) => (water ? IS_WATER[ctx.terrain[j]] || IS_WALKABLE[ctx.terrain[j]] : IS_WALKABLE[ctx.terrain[j]]) && !taken[j];
    const [x, y] = ctx.xy(i);
    for (const d of DIRS) {
      // Look along this direction. The sight line must cross the path (in one
      // side, out the other) within a few cells, not run along it.
      let firstPath = -1;
      let lastPath = -1;
      let crosses = false;
      for (let k = 1; k <= 7; k++) {
        const xx = x + d.dx * k;
        const yy = y + d.dy * k;
        if (!ctx.inside(xx, yy)) break;
        const j = ctx.idx(xx, yy);
        const walkable = seeThrough(j) && ctx.elevation[j] === ctx.elevation[i];
        if (walkable && pathish(j)) {
          if (firstPath < 0) firstPath = k;
          lastPath = k;
          continue;
        }
        if (firstPath >= 0) crosses = true;
        if (!walkable || firstPath >= 0) break;
      }
      if (firstPath < 0 || firstPath > 4 || !crosses || lastPath - firstPath + 1 > p.pathWidthMax + 1) continue;
      const range = Math.min(6, lastPath);
      const first = ctx.idx(x + d.dx * firstPath, y + d.dy * firstPath);
      const watchesGrass = ctx.role[first] === Role.GrassRoute;
      // Prefer trainers a step or two back from the path, on the stretch the grass bypasses.
      let score = rng.next() + (firstPath === 2 ? 0.5 : firstPath === 1 ? 0.2 : 0) + (bypassed.has(first) ? 1.2 : 0) + (watchesGrass ? 0.6 : 0);
      if (travel) {
        // Facing back toward the start sees the player coming; facing the end shows them its back.
        const back = backDir(travel);
        const ahead = { n: "s", s: "n", e: "w", w: "e" }[back];
        if (d.dir === back) score += 0.8;
        else if (d.dir === ahead) score -= 0.8;
        // The way round a ledge row is the way forward: trainers wait there.
        if (ctx.ledgeDetours.has(first)) score += 1;
      }
      spots.push({ i, dir: d, range, score, watchesGrass });
    }
  }
  spots.sort((a, b) => b.score - a.score || a.i - b.i);
  const nearWater = (i: number) => {
    const [x, y] = ctx.xy(i);
    return DIRS.some(({ dx, dy }) => ctx.inside(x + dx, y + dy) && IS_WATER[ctx.terrain[ctx.idx(x + dx, y + dy)]]);
  };
  // Can the player still get between the entrances if the trainer's sight line were a wall?
  const avoidable = (sight: number[], standing: number) => {
    if (routeOpenings.length < 2) return true;
    const blocked = ctx.terrain.slice();
    for (const c of sight) blocked[c] = T.tree;
    blocked[standing] = T.tree;
    const first = openingCells(routeOpenings[0], width, height);
    const reach = new MoveGraph(view(blocked), hms).forward(first);
    return routeOpenings.slice(1).every((o) => openingCells(o, width, height).some((c) => reach[c]));
  };
  let grassWatchers = 0;
  const placedSights: number[][] = [];
  let trainerNo = 0;
  for (const s of spots) {
    if (trainerNo >= p.trainers) break;
    if (taken[s.i] || tooClose(ctx, s.i, "trainer", p.trainerSpacing)) continue;
    // Only one trainer watches the grass shortcut; the shortcut's point is skipping trainers.
    if (s.watchesGrass && grassWatchers >= 1) continue;
    const [x, y] = ctx.xy(s.i);
    const e: Entity = {
      id: `T${trainerNo + 1}`,
      kind: "trainer",
      x,
      y,
      elevation: "ground",
      fields: {
        graphics_id: `OBJ_EVENT_GFX_${water ? rng.pick(["SWIMMER_M", "SWIMMER_F"]) : nearWater(s.i) ? "FISHERMAN" : rng.pick(TRAINER_GRAPHICS)}`,
        movement_type: FACE_MOVEMENT[s.dir.dir],
        movement_range_x: 0,
        movement_range_y: 0,
        trainer_type: "TRAINER_TYPE_NORMAL",
        trainer_sight_or_berry_tree_id: String(s.range),
        script: `${label}_EventScript_Trainer${trainerNo + 1}`,
        flag: "0",
      },
    };
    // Longest sight range (down to 1) that the player can still walk around.
    let sight: number[] = [];
    let ok = false;
    for (let range = s.range; range >= 1; range--) {
      e.fields.trainer_sight_or_berry_tree_id = String(range);
      sight = trainerSight(e, width, height, ctx.terrain);
      // Avoidable itself, and doesn't stand in the way around any earlier trainer.
      if (avoidable(sight, s.i) && placedSights.every((other) => avoidable(other, s.i))) {
        ok = true;
        break;
      }
    }
    // Never generate a battle the player can't avoid (you can still place one by hand).
    if (!ok) continue;
    // A trainer must not watch another trainer's spot.
    if (sight.some((c) => taken[c])) continue;
    trainerNo++;
    if (s.watchesGrass) grassWatchers++;
    placedSights.push(sight);
    ctx.entities.push(e);
    taken[s.i] = 1;
  }
}

function tooClose(ctx: GenContext, i: number, kind: Entity["kind"], spacing: number): boolean {
  const [x, y] = ctx.xy(i);
  return ctx.entities.some((e) => e.kind === kind && Math.abs(e.x - x) + Math.abs(e.y - y) < spacing);
}
