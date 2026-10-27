// Stage 5: cleanup, so the map is tidy and drawable with a real tileset.
//
//   • fill 1-cell notches in tree edges, and open up 1-cell tree spikes;
//   • fix diagonal "checkerboard" tree patterns no tileset can draw;
//   • remove grass patches smaller than 6 cells and single water cells;
//   • widen paths pinched to one cell between two walls (rock or trees);
//   • fill open ground that can't be reached at all (even with every HM).
// Paths, entrances, ledges, bridges, pockets and locked cells are never touched.

import { DIRS, IS_GRASS, IS_WALKABLE, IS_WALL, IS_WATER, T, components } from "../grid";
import { MOVEMENT_HMS, MoveGraph } from "../reach";
import { openingCells } from "../reach";
import type { GenContext } from "./context";
import { Role } from "./context";

export const MIN_GRASS_PATCH = 6;

function wallNeighbours(ctx: GenContext, i: number): number {
  const [x, y] = ctx.xy(i);
  let n = 0;
  for (const { dx, dy } of DIRS) {
    const xx = x + dx;
    const yy = y + dy;
    // The map edge counts as wall.
    if (!ctx.inside(xx, yy) || IS_WALL[ctx.terrain[ctx.idx(xx, yy)]]) n++;
  }
  return n;
}

export function cleanup(ctx: GenContext): void {
  const { width, height, n } = ctx;

  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (let i = 0; i < n; i++) {
      if (ctx.isProtected(i)) continue;
      const t = ctx.terrain[i];
      const walls = wallNeighbours(ctx, i);
      // Notch: open cell boxed in on three sides.
      if (IS_WALKABLE[t] && walls >= 3) changed = ctx.set(i, T.tree) || changed;
      // Spike: a lone tree poking out into open ground.
      else if (t === T.tree && walls <= 1) changed = ctx.set(i, T.ground) || changed;
    }
    // Diagonal checkerboards in every 2×2 window.
    for (let y = 0; y + 1 < height; y++)
      for (let x = 0; x + 1 < width; x++) {
        const a = ctx.idx(x, y);
        const b = ctx.idx(x + 1, y);
        const c = ctx.idx(x, y + 1);
        const d = ctx.idx(x + 1, y + 1);
        const wa = IS_WALL[ctx.terrain[a]];
        const wb = IS_WALL[ctx.terrain[b]];
        const wc = IS_WALL[ctx.terrain[c]];
        const wd = IS_WALL[ctx.terrain[d]];
        if (wa === wd && wb === wc && wa !== wb) {
          // Turn one open cell of the pair into tree, or else open one wall cell.
          const openPair = wa ? [b, c] : [a, d];
          const wallPair = wa ? [a, d] : [b, c];
          const fix = openPair.find((k) => !ctx.isProtected(k) && IS_WALKABLE[ctx.terrain[k]]);
          if (fix !== undefined) changed = ctx.set(fix, T.tree) || changed;
          else {
            const w = wallPair.find((k) => !ctx.isProtected(k) && ctx.terrain[k] === T.tree);
            if (w !== undefined) changed = ctx.set(w, T.ground) || changed;
          }
        }
      }
    if (!changed) break;
  }

  widenPinches(ctx);

  // Open ground nobody can ever reach becomes trees.
  const starts = ctx.input.openings.flatMap((o) => openingCells(o, width, height));
  if (starts.length) {
    const reach = new MoveGraph({ width, height, terrain: ctx.terrain, entities: ctx.entities, elevation: ctx.elevation }, new Set(MOVEMENT_HMS)).forward(starts);
    for (let i = 0; i < n; i++) {
      if (!reach[i] && IS_WALKABLE[ctx.terrain[i]] && !ctx.isProtected(i)) ctx.set(i, T.tree);
    }
  }

  // Small grass patches become plain ground; single water cells too.
  const grass = components(width, height, (i) => IS_GRASS[ctx.terrain[i]]);
  for (let i = 0; i < n; i++) {
    const id = grass.ids[i];
    if (id < 0 || grass.sizes[id] >= MIN_GRASS_PATCH) continue;
    const r = ctx.role[i];
    if (r === Role.MainPath) ctx.set(i, T.path);
    else if (r === Role.GrassRoute || !ctx.isProtected(i)) ctx.set(i, T.ground);
  }
  const water = components(width, height, (i) => IS_WATER[ctx.terrain[i]]);
  for (let i = 0; i < n; i++) {
    const id = water.ids[i];
    if (id >= 0 && water.sizes[id] === 1 && !ctx.isProtected(i)) ctx.set(i, T.ground);
  }
  // Single cells of sand, mud or flowers become plain ground.
  for (let i = 0; i < n; i++) {
    const t = ctx.terrain[i];
    if ((t !== T.sand && t !== T.mud && t !== T.flowers) || (ctx.isProtected(i) && ctx.role[i] !== Role.Beach)) continue;
    const [x, y] = ctx.xy(i);
    const alone = DIRS.every(({ dx, dy }) => !ctx.inside(x + dx, y + dy) || ctx.terrain[ctx.idx(x + dx, y + dy)] !== t);
    if (alone) ctx.set(i, T.ground);
  }
  // A lone cell of one grass type inside the other takes its neighbours' type.
  for (let i = 0; i < n; i++) {
    const t = ctx.terrain[i];
    if ((t !== T.tallGrass && t !== T.longGrass) || ctx.isProtected(i)) continue;
    const other = t === T.tallGrass ? T.longGrass : T.tallGrass;
    const [x, y] = ctx.xy(i);
    const near = DIRS.filter(({ dx, dy }) => ctx.inside(x + dx, y + dy)).map(({ dx, dy }) => ctx.terrain[ctx.idx(x + dx, y + dy)]);
    if (!near.includes(t) && near.includes(other)) ctx.set(i, other);
  }
}

/** A path cell walled in on both sides: open one side (same level, not a cliff), unless it's next to stairs. */
function widenPinches(ctx: GenContext) {
  const blocked = (x: number, y: number) => !ctx.inside(x, y) || !IS_WALKABLE[ctx.terrain[ctx.idx(x, y)]];
  for (let i = 0; i < ctx.n; i++) {
    if (ctx.terrain[i] !== T.path) continue;
    const [x, y] = ctx.xy(i);
    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      if (!blocked(x - dx, y - dy) || !blocked(x + dx, y + dy)) continue;
      for (const side of [1, -1]) {
        const xx = x + side * dx;
        const yy = y + side * dy;
        if (!ctx.inside(xx, yy)) continue;
        const j = ctx.idx(xx, yy);
        if (ctx.isProtected(j) || !IS_WALL[ctx.terrain[j]] || ctx.elevation[j] !== ctx.elevation[i] || ctx.edgeDist(j) < ctx.params.borderThickness) continue;
        ctx.set(j, T.ground);
        break;
      }
    }
  }
}

/**
 * Close any ledge that drops into a trap: somewhere the player could jump into but
 * never walk out of (the land below got boxed in by later steps). A cliff ledge
 * becomes plain cliff; a ledge in a row on flat ground becomes a tree.
 */
export function closeLedgeTraps(ctx: GenContext): void {
  const starts = ctx.input.openings.filter((o) => o.kind === "walk").flatMap((o) => openingCells(o, ctx.width, ctx.height));
  if (!starts.length) return;
  for (let pass = 0; pass < 6; pass++) {
    const graph = new MoveGraph({ width: ctx.width, height: ctx.height, terrain: ctx.terrain, entities: ctx.entities, elevation: ctx.elevation }, new Set());
    const forward = graph.forward(starts);
    const back = graph.backward(starts);
    let changed = false;
    for (let i = 0; i < ctx.n; i++) {
      const jump = LEDGE_DIR.get(ctx.terrain[i]);
      if (!jump) continue;
      const [x, y] = ctx.xy(i);
      if (!ctx.inside(x + jump.dx, y + jump.dy)) continue;
      const land = ctx.idx(x + jump.dx, y + jump.dy);
      if (forward[land] && !back[land] && !ctx.locks[i]) {
        ctx.set(i, ctx.role[i] === Role.Cliff ? T.rockWall : T.tree);
        changed = true;
      }
    }
    if (!changed) break;
  }
}

const LEDGE_DIR = new Map<number, { dx: number; dy: number }>([
  [T.ledgeS, { dx: 0, dy: 1 }],
  [T.ledgeE, { dx: 1, dy: 0 }],
  [T.ledgeW, { dx: -1, dy: 0 }],
]);
