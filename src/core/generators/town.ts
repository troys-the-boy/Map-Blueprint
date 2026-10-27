// The town generator (Milestone 5, part A).
//
//   1. Ground inside a tree border, the entrances carved through it (and the sea
//      along one side for a waterfront town). The user's zones and locked cells
//      stay as they are. With the Elevation setting, hillsides with cliffs,
//      stairs and ledges, as on routes.
//   2. Streets: a grid of roads, winding lanes, or a road along the shore. If
//      the user drew streets (locked path or road), those are the streets: they
//      are joined to the entrances and to each other, and the buildings go along
//      them. Streets cross rivers and locked water on bridges. Then the side
//      streets ending in dead ends (Side branches setting), with an item at the
//      end when Items at dead ends is on.
//   3. Buildings: the Pokémon Center, Mart, Gym, landmark and houses on lots
//      beside the streets. Every door is on the building's front (south) face,
//      as Gen 3 tilesets draw buildings, with a walk from the door to the street
//      and a warp to the interior: MAP_<TOWN>_POKEMON_CENTER_1F, _MART, _GYM,
//      _HOUSE1… (vanilla's naming, e.g. MAP_OLDALE_TOWN_MART). The interiors
//      aren't made: build them in Porymap.
//   4. Gardens, fences, trees, and small optional patches of tall grass near
//      the edges. Grass is never needed to reach an exit or a door.
//   5. The town sign, a sign by the Gym, people walking about, hidden items,
//      and the Pokémon Center's heal location (in front of its door).

import { DIRS, IS_WALKABLE, T, cheapestPath, distanceField } from "../grid";
import type { Warp } from "../model";
import { MoveGraph, openingCells } from "../reach";
import type { GenContext } from "./context";
import { Role } from "./context";
import { carveOpening } from "./routeSkeleton";
import { addPlateaus, connectStairs } from "./plateaus";
import type { BuildingKind } from "./townParams";
import { BUILDING_TYPES, buildingList } from "./townParams";

const PEOPLE_GRAPHICS = ["BOY_1", "GIRL_1", "MAN_1", "WOMAN_1", "OLD_MAN", "OLD_WOMAN", "POKEFAN_M", "POKEFAN_F", "SCHOOL_KID_M", "GENTLEMAN"];

export function buildTown(ctx: GenContext): void {
  const tp = ctx.input.town!;
  const bt = ctx.params.borderThickness;
  // 1. Ground inside the border. The sea and beach of a waterfront town, the user's zones and
  // locked cells are already laid; streets the user drew (locked path or road) are streets.
  let drawn = 0;
  for (let i = 0; i < ctx.n; i++) {
    if (ctx.locks[i]) {
      if (DRAWN_STREET.has(ctx.terrain[i])) {
        ctx.role[i] = Role.MainPath;
        drawn++;
      }
      continue;
    }
    if (ctx.role[i] !== Role.None) continue;
    if (ctx.edgeDist(i) < bt) ctx.set(i, T.tree, Role.Border);
    else ctx.set(i, T.ground, Role.None);
  }
  // Hills, like a route's hillsides (only when the Elevation setting is above 0).
  if (ctx.params.elevation > 0) addPlateaus(ctx);
  const ends = ctx.input.openings.map((o) => ({ o, end: carveOpening(ctx, o) }));
  ctx.openingEnds = ends.filter((e) => e.o.kind === "walk").map((e) => e.end);

  // 2. Streets.
  const street = tp.townLayout === "organic" ? T.path : T.road;
  const m = bt + 1;
  const streetOk = (j: number) => !ctx.locks[j] && (ctx.role[j] === Role.None || ctx.role[j] === Role.MainPath || ctx.role[j] === Role.Keep) && ctx.edgeDist(j) >= bt;
  // Over a river or water the user locked, a street becomes a bridge.
  const pave = (i: number, w = 2) => (ctx.role[i] === Role.Sea ? void ctx.bridge(i) : ctx.stamp(i, w, street, Role.MainPath, streetOk));
  const line = (x0: number, y0: number, x1: number, y1: number, w = 2) => {
    const dx = Math.sign(x1 - x0);
    const dy = Math.sign(y1 - y0);
    let x = x0;
    let y = y0;
    for (;;) {
      if (ctx.inside(x, y)) pave(ctx.idx(x, y), w);
      if (x === x1 && y === y1) break;
      if (x !== x1) x += dx;
      else y += dy;
    }
  };
  const clampX = (x: number) => Math.max(m, Math.min(ctx.width - m - 2, x));
  const clampY = (y: number) => Math.max(m, Math.min(ctx.height - m - 2, y));
  const endsXY = ctx.openingEnds.map((c) => ctx.xy(c));
  const land = (i: number) => ctx.role[i] !== Role.Sea && ctx.role[i] !== Role.Beach;
  // The middle of the dry land, across the town.
  let landLo = Infinity;
  let landHi = -Infinity;
  for (let i = 0; i < ctx.n; i++)
    if (land(i) && ctx.edgeDist(i) >= m) {
      const [x, y] = ctx.xy(i);
      const across = ctx.vertical ? x : y;
      landLo = Math.min(landLo, across);
      landHi = Math.max(landHi, across);
    }
  if (drawn >= 8) {
    // The user drew the streets: join every entrance and every separate piece of street.
    joinStreets(ctx, (i) => {
      if (ctx.role[i] === Role.Sea) return ctx.crossable[i] ? 14 : Infinity;
      if (ctx.role[i] === Role.MainPath || ctx.role[i] === Role.Opening) return 1;
      return streetOk(i) ? 3 : Infinity;
    }, (c) => pave(c, 1));
  } else if (tp.townLayout === "grid") {
    // A main street the long way through, cross streets every few blocks, and a side street if there's room.
    const avg = (k: 0 | 1) => Math.round(endsXY.reduce((s, p) => s + p[k], 0) / Math.max(1, endsXY.length));
    if (ctx.vertical) {
      const mx = clampX(endsXY.length ? avg(0) : Math.round((landLo + landHi) / 2));
      for (const [x, y] of endsXY) {
        line(x, y, mx, y);
      }
      line(mx, m, mx, ctx.height - m - 2);
      const block = ctx.rng.int(8, 10);
      for (let y = m + ctx.rng.int(5, 7); y < ctx.height - m - 4; y += block) line(clampX(landLo), y, clampX(landHi - 1), y);
    } else {
      const my = clampY(endsXY.length ? avg(1) : Math.round((landLo + landHi) / 2));
      for (const [x, y] of endsXY) line(x, y, x, my);
      line(m, my, ctx.width - m - 2, my);
      const block = ctx.rng.int(9, 12);
      for (let x = m + ctx.rng.int(5, 8); x < ctx.width - m - 4; x += block) line(x, clampY(landLo), x, clampY(landHi - 1));
    }
  } else {
    // Organic and waterfront: a lane between the entrances that wanders (or follows the shore),
    // then a few lanes off it.
    const fromSea = ctx.input.layout === "coastal" ? distanceField(ctx.width, ctx.height, Array.from({ length: ctx.n }, (_, i) => i).filter((i) => ctx.role[i] === Role.Sea)) : null;
    const cost = (i: number) => {
      if (ctx.role[i] === Role.Sea) return ctx.crossable[i] ? 14 : Infinity;
      if (!streetOk(i) && ctx.role[i] !== Role.Opening) return Infinity;
      if (ctx.edgeDist(i) < m) return 30;
      const [x, y] = ctx.xy(i);
      // Waterfront: cheapest a few cells in from the beach.
      const shore = fromSea ? Math.abs(fromSea[i] - 6) * 0.8 : 0;
      return 1 + shore + (tp.townLayout === "organic" ? 4 * ctx.noise.fractal(x, y, 9, 2) : 0);
    };
    const main: number[] = [];
    const first = ctx.openingEnds[0];
    for (const target of ctx.openingEnds.slice(1)) {
      const leg = cheapestPath(ctx.width, ctx.height, first, target, cost);
      if (leg) main.push(...leg);
    }
    for (const c of main) pave(c);
    // Lanes off the main one, out into the town.
    // More lanes in bigger towns: about one per 110 cells of land (small towns need the room for buildings).
    let landCells = 0;
    for (let i = 0; i < ctx.n; i++) if (land(i) && ctx.edgeDist(i) >= m) landCells++;
    const lanes = Math.max(1, Math.min(tp.townLayout === "organic" ? 5 : 6, Math.round(landCells / 110)));
    for (let k = 0; k < lanes && main.length > 10; k++) {
      const from = main[Math.floor(main.length * ctx.rng.range(0.2, 0.8))];
      const [fx, fy] = ctx.xy(from);
      const reach = ctx.rng.int(7, 12);
      const away = fromSea ? (fromSea[ctx.idx(clampX(fx + 1), fy)] > fromSea[from] ? 1 : -1) : ctx.rng.chance(0.5) ? 1 : -1;
      const tx = ctx.vertical ? clampX(fx + away * reach) : clampX(fx + ctx.rng.int(-3, 3));
      const ty = ctx.vertical ? clampY(fy + ctx.rng.int(-3, 3)) : clampY(fy + away * reach);
      const leg = cheapestPath(ctx.width, ctx.height, from, ctx.idx(tx, ty), cost);
      if (leg) for (const c of leg) pave(c, 2);
    }
  }
  ctx.mainLine = [];
  for (let i = 0; i < ctx.n; i++) if (ctx.role[i] === Role.MainPath) ctx.mainLine.push(i);
  // Trails up the hillsides' stairs, then side streets ending in dead ends.
  if (ctx.params.elevation > 0) connectStairs(ctx);
  addSideStreets(ctx, street, streetOk);

  // 3. Buildings.
  placeBuildings(ctx, street);

  // 4. Gardens, fences, trees and edge grass.
  decorate(ctx);
  addEdgeGrass(ctx);

  // 5. People.
  addPeople(ctx);
}

const free = (ctx: GenContext, i: number) => !ctx.locks[i] && ctx.role[i] === Role.None && ctx.terrain[i] === T.ground && ctx.edgeDist(i) >= ctx.params.borderThickness;

/** Streets the user may draw: path, road or a bridge, locked. */
const DRAWN_STREET = new Set<number>([T.path, T.road, T.bridge]);

/** A street a door's walk can join: a street, a side street, or a trail up the stairs. */
const isStreet = (ctx: GenContext, i: number) => ctx.role[i] === Role.MainPath || ctx.role[i] === Role.Branch;

/**
 * Join the user's drawn streets into one network with the entrances: each piece
 * (and each entrance) is linked to the nearest piece already joined.
 */
function joinStreets(ctx: GenContext, cost: (i: number) => number, pave: (i: number) => void): void {
  const isS = (i: number) => ctx.role[i] === Role.MainPath;
  const piece = new Int32Array(ctx.n).fill(-1);
  const pieces: number[][] = [];
  for (let i = 0; i < ctx.n; i++) {
    if (!isS(i) || piece[i] >= 0) continue;
    const id = pieces.length;
    const cells = [i];
    piece[i] = id;
    for (let k = 0; k < cells.length; k++) {
      const [x, y] = ctx.xy(cells[k]);
      for (const { dx, dy } of DIRS) {
        if (!ctx.inside(x + dx, y + dy)) continue;
        const j = ctx.idx(x + dx, y + dy);
        if (isS(j) && piece[j] < 0) (piece[j] = id, cells.push(j));
      }
    }
    pieces.push(cells);
  }
  const targets = [...pieces, ...ctx.openingEnds.map((e) => [e])];
  if (!targets.length) return;
  const joined: number[] = [...targets[0]];
  for (const t of targets.slice(1)) {
    // The closest pair of cells between this piece and what's joined so far (sampled for speed).
    let best: [number, number] | null = null;
    let bestD = Infinity;
    const sample = (list: number[]) => (list.length > 60 ? list.filter((_, k) => k % Math.ceil(list.length / 60) === 0) : list);
    for (const a of sample(t))
      for (const b of sample(joined)) {
        const [ax, ay] = ctx.xy(a);
        const [bx, by] = ctx.xy(b);
        const d = Math.abs(ax - bx) + Math.abs(ay - by);
        if (d < bestD) (bestD = d, (best = [a, b]));
      }
    if (best && bestD > 1) for (const c of cheapestPath(ctx.width, ctx.height, best[0], best[1], cost) ?? []) pave(c);
    joined.push(...t);
  }
}

/** Side streets off the streets, each ending in a dead end (Side branches setting, length from Branch length). */
function addSideStreets(ctx: GenContext, street: number, streetOk: (i: number) => boolean): void {
  const p = ctx.params;
  if (!p.branches || ctx.mainLine.length < 10) return;
  const fromStreet = distanceField(ctx.width, ctx.height, ctx.mainLine);
  for (let b = 0; b < p.branches; b++) {
    for (let attempt = 0; attempt < 12; attempt++) {
      const from = ctx.rng.pick(ctx.mainLine);
      const [fx, fy] = ctx.xy(from);
      const reach = Math.round(4 + p.branchLength * 8 * ctx.rng.range(0.6, 1));
      const d = ctx.rng.pick(DIRS);
      const tx = fx + d.dx * reach;
      const ty = fy + d.dy * reach;
      if (!ctx.inside(tx, ty)) continue;
      const target = ctx.idx(tx, ty);
      // The end must be well away from the streets, on the same level, on free ground.
      if (fromStreet[target] < 4 || !free(ctx, target) || ctx.elevation[target] !== ctx.elevation[from]) continue;
      const leg = cheapestPath(ctx.width, ctx.height, from, target, (i) => (i === from || (streetOk(i) && ctx.elevation[i] === ctx.elevation[from]) ? 1 : Infinity));
      if (!leg) continue;
      for (const c of leg.slice(1)) if (ctx.role[c] !== Role.MainPath) ctx.set(c, street, Role.Branch);
      ctx.deadEnds.push(target);
      break;
    }
  }
}

function placeBuildings(ctx: GenContext, street: number): void {
  const tp = ctx.input.town!;
  const kinds = buildingList(tp);
  const fromStreet = distanceField(ctx.width, ctx.height, ctx.mainLine);
  const fromEntrance = distanceField(ctx.width, ctx.height, ctx.openingEnds.length ? ctx.openingEnds : [0]);
  let houseNo = 0;
  const label = ctx.input.labelBase;
  const constant = ctx.input.mapConstant ?? "MAP_TOWN";
  for (const kind of kinds) {
    const big = kind === "house" && houseNo < tp.largeHouses;
    const type = BUILDING_TYPES[kind];
    const w = big ? 5 : type.width;
    const h = big ? 4 : type.height;
    // Every top-left corner where the building, a cell of space round it, and a short walk from
    // its door down to a street all fit.
    type Lot = { x: number; y: number; walk: number[]; score: number };
    const lots: Lot[] = [];
    for (let y = 0; y + h < ctx.height; y++)
      for (let x = 0; x + w <= ctx.width; x++) {
        let ok = true;
        for (let yy = y - 1; yy <= y + h - 1 && ok; yy++)
          for (let xx = x - 1; xx <= x + w && ok; xx++) {
            if (!ctx.inside(xx, yy)) {
              ok = false;
              break;
            }
            const i = ctx.idx(xx, yy);
            const inside = xx >= x && xx < x + w && yy >= y;
            // The building itself on free, level ground; its margin may be ground or trees, never street or another building.
            ok = inside
              ? free(ctx, i) && ctx.elevation[i] === ctx.elevation[ctx.idx(x, y + h - 1)]
              : ctx.role[i] !== Role.MainPath && ctx.role[i] !== Role.Branch && ctx.role[i] !== Role.Building && ctx.role[i] !== Role.Opening;
          }
        if (!ok) continue;
        // The door is in the middle of the front (bottom) row. From the cell in front of it, a
        // short walk (it may turn) leads to a street.
        const doorX = x + Math.floor(w / 2);
        const walk = walkToStreet(ctx, ctx.idx(doorX, y + h), (i) => {
          const [ix, iy] = ctx.xy(i);
          return ix >= x - 1 && ix <= x + w && iy >= y - 1 && iy < y + h;
        });
        if (!walk) continue;
        const door = ctx.idx(doorX, y + h - 1);
        // The Center and Mart sit near the entrances on the main street; the Gym and landmark further in; houses anywhere.
        const near = fromEntrance[door];
        const score =
          ctx.rng.next() * 6 +
          (kind === "center" || kind === "mart" ? -near * 0.5 : kind === "gym" || kind === "landmark" ? Math.min(near, 25) * 0.3 : 0) -
          walk.length * 1.5 -
          fromStreet[door] * 0.2;
        lots.push({ x, y, walk, score });
      }
    if (!lots.length) continue;
    lots.sort((a, b) => b.score - a.score);
    const lot = lots[0];
    for (let yy = lot.y; yy < lot.y + h; yy++) for (let xx = lot.x; xx < lot.x + w; xx++) ctx.set(ctx.idx(xx, yy), T.building, Role.Building);
    // A one-cell ring of yard around it stays clear (no trees or fences against the walls).
    for (let yy = lot.y - 1; yy <= lot.y + h; yy++)
      for (let xx = lot.x - 1; xx <= lot.x + w; xx++) if (ctx.inside(xx, yy) && ctx.role[ctx.idx(xx, yy)] === Role.None) ctx.role[ctx.idx(xx, yy)] = Role.Clearing;
    for (const c of lot.walk) ctx.set(c, street, Role.MainPath);
    const doorX = lot.x + Math.floor(w / 2);
    const doorY = lot.y + h - 1;
    const front = ctx.idx(doorX, doorY + 1);
    ctx.keepClear.add(front);
    if (kind === "house") houseNo++;
    const interior = constant + (kind === "house" ? `${type.interior}${houseNo}` : type.interior);
    const warp: Warp = { id: `w${ctx.warps.length + 1}`, kind: "door", x: doorX, y: doorY, elevation: "ground", destMap: interior, destWarpId: 0 };
    ctx.warps.push(warp);
    ctx.buildings.push({ kind, x: lot.x, y: lot.y, w, h, door: ctx.idx(doorX, doorY) });
    if (kind === "center")
      ctx.entities.push({
        id: "P1",
        kind: "heal_location",
        x: doorX,
        y: doorY + 1,
        elevation: "ground",
        fields: { id: `HEAL_LOCATION_${constant.replace(/^MAP_/, "")}`, map: constant, note: "Goes in src/data/heal_locations.json (id, map, x, y): where the player wakes after a whiteout and lands after Fly." },
      });
    if (kind === "gym") {
      // A sign beside the Gym's door, on the street side.
      for (const dx of [-2, 2, -3, 3]) {
        const sx = doorX + dx;
        const sy = doorY + 1;
        if (!ctx.inside(sx, sy)) continue;
        const s = ctx.idx(sx, sy);
        if (ctx.locks[s] || ctx.keepClear.has(s) || ctx.role[s] === Role.MainPath || ctx.role[s] === Role.Opening) continue;
        if (ctx.terrain[s] !== T.ground) continue;
        ctx.set(s, T.signTile, Role.Building);
        ctx.entities.push({
          id: "S2",
          kind: "sign",
          x: sx,
          y: sy,
          elevation: "ground",
          fields: { player_facing_dir: "BG_EVENT_PLAYER_FACING_NORTH", script: `${label}_EventScript_GymSign`, text: `${label.replace(/([a-z])([A-Z])/g, "$1 $2")} Pokémon Gym` },
        });
        break;
      }
    }
  }
}

/**
 * The shortest walk (at most 6 cells) over free ground from a door's front step to
 * a street, not through the lot itself. Returns the cells to pave (empty if the
 * step is already on a street), or null if there's no street that close.
 */
function walkToStreet(ctx: GenContext, step: number, inLot: (i: number) => boolean): number[] | null {
  if (isStreet(ctx, step)) return [];
  if (!free(ctx, step)) return null;
  const level = ctx.elevation[step];
  const prev = new Map<number, number>([[step, -1]]);
  let frontier = [step];
  for (let depth = 0; depth < 6 && frontier.length; depth++) {
    const next: number[] = [];
    for (const c of frontier) {
      const [x, y] = ctx.xy(c);
      for (const d of DIRS) {
        if (!ctx.inside(x + d.dx, y + d.dy)) continue;
        const j = ctx.idx(x + d.dx, y + d.dy);
        if (prev.has(j) || inLot(j) || ctx.elevation[j] !== level) continue;
        if (isStreet(ctx, j)) {
          const out: number[] = [];
          for (let k = c; k >= 0; k = prev.get(k)!) out.push(k);
          return out;
        }
        if (!free(ctx, j)) continue;
        prev.set(j, c);
        next.push(j);
      }
    }
    frontier = next;
  }
  return null;
}

/** Would a tree here touch another only at a corner (which tilesets can't draw)? */
function cornerOnly(ctx: GenContext, i: number): boolean {
  const [x, y] = ctx.xy(i);
  const tree = (xx: number, yy: number) => ctx.inside(xx, yy) && ctx.isWall(ctx.idx(xx, yy));
  for (const [dx, dy] of [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ])
    if (tree(x + dx, y + dy) && !tree(x + dx, y) && !tree(x, y + dy)) return true;
  return false;
}

/** Flower beds, short fences framing front yards, and a few trees, without cutting anything off. */
function decorate(ctx: GenContext): void {
  const p = ctx.params;
  for (const b of ctx.buildings) {
    if (b.kind !== "house") continue;
    // Fences down both sides of the front yard, two cells long, on half the houses.
    if (ctx.rng.chance(0.5)) {
      for (const fx of [b.x - 1, b.x + b.w])
        for (let fy = b.y + b.h - 1; fy <= b.y + b.h; fy++) {
          if (!ctx.inside(fx, fy)) continue;
          const i = ctx.idx(fx, fy);
          if ((ctx.role[i] === Role.Clearing || ctx.role[i] === Role.None) && ctx.terrain[i] === T.ground && !ctx.keepClear.has(i)) ctx.set(i, T.fence, Role.Building);
        }
    }
    // A flower bed beside the house.
    const side = ctx.rng.chance(0.5) ? -2 : b.w + 1;
    for (let k = 0; k < 2; k++) {
      const fx = b.x + side;
      const fy = b.y + k;
      if (ctx.inside(fx, fy) && free(ctx, ctx.idx(fx, fy))) ctx.set(ctx.idx(fx, fy), T.flowers, Role.Clearing);
    }
  }
  // Meadow towns: drifts of flowers over the open ground.
  if (ctx.input.biome === "meadow")
    for (let i = 0; i < ctx.n; i++) {
      if (!free(ctx, i) || ctx.keepClear.has(i)) continue;
      const [x, y] = ctx.xy(i);
      if (ctx.noise.fractal(x + 6100, y + 6300, 5, 2) > 0.58) ctx.set(i, T.flowers, Role.Clearing);
    }
  // Trees dotted about the open ground, never beside a street, door or another tree group's gap.
  const fromStreet = distanceField(ctx.width, ctx.height, ctx.mainLine);
  for (let i = 0; i < ctx.n; i++) {
    if (!free(ctx, i) || fromStreet[i] < 2 || ctx.keepClear.has(i)) continue;
    if (ctx.rng.next() < p.treeDensity * 0.12 && !cornerOnly(ctx, i)) ctx.set(i, T.tree, Role.None);
  }
  // Near the border the trees thicken into the edge of the woods.
  for (let i = 0; i < ctx.n; i++) {
    if (!free(ctx, i) || fromStreet[i] < 3) continue;
    const d = ctx.edgeDist(i) - p.borderThickness;
    if (d <= 1 && ctx.noise.at(i * 0.37, 11) < 0.35 + p.treeDensity * 0.4 && !cornerOnly(ctx, i)) ctx.set(i, T.tree, Role.None);
  }
}

/** Places the player must be able to reach: the entrances and every door. */
function mustReach(ctx: GenContext): number[] {
  const out = ctx.input.openings.filter((o) => o.kind === "walk").flatMap((o) => openingCells(o, ctx.width, ctx.height));
  for (const b of ctx.buildings) {
    const [x, y] = ctx.xy(b.door);
    if (ctx.inside(x, y + 1)) out.push(ctx.idx(x, y + 1));
  }
  return out;
}

/**
 * Small tall-grass patches near the edges, only where they aren't in the way:
 * with grass counted as a wall, every entrance and door must still be reachable.
 */
function addEdgeGrass(ctx: GenContext): void {
  const tp = ctx.input.town!;
  const patches = Math.round(tp.edgeGrass * 5);
  if (!patches) return;
  const bt = ctx.params.borderThickness;
  const starts = ctx.input.openings.filter((o) => o.kind === "walk").flatMap((o) => openingCells(o, ctx.width, ctx.height));
  const targets = mustReach(ctx);
  const reachAllWithoutGrass = () => {
    const terrain = ctx.terrain.slice();
    for (let i = 0; i < ctx.n; i++) if (terrain[i] === T.tallGrass) terrain[i] = T.tree;
    const reach = new MoveGraph({ width: ctx.width, height: ctx.height, terrain, entities: ctx.entities }, new Set()).forward(starts);
    return targets.every((c) => reach[c]);
  };
  const seeds: number[] = [];
  for (let i = 0; i < ctx.n; i++) {
    const d = ctx.edgeDist(i) - bt;
    if (d >= 0 && d <= 3 && free(ctx, i)) seeds.push(i);
  }
  let made = 0;
  for (const seed of ctx.rng.shuffle(seeds)) {
    if (made >= patches) break;
    if (!free(ctx, seed)) continue;
    // Grow a blob of 6–14 cells over free ground near the edge.
    const size = ctx.rng.int(6, 14);
    const blob = [seed];
    const inBlob = new Set(blob);
    for (let k = 0; k < blob.length && blob.length < size; k++) {
      const [x, y] = ctx.xy(blob[k]);
      for (const d of ctx.rng.shuffle([...DIRS])) {
        const xx = x + d.dx;
        const yy = y + d.dy;
        if (!ctx.inside(xx, yy)) continue;
        const j = ctx.idx(xx, yy);
        if (inBlob.has(j) || !free(ctx, j) || ctx.edgeDist(j) - bt > 5) continue;
        blob.push(j);
        inBlob.add(j);
        if (blob.length >= size) break;
      }
    }
    if (blob.length < 6) continue;
    for (const c of blob) ctx.set(c, T.tallGrass, Role.Clearing);
    if (reachAllWithoutGrass()) made++;
    else for (const c of blob) ctx.set(c, T.ground, Role.None);
  }
}

/** People wandering beside the streets (not on a door's front step, not in a narrow gap). */
function addPeople(ctx: GenContext): void {
  const tp = ctx.input.town!;
  const label = ctx.input.labelBase;
  const spots: number[] = [];
  for (let i = 0; i < ctx.n; i++) {
    if (ctx.locks[i] || ctx.keepClear.has(i) || !IS_WALKABLE[ctx.terrain[i]] || ctx.terrain[i] === T.tallGrass) continue;
    if (ctx.role[i] === Role.Opening || ctx.role[i] === Role.MainPath) continue;
    const [x, y] = ctx.xy(i);
    // Beside a street, with open ground all round (so a person never closes a gap).
    let open = 0;
    let streetNext = false;
    for (const d of DIRS) {
      if (!ctx.inside(x + d.dx, y + d.dy)) continue;
      const j = ctx.idx(x + d.dx, y + d.dy);
      if (IS_WALKABLE[ctx.terrain[j]]) open++;
      if (ctx.role[j] === Role.MainPath) streetNext = true;
    }
    if (open === 4 && streetNext) spots.push(i);
  }
  let n = 0;
  const taken = new Set(ctx.entities.map((e) => ctx.idx(e.x, e.y)));
  for (const i of ctx.rng.shuffle(spots)) {
    if (n >= tp.people) break;
    const [x, y] = ctx.xy(i);
    if (ctx.entities.some((e) => Math.abs(e.x - x) + Math.abs(e.y - y) < 5) || taken.has(i)) continue;
    n++;
    ctx.entities.push({
      id: `N${n}`,
      kind: "npc",
      x,
      y,
      elevation: "ground",
      fields: {
        graphics_id: `OBJ_EVENT_GFX_${ctx.rng.pick(PEOPLE_GRAPHICS)}`,
        movement_type: "MOVEMENT_TYPE_WANDER_AROUND",
        movement_range_x: 1,
        movement_range_y: 1,
        trainer_type: "TRAINER_TYPE_NONE",
        trainer_sight_or_berry_tree_id: "0",
        script: `${label}_EventScript_Person${n}`,
        flag: "0",
      },
    });
  }
}

/** The kind of a generated building, for later stages. */
export type TownBuilding = { kind: BuildingKind; x: number; y: number; w: number; h: number; door: number };
