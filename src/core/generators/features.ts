// Stage 4: features.
//
//   • Ledge shortcuts: a second corridor between two points of the main path,
//     with a ledge across it, so it's a one-way loop. Players can always walk
//     back along the main path, so a ledge never traps anyone.
//   • HM pockets: a small room off the path through the trees, sealed by a Cut
//     tree, a Rock Smash rock, or a strip of deep water (Surf). Each gets an item
//     (added in the placement stage) and an "HM-gated area" zone.

import { DIRS, IS_WALKABLE, IS_WALL, T, cheapestPath } from "../grid";
import { makeGrid } from "../model";
import type { Entity } from "../model";
import type { GenContext } from "./context";
import { Role } from "./context";
import type { PocketHm } from "./params";

export function addLedges(ctx: GenContext): void {
  const line = ctx.mainLine;
  if (line.length < 16) return;
  for (let l = 0; l < ctx.params.ledges; l++) {
    for (let attempt = 0; attempt < 20; attempt++) {
      if (tryLedge(ctx, line)) break;
    }
  }
}

function tryLedge(ctx: GenContext, line: number[]): boolean {
  const rng = ctx.rng;
  const i = rng.int(Math.floor(line.length * 0.1), Math.floor(line.length * 0.6));
  const j = Math.min(line.length - 1, i + rng.int(10, 24));
  let a = line[i];
  let b = line[j];
  let [ax, ay] = ctx.xy(a);
  let [bx, by] = ctx.xy(b);
  // Ledges jump south, east or west (never north). Work out which way this loop runs.
  let dir: "s" | "e" | "w";
  if (ctx.vertical) {
    if (Math.abs(by - ay) < 5) return false;
    if (by < ay) {
      [a, b] = [b, a];
      [ax, ay, bx, by] = [bx, by, ax, ay];
    }
    dir = "s";
  } else {
    if (Math.abs(bx - ax) < 5) return false;
    dir = bx > ax ? "e" : "w";
  }
  const forbidden = (c: number) => {
    if (ctx.locks[c] || ctx.edgeDist(c) < ctx.params.borderThickness + 1) return true;
    const r = ctx.role[c];
    return r === Role.Pocket || r === Role.Opening || r === Role.Bridge || r === Role.Water || r === Role.Corridor || ctx.terrain[c] === T.waterDeep;
  };
  const corridor = cheapestPath(ctx.width, ctx.height, a, b, (c) => {
    // The corridor is carved 2 wide, so check the whole 2×2 footprint.
    const [x, y] = ctx.xy(c);
    if (x + 1 >= ctx.width || y + 1 >= ctx.height) return Infinity;
    const foot = [c, c + 1, c + ctx.width, c + ctx.width + 1];
    const onPath = foot.some((f) => ctx.role[f] === Role.MainPath || ctx.role[f] === Role.Branch);
    if (foot.some((f) => forbidden(f) && !(ctx.role[f] === Role.MainPath || ctx.role[f] === Role.Branch))) return Infinity;
    if (onPath) return 40;
    return IS_WALKABLE[ctx.terrain[c]] ? 3 : 1;
  });
  if (!corridor || corridor.length < 8) return false;
  // It must be a genuinely separate route, mostly through trees.
  const fresh = corridor.filter((c) => ctx.role[c] !== Role.MainPath && ctx.role[c] !== Role.Branch).length;
  if (fresh < corridor.length * 0.6) return false;

  // Find a stretch in the middle where the corridor runs in the ledge direction.
  const step = DIRS.find((d) => d.dir === dir)!;
  let ledgeAt = -1;
  for (let k = Math.floor(corridor.length / 3); k < Math.floor((corridor.length * 2) / 3); k++) {
    const [x0, y0] = ctx.xy(corridor[k - 1]);
    const [x1, y1] = ctx.xy(corridor[k]);
    const [x2, y2] = ctx.xy(corridor[k + 1]);
    if (x1 - x0 === step.dx && y1 - y0 === step.dy && x2 - x1 === step.dx && y2 - y1 === step.dy) {
      ledgeAt = k;
      break;
    }
  }
  if (ledgeAt < 0) return false;

  // Carve the corridor (2 wide), then lay the ledge across it.
  for (const c of corridor)
    ctx.stamp(c, 2, T.path, Role.Corridor, (j) => {
      const r = ctx.role[j];
      return r !== Role.MainPath && r !== Role.Branch && r !== Role.Opening && r !== Role.Pocket && r !== Role.Bridge && r !== Role.Water && ctx.edgeDist(j) >= ctx.params.borderThickness;
    });
  const [lx, ly] = ctx.xy(corridor[ledgeAt]);
  const across = ctx.vertical ? [1, 0] : [0, 1];
  const row: number[] = [];
  for (const sign of [-1, 1]) {
    for (let k = sign === -1 ? 0 : 1; ; k++) {
      const x = lx + sign * k * across[0];
      const y = ly + sign * k * across[1];
      if (!ctx.inside(x, y)) break;
      const c = ctx.idx(x, y);
      if (ctx.role[c] !== Role.Corridor) break;
      row.push(c);
    }
  }
  if (row.some((c) => ctx.locks[c])) return false;
  const ledge = dir === "s" ? T.ledgeS : dir === "e" ? T.ledgeE : T.ledgeW;
  for (const c of row) ctx.set(c, ledge, Role.Corridor);
  // Close the ends of the ledge with trees so it can't be walked around.
  for (const end of [row[row.length - 1], row[0]]) {
    const [ex, ey] = ctx.xy(end);
    for (const sign of [-1, 1]) {
      const x = ex + sign * across[0];
      const y = ey + sign * across[1];
      if (!ctx.inside(x, y)) continue;
      const c = ctx.idx(x, y);
      if (ctx.role[c] === Role.None || ctx.role[c] === Role.Clearing) ctx.set(c, T.tree, Role.Corridor);
    }
  }
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
  if (!types.length) return;
  let gateCount = { cut_tree: 0, smash_rock: 0 } as Record<string, number>;
  // Start at a random HM in the list so single pockets aren't always the first type.
  const offset = ctx.rng.int(0, types.length - 1);
  for (let k = 0; k < ctx.params.hmPockets; k++) {
    const hm = types[(k + offset) % types.length];
    // Every walkable cell with trees next to it is a possible doorway; try them in random order.
    const doorways: Array<[number, (typeof DIRS)[number]]> = [];
    for (let a = 0; a < ctx.n; a++) {
      // Pockets open off the main path or a branch (or a cell right beside it), like Cut trees in Emerald.
      const r = ctx.role[a];
      if (ctx.locks[a] || !ctx.isWalkable(a) || ctx.terrain[a] === T.waterDeep) continue;
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
