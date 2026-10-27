// Stage 4: features.
//
//   • Ledge rows: a long ledge across the route with a gap at one end. The path
//     winds round through the gap; going the other way, the player jumps down as
//     a shortcut. The gap means a ledge never traps anyone.
//   • HM pockets: a small room off the path through the trees, sealed by a Cut
//     tree, a Rock Smash rock, or a strip of deep water (Surf). Each gets an item
//     (added in the placement stage) and an "HM-gated area" zone.

import { DIRS, IS_WALKABLE, IS_WALL, IS_WATER, T, cheapestPath } from "../grid";
import { makeGrid } from "../model";
import { MoveGraph, openingCells } from "../reach";
import type { Entity } from "../model";
import type { GenContext } from "./context";
import { LEVEL, Role } from "./context";
import { effectiveElevation } from "./params";
import type { PocketHm } from "./params";

/**
 * Ledge rows, like Hoenn's Routes 101–104: a long ledge across the route with a
 * gap at one end. Walking "up" the route, the path winds along the ledge to the
 * gap and back; coming the other way, the player just jumps down, a shortcut.
 *
 * The ledge sits on flat ground (elevation 3 on both sides in Porymap): it's a
 * one-way step, not a change of level. In pokeemerald a jump comes from the
 * ledge's metatile behaviour (MB_JUMP_SOUTH/EAST/WEST, read by
 * GetLedgeJumpDirection in src/field_player_avatar.c), not from elevation.
 * On vertical routes the ledges face south; on horizontal routes they face east
 * or west.
 *
 * How many: the Ledges setting, plus more on hillier routes (the Elevation
 * setting), as many as fit along the route.
 */
export function addLedgeRows(ctx: GenContext): void {
  if (ctx.layout === "water") return;
  const amount = effectiveElevation(ctx.params, ctx.input.biome);
  const wanted = ctx.params.ledges + Math.round(amount * 2);
  const alongLength = ctx.vertical ? ctx.height : ctx.width;
  // Keep clear of the entrances at the ends, and space the rows out.
  const lines: number[] = [];
  for (let a = 9; a < alongLength - 9; a++) lines.push(a);
  const used: number[] = [];
  for (const a of ctx.rng.shuffle(lines)) {
    if (used.length >= wanted) break;
    if (used.some((u) => Math.abs(u - a) < 7)) continue;
    if (tryLedgeRow(ctx, a)) used.push(a);
  }
}

/** Roles a ledge row may not cross: they must fall in the gap instead. */
const KEEP_OPEN = new Set<number>([Role.Opening, Role.Stairs, Role.Bridge, Role.Pocket, Role.Branch, Role.Corridor]);
/** Roles a detour may not pass through. */
const NO_DETOUR = new Set<number>([Role.Pocket, Role.Sea, Role.Cliff, Role.Stairs, Role.Corridor, Role.Opening, Role.Border]);

function tryLedgeRow(ctx: GenContext, along: number): boolean {
  const crossLength = ctx.vertical ? ctx.width : ctx.height;
  const bt = ctx.params.borderThickness;
  const dir: "s" | "e" | "w" = ctx.vertical ? "s" : ctx.rng.chance(0.5) ? "e" : "w";
  const jump = DIRS.find((d) => d.dir === dir)!;
  const at = (c: number) => (ctx.vertical ? ctx.idx(c, along) : ctx.idx(along, c));
  // Sort the cells across the route: blocked (trees, rock, water, raised ground) stay
  // as they are; open ground becomes ledge; a few kinds of cell must stay open.
  const cells: number[] = [];
  const kind: Array<"blocked" | "ledge" | "open"> = [];
  for (let c = bt; c < crossLength - bt; c++) {
    const i = at(c);
    cells.push(i);
    if (ctx.locks[i]) return false;
    const t = ctx.terrain[i];
    if (KEEP_OPEN.has(ctx.role[i])) kind.push("open");
    else if (ctx.elevation[i] !== LEVEL.ground || IS_WALL[t] || IS_WATER[t] || !IS_WALKABLE[t]) kind.push("blocked");
    else kind.push("ledge");
  }
  // Both sides of the ledge must be flat ground the player can use.
  const side = (i: number, s: number) => {
    const [x, y] = ctx.xy(i);
    const xx = x + s * jump.dx;
    const yy = y + s * jump.dy;
    return ctx.inside(xx, yy) ? ctx.idx(xx, yy) : -1;
  };
  const crossings = cells.map((i, k) => (ctx.role[i] === Role.MainPath ? k : -1)).filter((k) => k >= 0);
  if (!crossings.length) return false;
  const p = Math.round(crossings.reduce((s, k) => s + k, 0) / crossings.length);

  // The gap: as wide as the narrowest path, covering every cell that must stay open,
  // and as far as possible from where the main path crosses (that's the detour).
  const mustOpen = kind.map((k, j) => (k === "open" ? j : -1)).filter((j) => j >= 0);
  // Wider where it has to take in something else that crosses here (often the grass shortcut).
  const spread = mustOpen.length ? mustOpen[mustOpen.length - 1] - mustOpen[0] + 1 : 0;
  if (spread > 6) return false;
  const g = Math.max(2, ctx.params.pathWidthMin, spread);
  const canGap = (j: number) => {
    const i = cells[j];
    return kind[j] === "open" || (ctx.elevation[i] === LEVEL.ground && !IS_WATER[ctx.terrain[i]] && (kind[j] === "ledge" || ctx.terrain[i] === T.tree));
  };
  // How far round the path winds varies from row to row.
  const target = ctx.rng.range(6, 11);
  const gapDist = (s: number) => Math.abs(s + (g - 1) / 2 - p);
  let best = -1;
  for (let s = 0; s + g <= cells.length; s++) {
    if (mustOpen.some((j) => j < s || j >= s + g)) continue;
    let ok = true;
    for (let j = s; j < s + g && ok; j++) ok = canGap(j);
    if (!ok || gapDist(s) < 5) continue;
    if (best < 0 || Math.abs(gapDist(s) - target) < Math.abs(gapDist(best) - target)) best = s;
  }
  if (best < 0) return false;
  const inGap = (j: number) => j >= best && j < best + g;
  const lineSet = new Set(cells);
  const gapSet = new Set(cells.filter((_, j) => inGap(j)));

  // The detour: from the foot of the ledge where the path meets it, round through the
  // gap, back to the path above. Plan it before changing anything.
  const below = side(cells[p], 1);
  const above = side(cells[p], -1);
  if (below < 0 || above < 0) return false;
  const usable = (i: number) => ctx.elevation[i] === LEVEL.ground && !ctx.locks[i] && ctx.edgeDist(i) >= bt && !NO_DETOUR.has(ctx.role[i]) && !IS_WATER[ctx.terrain[i]];
  if (!usable(below) || !usable(above) || !IS_WALKABLE[ctx.terrain[below]] || !IS_WALKABLE[ctx.terrain[above]]) return false;
  const route = cheapestPath(ctx.width, ctx.height, below, above, (i) => {
    if (gapSet.has(i)) return 1;
    if (lineSet.has(i) || !usable(i)) return Infinity;
    return IS_WALKABLE[ctx.terrain[i]] ? 1 : ctx.terrain[i] === T.tree ? 4 : Infinity;
  });
  // A real shortcut: the way round is clearly longer than the jump.
  if (!route || route.length < 10) return false;

  // Lay the ledge, keep the gap open, and pave the way round.
  const ledge = dir === "s" ? T.ledgeS : dir === "e" ? T.ledgeE : T.ledgeW;
  cells.forEach((i, j) => {
    if (inGap(j)) {
      if (kind[j] !== "open") ctx.set(i, T.path, Role.MainPath);
    } else if (kind[j] === "ledge") ctx.set(i, ledge, Role.Corridor);
    // Trees and rocks in the line stay put (cleanup mustn't open a way through).
    else if (ctx.role[i] === Role.None || ctx.role[i] === Role.Clearing) ctx.role[i] = Role.Corridor;
  });
  for (const c of route)
    ctx.stamp(c, ctx.params.pathWidthMin, T.path, Role.MainPath, (j) => !lineSet.has(j) && usable(j) && (ctx.role[j] === Role.None || ctx.role[j] === Role.Clearing || ctx.role[j] === Role.MainPath));
  // Where the path now runs along both sides of a tree in the line, the ledge carries on
  // through it, so the ledge reads as one long step rather than a wall of trees.
  const open = (i: number) => i >= 0 && IS_WALKABLE[ctx.terrain[i]] && ctx.elevation[i] === LEVEL.ground;
  cells.forEach((i, j) => {
    if (!inGap(j) && ctx.terrain[i] === T.tree && ctx.role[i] === Role.Corridor && open(side(i, 1)) && open(side(i, -1))) ctx.set(i, ledge, Role.Corridor);
  });
  return true;
}

const POCKET_GATES: Record<PocketHm, { neck: number; kind?: Entity["kind"]; graphics?: string; script?: string }> = {
  cut: { neck: 1, kind: "cut_tree", graphics: "OBJ_EVENT_GFX_CUTTABLE_TREE", script: "EventScript_CutTree" },
  rock_smash: { neck: 1, kind: "smash_rock", graphics: "OBJ_EVENT_GFX_BREAKABLE_ROCK", script: "EventScript_RockSmash" },
  surf: { neck: 2 },
};

const HM_LABEL: Record<PocketHm, string> = { cut: "Cut", rock_smash: "Rock Smash", surf: "Surf" };

export function addHmPockets(ctx: GenContext): void {
  const types = ctx.params.hmPocketTypes;
  if (!types.length || ctx.layout === "water") return;
  let gateCount = { cut_tree: 0, smash_rock: 0 } as Record<string, number>;
  // Doorways must be somewhere the player can actually walk to.
  const starts = ctx.input.openings.filter((o) => o.kind === "walk").flatMap((o) => openingCells(o, ctx.width, ctx.height));
  const reach = new MoveGraph({ width: ctx.width, height: ctx.height, terrain: ctx.terrain, entities: ctx.entities, elevation: ctx.elevation }, new Set()).forward(starts);
  // Start at a random HM in the list so single pockets aren't always the first type.
  const offset = ctx.rng.int(0, types.length - 1);
  for (let k = 0; k < ctx.params.hmPockets; k++) {
    const hm = types[(k + offset) % types.length];
    // Every walkable cell with trees next to it is a possible doorway; try them in random order.
    const doorways: Array<[number, (typeof DIRS)[number]]> = [];
    for (let a = 0; a < ctx.n; a++) {
      // Pockets open off the main path or a branch (or a cell right beside it), like Cut trees in Emerald.
      const r = ctx.role[a];
      if (ctx.locks[a] || !ctx.isWalkable(a) || ctx.terrain[a] === T.waterDeep || !reach[a]) continue;
      const [ax, ay] = ctx.xy(a);
      const onPath = r === Role.MainPath || r === Role.Branch;
      const besidePath =
        (r === Role.None || r === Role.Clearing) &&
        DIRS.some(({ dx, dy }) => ctx.inside(ax + dx, ay + dy) && (ctx.role[ctx.idx(ax + dx, ay + dy)] === Role.MainPath || ctx.role[ctx.idx(ax + dx, ay + dy)] === Role.Branch));
      if (!onPath && !besidePath) continue;
      for (const d of DIRS) {
        const x = ax + d.dx;
        const y = ay + d.dy;
        if (ctx.inside(x, y) && ctx.isWall(ctx.idx(x, y)) && ctx.role[ctx.idx(x, y)] === Role.None) doorways.push([a, d]);
      }
    }
    // Try the chosen HM first; if no spot fits it, fall back to the other allowed types.
    const order = [hm, ...types.filter((t) => t !== hm)];
    const tries = ctx.rng.shuffle(doorways).slice(0, 300);
    let placed = false;
    for (const type of order) {
      for (const [a, d] of tries) {
        const res = tryPocket(ctx, type, k + 1, gateCount, a, d);
        if (res) {
          gateCount = res;
          placed = true;
          break;
        }
      }
      if (placed) break;
    }
  }
}

function tryPocket(
  ctx: GenContext,
  hm: PocketHm,
  number: number,
  gateCount: Record<string, number>,
  a: number,
  d: (typeof DIRS)[number],
): Record<string, number> | null {
  const gate = POCKET_GATES[hm];
  const [ax, ay] = ctx.xy(a);
  const neck: number[] = [];
  for (let s = 1; s <= gate.neck; s++) neck.push(ctx.idx(ax + d.dx * s, ay + d.dy * s));
  const cx = ax + d.dx * (gate.neck + 2);
  const cy = ay + d.dy * (gate.neck + 2);
  const room: number[] = [];
  const ring: number[] = [];
  for (let dy = -2; dy <= 2; dy++)
    for (let dx = -2; dx <= 2; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (!ctx.inside(x, y)) return null;
      (Math.abs(dx) <= 1 && Math.abs(dy) <= 1 ? room : ring).push(ctx.idx(x, y));
    }
  // Cells beside the neck must be wall too, or the pocket isn't sealed.
  for (const c of neck) {
    const [x, y] = ctx.xy(c);
    for (const s of [-1, 1]) {
      const x2 = x + (d.dy !== 0 ? s : 0);
      const y2 = y + (d.dx !== 0 ? s : 0);
      if (!ctx.inside(x2, y2)) return null;
      ring.push(ctx.idx(x2, y2));
    }
  }
  const bt = ctx.params.borderThickness;
  for (const c of [...neck, ...room]) {
    if (ctx.locks[c] || ctx.role[c] !== Role.None || !IS_WALL[ctx.terrain[c]] || ctx.edgeDist(c) < bt) return null;
    // The whole pocket sits on the doorway's level.
    if (ctx.elevation[c] !== ctx.elevation[a]) return null;
  }
  for (const c of ring) {
    if (neck.includes(c)) continue;
    if (ctx.locks[c] || !IS_WALL[ctx.terrain[c]]) return null;
    if (ctx.role[c] !== Role.None && ctx.role[c] !== Role.Border) return null;
  }

  // Carve it.
  const zoneId = `pocket_${number}`;
  const mask = makeGrid(ctx.width, ctx.height);
  for (const c of room) ctx.set(c, T.ground, Role.Pocket);
  for (const c of neck) ctx.set(c, hm === "surf" ? T.waterDeep : T.ground, Role.Pocket);
  for (const c of ring) if (ctx.role[c] === Role.None) ctx.role[c] = Role.Pocket;
  // Keep the doorway clear: no trees from cleanup, no trainer standing in it.
  if (ctx.role[a] === Role.None || ctx.role[a] === Role.Clearing) ctx.set(a, T.ground, Role.Pocket);
  for (const c of [...room, ...neck]) mask.data[c] = 1;
  ctx.zones.push({ id: zoneId, name: `HM-gated area: ${HM_LABEL[hm]}`, kind: "hm_gate", hard: true, fuzziness: 0, mask, data: { hm, generated: true } });
  ctx.pockets.push({ center: ctx.idx(cx, cy), hm, zoneId });

  const next = { ...gateCount };
  if (gate.kind) {
    next[gate.kind] = (next[gate.kind] ?? 0) + 1;
    const [gx, gy] = ctx.xy(neck[0]);
    const prefix = gate.kind === "cut_tree" ? "C" : "R";
    ctx.entities.push({
      id: `${prefix}${next[gate.kind]}`,
      kind: gate.kind,
      x: gx,
      y: gy,
      elevation: "ground",
      fields: {
        graphics_id: gate.graphics!,
        movement_type: "MOVEMENT_TYPE_LOOK_AROUND",
        script: gate.script!,
        flag: "0",
      },
    });
  }
  return next;
}
