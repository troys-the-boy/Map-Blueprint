// The town generator (Milestone 5, part A).
//
//   1. Ground inside a tree border, the entrances carved through it (and the sea
//      along one side for a waterfront town). The user's zones and locked cells
//      stay as they are. With the Elevation setting, hillsides with cliffs,
//      stairs and ledges, as on routes.
//   2. The core: the middle of the town, on flat buildable land between its
//      entrances. Everything grows from it.
//      Streets, by the town's plan: a market square with streets in from the
//      entrances; a crossroads; a grid of roads; winding lanes; a road along the
//      shore; or lanes along a river. If
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

import { DIRS, IS_WALKABLE, IS_WALL, IS_WATER, T, cheapestPath, cheapestRoad, components, distanceField } from "../grid";
import type { Warp } from "../model";
import { openingLevel } from "../model";
import { MoveGraph, openingCells } from "../reach";
import type { GenContext } from "./context";
import { LEVEL, RAISED, Role } from "./context";
import { carveOpening } from "./routeSkeleton";
import { addPlateaus, connectStairs, cutStairs, joinLevels, roadGates, zonedHeights } from "./plateaus";
import { CLIMB_COST } from "./routeSkeleton";
import type { BuildingKind, TownParams } from "./townParams";
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
  if (ctx.params.elevation > 0 || zonedHeights(ctx) || ctx.input.openings.some((o) => openingLevel(o) > 0)) addPlateaus(ctx);
  // A hilltop is building land like the valley (on routes it's left as open ground).
  for (let i = 0; i < ctx.n; i++) if (!ctx.locks[i] && ctx.role[i] === Role.Clearing) ctx.role[i] = Role.None;
  const ends = ctx.input.openings.map((o) => ({ o, end: carveOpening(ctx, o) }));
  ctx.openingEnds = ends.filter((e) => e.o.kind === "walk").map((e) => e.end);

  // 2. Streets.
  const winding = tp.townLayout === "organic" || tp.townLayout === "riverside";
  const street = winding ? T.path : T.road;
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
  // The core of the town: flat, dry, buildable land nearest the middle of its entrances.
  const core = townCore(ctx, streetOk, land);
  const [coreX, coreY] = ctx.xy(core);
  // Lanes read the terrain: they climb a cliff where a flight of stairs fits (cutting it
  // there), cross water straight, and follow a lane that's already laid rather than run beside it.
  const gates = roadGates(ctx);
  const laneOver = (cost: (i: number) => number, turn = 0) => (a: number, b: number): number[] | null => {
    const leg = cheapestRoad(
      ctx.width,
      ctx.height,
      a,
      b,
      (i) => (gates[i] && ctx.role[i] === Role.Cliff ? CLIMB_COST : ctx.role[i] === Role.Stairs ? 1 : ctx.role[i] === Role.MainPath ? Math.min(0.5, cost(i)) : cost(i)),
      { gate: (i) => gates[i], straight: (i) => ctx.role[i] === Role.Sea, least: 0.5, turn },
    );
    for (const c of leg ?? []) if (gates[c] && ctx.role[c] === Role.Cliff) cutStairs(ctx, c);
    return leg;
  };
  if (drawn >= 8) {
    // The user drew the streets: join every entrance and every separate piece of street.
    joinStreets(ctx, (i) => {
      if (ctx.role[i] === Role.Sea) return ctx.crossable[i] ? 14 : Infinity;
      if (ctx.role[i] === Role.MainPath || ctx.role[i] === Role.Opening) return 1;
      return streetOk(i) ? 3 : Infinity;
    }, (c) => pave(c, 1));
  } else if (tp.townLayout === "square" || tp.townLayout === "crossroads") {
    // Grown from the core: a market square (or just the crossing), a street in from every
    // entrance, a street each way along the south side for house fronts, and a short one north.
    const plain = (i: number) => {
      if (ctx.role[i] === Role.Sea) return ctx.crossable[i] ? 14 : Infinity;
      if (!streetOk(i) && ctx.role[i] !== Role.Opening) return Infinity;
      return ctx.edgeDist(i) < m ? 30 : 1;
    };
    const lane = laneOver(plain, 2);
    const level = ctx.elevation[core];
    const big = ctx.width >= 50 && ctx.height >= 50;
    const pw = tp.townLayout === "square" ? (big ? 8 : 6) : 2;
    const ph = tp.townLayout === "square" ? (big ? 5 : 4) : 2;
    const x0 = coreX - Math.floor(pw / 2);
    const y0 = coreY - Math.floor(ph / 2);
    for (let y = y0; y < y0 + ph; y++)
      for (let x = x0; x < x0 + pw; x++) {
        if (!ctx.inside(x, y)) continue;
        const i = ctx.idx(x, y);
        if (streetOk(i) && land(i) && ctx.elevation[i] === level) ctx.set(i, street, Role.MainPath);
      }
    for (const end of ctx.openingEnds) for (const c of lane(end, core) ?? []) pave(c);
    // A straight street from the core, as far as the land stays level and clear.
    const run = (x: number, y: number, dx: number, dy: number, length: number) => {
      for (let k = 0; k < length; k++, x += dx, y += dy) {
        if (!ctx.inside(x, y) || !ctx.inside(x + 1, y + 1)) break;
        const i = ctx.idx(x, y);
        if (!streetOk(i) || !land(i) || ctx.elevation[i] !== level || ctx.edgeDist(i) < m + 1) break;
        pave(i);
      }
    };
    const along = Math.max(8, Math.min(18, Math.round(ctx.width / 4)));
    const up = Math.max(5, Math.min(10, Math.round(ctx.height / 6)));
    const row = y0 + ph - 2;
    run(x0 - 1, row, -1, 0, along);
    run(x0 + pw, row, 1, 0, along);
    run(coreX, y0 - 1, 0, -1, up);
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
    // Winding lanes, the harbour and the riverside: a lane between the entrances that wanders
    // (or follows the shore or the river bank), then a few lanes off it.
    // (The water may be the plan's own, or a river or sea the map already had from the
    // region sketch or its zones: the lanes follow whichever is there.)
    const riverside = tp.townLayout === "riverside";
    const wet = riverside || tp.townLayout === "waterfront" ? Array.from({ length: ctx.n }, (_, i) => i).filter((i) => ctx.role[i] === Role.Sea) : [];
    const fromSea = wet.length ? distanceField(ctx.width, ctx.height, wet) : null;
    const cost = (i: number) => {
      if (ctx.role[i] === Role.Sea) return ctx.crossable[i] ? 14 : Infinity;
      if (!streetOk(i) && ctx.role[i] !== Role.Opening) return Infinity;
      if (ctx.edgeDist(i) < m) return 30;
      const [x, y] = ctx.xy(i);
      // Harbour: cheapest a few cells in from the beach. Riverside: along the bank.
      const shore = fromSea ? Math.abs(fromSea[i] - (riverside ? 4 : 6)) * 0.8 : 0;
      return 1 + shore + (winding ? 4 * ctx.noise.fractal(x, y, 9, 2) : 0);
    };
    const lane = laneOver(cost);
    const main: number[] = [];
    const first = ctx.openingEnds[0];
    for (const target of ctx.openingEnds.slice(1)) {
      const leg = lane(first, target);
      if (leg) {
        main.push(...leg);
        for (const c of leg) pave(c);
      }
    }
    for (const c of main) pave(c);
    // Lanes off the main one, out into the town.
    // More lanes in bigger towns: about one per 110 cells of land (small towns need the room for buildings).
    let landCells = 0;
    for (let i = 0; i < ctx.n; i++) if (land(i) && ctx.edgeDist(i) >= m) landCells++;
    const lanes = Math.max(1, Math.min(winding ? 5 : 6, Math.round(landCells / 110)));
    for (let k = 0; k < lanes && main.length > 10; k++) {
      const from = main[Math.floor(main.length * ctx.rng.range(0.2, 0.8))];
      const [fx, fy] = ctx.xy(from);
      const reach = ctx.rng.int(7, 12);
      const away = fromSea ? (fromSea[ctx.idx(clampX(fx + 1), fy)] > fromSea[from] ? 1 : -1) : ctx.rng.chance(0.5) ? 1 : -1;
      const tx = ctx.vertical ? clampX(fx + away * reach) : clampX(fx + ctx.rng.int(-3, 3));
      const ty = ctx.vertical ? clampY(fy + ctx.rng.int(-3, 3)) : clampY(fy + away * reach);
      const leg = lane(from, ctx.idx(tx, ty));
      if (leg) for (const c of leg) pave(c, 2);
    }
    // A riverside town is on both banks: if the lanes so far all keep to one bank, one more
    // crosses to the biggest stretch of land on the other side, a few cells in from the water.
    if (riverside && main.length && fromSea) {
      const dry = (i: number) => land(i) && ctx.edgeDist(i) >= m && (streetOk(i) || ctx.role[i] === Role.Opening);
      const banks = components(ctx.width, ctx.height, dry);
      const home = new Set<number>();
      for (let i = 0; i < ctx.n; i++) if (ctx.role[i] === Role.MainPath && banks.ids[i] >= 0) home.add(banks.ids[i]);
      let far = -1;
      banks.sizes.forEach((size, id) => {
        if (!home.has(id) && size >= 40 && (far < 0 || size > banks.sizes[far])) far = id;
      });
      if (far >= 0) {
        const from = main[Math.floor(main.length / 2)];
        const [fx, fy] = ctx.xy(from);
        let target = -1;
        let best = Infinity;
        for (let i = 0; i < ctx.n; i++) {
          if (banks.ids[i] !== far || fromSea[i] < 3 || fromSea[i] > 7) continue;
          const [x, y] = ctx.xy(i);
          const d = Math.abs(x - fx) + Math.abs(y - fy);
          if (d < best) (best = d, (target = i));
        }
        if (target >= 0) for (const c of lane(from, target) ?? []) pave(c, 2);
      }
    }
  }
  // Trails up the hillsides' stairs, and a street along each terrace, so there are lots up there too.
  // Stairs wherever an entrance is still cut off by a hill (a grid of streets doesn't climb).
  joinLevels(ctx);
  if (ctx.stairs.length) {
    connectStairs(ctx);
    addTerraceStreets(ctx, street, streetOk);
  }
  // A walk to the door of each building you painted.
  connectPaintedBuildings(ctx, street, Role.MainPath);
  ctx.mainLine = [];
  for (let i = 0; i < ctx.n; i++) if (ctx.role[i] === Role.MainPath) ctx.mainLine.push(i);
  // Side streets ending in dead ends.
  addSideStreets(ctx, street, streetOk);

  // 3. Buildings.
  placeBuildings(ctx, street, tp, { build: (i) => free(ctx, i), walk: (i) => free(ctx, i), maxWalk: 6, role: Role.MainPath, yard: true, focus: core });
  if (tp.wall) addTownWall(ctx);

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

/**
 * A street along each terrace of a hillside, from the top of its stairs to its far
 * end, so buildings have a street to stand beside up there. Without one, every lot
 * on a hill is too far from a street and the whole town ends up in the valley.
 */
function addTerraceStreets(ctx: GenContext, street: number, streetOk: (i: number) => boolean): void {
  for (const f of ctx.stairs) {
    if (ctx.terrain[f.cell] !== T.stairs) continue;
    const level = ctx.elevation[f.back];
    if (level === LEVEL.ground || level === LEVEL.water) continue;
    const ok = (i: number) => i === f.back || (streetOk(i) && ctx.elevation[i] === level && ctx.role[i] !== Role.Stairs);
    const dist = distanceField(ctx.width, ctx.height, [f.back], ok);
    // The terrace's land. If another flight already gave it a street, join that; otherwise run
    // a street to its far end, if it's big enough to build on.
    let size = 0;
    let far = f.back;
    let joined = -1;
    for (let i = 0; i < ctx.n; i++) {
      if (dist[i] === Infinity) continue;
      size++;
      if (dist[i] > dist[far]) far = i;
      if (ctx.role[i] === Role.MainPath && (joined < 0 || dist[i] < dist[joined])) joined = i;
    }
    const target = joined >= 0 ? joined : size >= 30 ? far : -1;
    if (target < 0) continue;
    // Doors face south, so the lane keeps to the south side of the terrace where it can
    // (one cell in from the edge), leaving the land north of it for buildings.
    const leg = cheapestPath(ctx.width, ctx.height, f.back, target, (i) => {
      if (!ok(i)) return Infinity;
      const [x, y] = ctx.xy(i);
      const south = (k: number) => ctx.inside(x, y + k) && ok(ctx.idx(x, y + k));
      return south(1) && !south(2) ? 1 : 2.5;
    });
    for (const c of leg ?? []) if (c !== f.back) ctx.set(c, street, Role.MainPath);
  }
}

/** A path to the door of each building you painted (every land style but a town, which does it with its streets). */
export function connectBuildings(ctx: GenContext): void {
  connectPaintedBuildings(ctx, ctx.trail, Role.Branch);
}

/**
 * Buildings the user painted (locked building cells) get a door and a walk to it.
 * The door is a door warp the user placed on the building, or else the middle of
 * its front (south) face, where Gen 3 tilesets draw doors: a door warp is made
 * there. The walk runs from the step in front of the door to the nearest path on
 * the same level. A building no path can reach is left alone, with a note.
 */
function connectPaintedBuildings(ctx: GenContext, street: number, role: Role): void {
  const painted = (i: number) => ctx.locks[i] === 1 && ctx.terrain[i] === T.building;
  const comp = components(ctx.width, ctx.height, painted);
  if (!comp.sizes.length) return;
  const cells: number[][] = comp.sizes.map(() => []);
  for (let i = 0; i < ctx.n; i++)
    if (comp.ids[i] >= 0 && painted(i)) {
      cells[comp.ids[i]].push(i);
      ctx.role[i] = Role.Building;
    }
  const bt = ctx.params.borderThickness;
  const constant = ctx.input.mapConstant ?? "MAP_TOWN";
  const joinable = new Set<number>([Role.MainPath, Role.Branch, Role.Opening, Role.Bridge]);
  let made = 0;
  cells.forEach((list, id) => {
    if (!list.length) return;
    const inThis = (x: number, y: number) => ctx.inside(x, y) && comp.ids[ctx.idx(x, y)] === id && painted(ctx.idx(x, y));
    // Doors the user placed on it; otherwise the middle of the lowest stretch of its south face.
    let doors = ctx.input.warps.filter((w) => w.locked && inThis(w.x, w.y)).map((w) => ctx.idx(w.x, w.y));
    const [x0, y0] = ctx.xy(list[0]);
    if (!doors.length) {
      const face = list.filter((i) => {
        const [x, y] = ctx.xy(i);
        return y + 1 < ctx.height && !inThis(x, y + 1);
      });
      if (!face.length) return void ctx.notes.push(`The building you painted at (${x0}, ${y0}) has no room in front (south) for a door.`);
      const low = Math.max(...face.map((i) => ctx.xy(i)[1]));
      const row = face.filter((i) => ctx.xy(i)[1] === low).sort((a, b) => a - b);
      const door = row[Math.floor((row.length - 1) / 2)];
      const [dx, dy] = ctx.xy(door);
      made++;
      ctx.warps.push({ id: `w${ctx.warps.length + 1}`, kind: "door", x: dx, y: dy, elevation: "ground", destMap: `${constant}_BUILDING${made}`, destWarpId: 0 });
      doors = [door];
    }
    const [bx, by] = ctx.xy(Math.min(...list));
    const xs = list.map((i) => ctx.xy(i)[0]);
    const ys = list.map((i) => ctx.xy(i)[1]);
    ctx.buildings.push({ kind: "house", x: bx, y: by, w: Math.max(...xs) - Math.min(...xs) + 1, h: Math.max(...ys) - by + 1, door: doors[0], painted: true });
    // The whole building stands at the level of the ground in front of its (first) door.
    const [fx, fy] = ctx.xy(doors[0]);
    if (fy + 1 < ctx.height) for (const c of list) ctx.elevation[c] = ctx.elevation[ctx.idx(fx, fy + 1)];
    for (const door of doors) {
      const [dx, dy] = ctx.xy(door);
      const fail = (why: string) => void ctx.notes.push(`No path could be drawn to the building you painted at (${dx}, ${dy}): ${why}`);
      if (dy + 1 >= ctx.height) {
        fail("its door is on the map's bottom edge.");
        continue;
      }
      const step = ctx.idx(dx, dy + 1);
      const dry = (i: number) => IS_WALKABLE[ctx.terrain[i]] && !IS_WATER[ctx.terrain[i]];
      // Where the walk may go: on its own level, over ground, trees or rock, never through a
      // cliff, water, the border, another building, or a wall you locked.
      const level = ctx.elevation[step];
      const passable = (i: number) => {
        if (ctx.elevation[i] !== level || ctx.edgeDist(i) < bt) return false;
        if (ctx.locks[i]) return dry(i);
        const r = ctx.role[i];
        if (r === Role.Cliff || r === Role.Border || r === Role.Sea || r === Role.Beach || r === Role.Pocket || r === Role.Building || r === Role.Corridor || r === Role.Water) return false;
        const t = ctx.terrain[i];
        return t !== T.stairs && (dry(i) || IS_WALL[t]);
      };
      if (!passable(step)) {
        fail("the cell in front of its door (south) is blocked. Clear it, or move the building.");
        continue;
      }
      // Paths to join: streets, paths, entrances, bridges, and the top or foot of a flight of stairs.
      const sources: number[] = [];
      for (let i = 0; i < ctx.n; i++)
        if (ctx.elevation[i] === level && (joinable.has(ctx.role[i]) || (ctx.role[i] === Role.Stairs && ctx.terrain[i] !== T.stairs))) sources.push(i);
      const isSource = new Set(sources);
      const dist = distanceField(ctx.width, ctx.height, sources, (i) => passable(i) || isSource.has(i));
      if (dist[step] === Infinity) {
        fail("there's no path on its level to join. Paint a path to it, or add stairs up to its level.");
        continue;
      }
      const pave = (c: number) => {
        if (ctx.locks[c] || joinable.has(ctx.role[c]) || ctx.role[c] === Role.Stairs) return;
        ctx.set(c, street, role);
      };
      pave(step);
      ctx.keepClear.add(step);
      for (let c = step; dist[c] > 0; ) {
        const [x, y] = ctx.xy(c);
        let next = -1;
        for (const d of DIRS) {
          if (!ctx.inside(x + d.dx, y + d.dy)) continue;
          const j = ctx.idx(x + d.dx, y + d.dy);
          if (dist[j] < dist[c] && (next < 0 || dist[j] < dist[next])) next = j;
        }
        if (next < 0) break;
        c = next;
        if (dist[c] > 0) pave(c);
      }
    }
  });
}

/**
 * The core of a town: the cell nearest the middle of its entrances (or of the map) with
 * flat, dry, buildable land all round it. The square or crossing goes here, the Pokémon
 * Center and Mart beside it, and the houses fill outward from it.
 */
function townCore(ctx: GenContext, streetOk: (i: number) => boolean, land: (i: number) => boolean): number {
  const ends = ctx.openingEnds.map((c) => ctx.xy(c));
  const mx = ends.length >= 2 ? ends.reduce((s, p) => s + p[0], 0) / ends.length : (ctx.width - 1) / 2;
  const my = ends.length >= 2 ? ends.reduce((s, p) => s + p[1], 0) / ends.length : (ctx.height - 1) / 2;
  const room = ctx.params.borderThickness + 5;
  let best = ctx.idx(Math.round(mx), Math.round(my));
  let bestD = Infinity;
  for (let y = room; y < ctx.height - room; y++)
    for (let x = room; x < ctx.width - room; x++) {
      const d = Math.abs(x - mx) + Math.abs(y - my);
      if (d >= bestD) continue;
      const level = ctx.elevation[ctx.idx(x, y)];
      let ok = true;
      for (let dy = -3; dy <= 3 && ok; dy++)
        for (let dx = -4; dx <= 4 && ok; dx++) {
          const i = ctx.idx(x + dx, y + dy);
          ok = streetOk(i) && land(i) && ctx.elevation[i] === level;
        }
      if (ok) (bestD = d, (best = ctx.idx(x, y)));
    }
  return best;
}

/**
 * A wall round the built-up part of the town: a fence along a rectangle three cells
 * out from the buildings. It's only put on open ground, so every street, walk and
 * door step passes through a gap in it.
 */
function addTownWall(ctx: GenContext): void {
  if (ctx.buildings.length < 3) return;
  const edge = ctx.params.borderThickness + 1;
  const x0 = Math.max(edge, Math.min(...ctx.buildings.map((b) => b.x)) - 3);
  const y0 = Math.max(edge, Math.min(...ctx.buildings.map((b) => b.y)) - 3);
  const x1 = Math.min(ctx.width - 1 - edge, Math.max(...ctx.buildings.map((b) => b.x + b.w - 1)) + 3);
  const y1 = Math.min(ctx.height - 1 - edge, Math.max(...ctx.buildings.map((b) => b.y + b.h)) + 3);
  const post = (x: number, y: number) => {
    const i = ctx.idx(x, y);
    if (free(ctx, i) && !ctx.keepClear.has(i)) ctx.set(i, T.fence, Role.Building);
  };
  for (let x = x0; x <= x1; x++) (post(x, y0), post(x, y1));
  for (let y = y0 + 1; y < y1; y++) (post(x0, y), post(x1, y));
}

/** Where buildings may go, and how their doors are joined to the streets. */
interface Site {
  /** May a building stand on this cell? */
  build: (i: number) => boolean;
  /** May a door's walk be paved over this cell? */
  walk: (i: number) => boolean;
  /** The longest walk from a door to a street, in cells. */
  maxWalk: number;
  /** What the walk counts as. */
  role: Role;
  /** Keep a ring of clear yard round each building (towns). */
  yard: boolean;
  /** Keep the buildings together, near this cell (a settlement in other land). */
  focus: number | null;
}

/**
 * Fit a settlement into land that isn't a town: a hamlet beside a route, a village
 * in a forest, houses built into the rock of a cave. Buildings stand where there's
 * nothing the map needs (trees, rock, open ground), close together near the main
 * way, each with a walk from its door to a path. They never replace a path, water,
 * a cliff, a ledge or anything locked.
 */
export function addSettlement(ctx: GenContext): void {
  const tp = ctx.input.settlement;
  if (!tp || !buildingList(tp).length) return;
  const bt = ctx.params.borderThickness;
  const taken = new Set<number>(ctx.entities.map((e) => ctx.idx(e.x, e.y)));
  for (const w of ctx.input.warps) if (w.locked && ctx.inside(w.x, w.y)) taken.add(ctx.idx(w.x, w.y));
  // A forest's clearings are its junctions: a building there would block the way.
  const clearings = ctx.input.mapType !== "forest";
  const open = (i: number) => {
    const r = ctx.role[i];
    const t = ctx.terrain[i];
    return !ctx.locks[i] && (r === Role.None || (clearings && r === Role.Clearing)) && (IS_WALKABLE[t] || IS_WALL[t]) && ctx.edgeDist(i) >= bt && !ctx.keepClear.has(i) && !taken.has(i);
  };
  // The middle of the settlement: of a few spots along the main way, the one with the most room.
  let focus: number | null = null;
  let room = -1;
  for (let k = 0; k < 8 && ctx.mainLine.length; k++) {
    const c = ctx.mainLine[Math.floor(ctx.mainLine.length * ctx.rng.range(0.15, 0.85))];
    const [cx, cy] = ctx.xy(c);
    let n = 0;
    for (let y = cy - 8; y <= cy + 8; y++) for (let x = cx - 8; x <= cx + 8; x++) if (ctx.inside(x, y) && open(ctx.idx(x, y))) n++;
    if (n > room) (room = n, (focus = c));
  }
  placeBuildings(ctx, ctx.trail, tp, { build: open, walk: open, maxWalk: 8, role: Role.Branch, yard: false, focus });
}

function placeBuildings(ctx: GenContext, street: number, tp: TownParams, site: Site): void {
  const kinds = buildingList(tp);
  const [focusX, focusY] = site.focus === null ? [0, 0] : ctx.xy(site.focus);
  // How much of the building land is on each level, so a hill town spreads up its slopes
  // instead of filling the valley first.
  const landOn = new Map<number, number>();
  let land = 0;
  for (let i = 0; i < ctx.n; i++)
    if (site.build(i)) {
      landOn.set(ctx.elevation[i], (landOn.get(ctx.elevation[i]) ?? 0) + 1);
      land++;
    }
  const hilly = landOn.size > 1;
  const builtOn = new Map<number, number>();
  const crowding = (level: number) => (hilly ? (6 * (builtOn.get(level) ?? 0)) / (((landOn.get(level) ?? 0) / Math.max(1, land)) * kinds.length + 0.5) : 0);
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
              ? site.build(i) && ctx.elevation[i] === ctx.elevation[ctx.idx(x, y + h - 1)]
              : ctx.role[i] !== Role.MainPath && ctx.role[i] !== Role.Branch && ctx.role[i] !== Role.Building && ctx.role[i] !== Role.Opening;
          }
        if (!ok) continue;
        // The door is in the middle of the front (bottom) row. From the cell in front of it, a
        // short walk (it may turn) leads to a street.
        const doorX = x + Math.floor(w / 2);
        const walk = walkToStreet(ctx, ctx.idx(doorX, y + h), site, (i) => {
          const [ix, iy] = ctx.xy(i);
          return ix >= x - 1 && ix <= x + w && iy >= y - 1 && iy < y + h;
        });
        if (!walk) continue;
        const door = ctx.idx(doorX, y + h - 1);
        // The Center and Mart sit near the entrances on the main street; the Gym and landmark further in; houses anywhere.
        const near = fromEntrance[door];
        const level = ctx.elevation[door];
        const fromCore = site.focus === null ? 0 : Math.abs(doorX - focusX) + Math.abs(y + h - 1 - focusY);
        // A town grows outward from its core, close together: the Center and Mart right by
        // it, the Gym and the landmark a little way off, houses as near as there's room, and
        // a lot beside a building already there (in the same row) is better still.
        const town = site.yard && site.focus !== null;
        const beside = (xx: number) => ctx.inside(xx, y + h - 1) && ctx.role[ctx.idx(xx, y + h - 1)] === Role.Building;
        const row = town && (beside(x - 2) || beside(x + w + 1)) ? 2.5 : 0;
        const place = !town
          ? (kind === "center" || kind === "mart" ? -near * 0.5 : kind === "gym" || kind === "landmark" ? Math.min(near, 25) * 0.3 : 0) - fromCore * 0.8
          : kind === "center" || kind === "mart"
            ? -fromCore * 1.4
            : kind === "gym" || kind === "landmark"
              ? -Math.abs(fromCore - 10) * 0.6
              : -fromCore * 0.7;
        const score =
          ctx.rng.next() * (town ? 3 : 6) -
          crowding(level) +
          // The Gym and the landmark look down on the town from high ground.
          (hilly && (kind === "gym" || kind === "landmark") ? 3 * (RAISED.indexOf(level) + 1) : 0) +
          place +
          row -
          walk.length * 1.5 -
          fromStreet[door] * 0.2;
        lots.push({ x, y, walk, score });
      }
    if (!lots.length) continue;
    lots.sort((a, b) => b.score - a.score);
    const lot = lots[0];
    const lotLevel = ctx.elevation[ctx.idx(lot.x, lot.y + h - 1)];
    builtOn.set(lotLevel, (builtOn.get(lotLevel) ?? 0) + 1);
    for (let yy = lot.y; yy < lot.y + h; yy++) for (let xx = lot.x; xx < lot.x + w; xx++) ctx.set(ctx.idx(xx, yy), T.building, Role.Building);
    // A one-cell ring of yard around it stays clear (no trees or fences against the walls).
    if (site.yard)
      for (let yy = lot.y - 1; yy <= lot.y + h; yy++)
        for (let xx = lot.x - 1; xx <= lot.x + w; xx++) if (ctx.inside(xx, yy) && ctx.role[ctx.idx(xx, yy)] === Role.None) ctx.role[ctx.idx(xx, yy)] = Role.Clearing;
    for (const c of lot.walk) {
      ctx.set(c, street, site.role);
      // Outside a town nothing else may stand on the walk (a trainer there would block the door).
      if (!site.yard) ctx.keepClear.add(c);
    }
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
 * The shortest walk (at most the site's longest) over free ground from a door's front step to
 * a street, not through the lot itself. Returns the cells to pave (empty if the
 * step is already on a street), or null if there's no street that close.
 */
function walkToStreet(ctx: GenContext, step: number, site: Site, inLot: (i: number) => boolean): number[] | null {
  if (isStreet(ctx, step)) return [];
  if (!site.walk(step)) return null;
  const level = ctx.elevation[step];
  const prev = new Map<number, number>([[step, -1]]);
  let frontier = [step];
  for (let depth = 0; depth < site.maxWalk && frontier.length; depth++) {
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
        if (!site.walk(j)) continue;
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
export type TownBuilding = { kind: BuildingKind; x: number; y: number; w: number; h: number; door: number; /** Painted by the user, not placed by Generate. */ painted?: boolean };
