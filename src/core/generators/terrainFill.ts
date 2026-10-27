// Stage 3: terrain fill (shared by all generators that have a path network).
//
//   • open ground grows out from the paths, with noisy natural edges;
//   • the border wall goes around the map (gaps at the entrances);
//   • a clearing, ponds and a stream (with bridges where it meets a path);
//   • grass patches, mostly near the path;
//   • biome touches: long grass in rainforest, mud and shallows in wetland,
//     sand on the coast, flowers in meadows, rock outcrops in alpine areas.

import { T, cheapestPath, distanceField } from "../grid";
import type { GenContext } from "./context";
import { Role } from "./context";

/** Open ground grows out from these (paths, and beaches on islands and coasts). */
const PATH_ROLES = new Set<number>([Role.MainPath, Role.Branch, Role.Opening, Role.Corridor, Role.Bridge, Role.Beach]);

function isPathRole(ctx: GenContext, i: number) {
  return PATH_ROLES.has(ctx.role[i]);
}

export function fillTerrain(ctx: GenContext): void {
  const p = ctx.params;
  const rng = ctx.rng;
  const { width, height, n } = ctx;

  // --- Open ground around the paths -----------------------------------------
  const pathCells: number[] = [];
  for (let i = 0; i < n; i++) if (isPathRole(ctx, i)) pathCells.push(i);
  const dist = distanceField(width, height, pathCells);
  const open = new Uint8Array(n);
  const spread = (1 - p.treeDensity) * 6;
  for (let i = 0; i < n; i++) {
    if (ctx.isProtected(i) || ctx.edgeDist(i) < p.borderThickness) continue;
    const [x, y] = ctx.xy(i);
    const reach = 0.6 + spread * ctx.noise.fractal(x + 101, y + 57, 6, 3);
    if (dist[i] <= reach) open[i] = 1;
  }

  // A clearing: a round open area beside the path.
  if (p.clearing && ctx.mainLine.length > 8) {
    const c = ctx.mainLine[Math.floor(ctx.mainLine.length * rng.range(0.3, 0.7))];
    const [cx, cy] = ctx.xy(c);
    const r = rng.range(2.5, 4);
    const side = rng.chance(0.5) ? 1 : -1;
    const ox = ctx.vertical ? cx + side * Math.round(r + 1) : cx;
    const oy = ctx.vertical ? cy : cy + side * Math.round(r + 1);
    for (let i = 0; i < n; i++) {
      const [x, y] = ctx.xy(i);
      const d = Math.hypot(x - ox, y - oy) + (ctx.noise.at(x * 0.7, y * 0.7) - 0.5);
      if (d <= r && ctx.edgeDist(i) >= p.borderThickness + 1 && !ctx.isProtected(i) && ctx.elevation[i] === ctx.elevation[c]) {
        open[i] = 1;
        ctx.role[i] = Role.Clearing;
      }
    }
  }

  // Clearings (the landmark, plateau tops) are always open.
  for (let i = 0; i < n; i++) if (ctx.role[i] === Role.Clearing) open[i] = 1;

  // Smooth the edges: a cell becomes open if most of its neighbours are (cellular automaton).
  for (let pass = 0; pass < 2; pass++) {
    const next = open.slice();
    for (let i = 0; i < n; i++) {
      if (ctx.isProtected(i) || ctx.edgeDist(i) < p.borderThickness) continue;
      const [x, y] = ctx.xy(i);
      let count = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (!ctx.inside(xx, yy)) continue;
          const j = ctx.idx(xx, yy);
          if (open[j] || isPathRole(ctx, j)) count++;
        }
      next[i] = count >= 5 || ctx.role[i] === Role.Clearing ? 1 : 0;
    }
    open.set(next);
  }

  // --- Apply: walls, border, open ground -------------------------------------
  const wall = p.borderStyle === "cliff" ? T.rockWall : T.denseForest;
  for (let i = 0; i < n; i++) {
    // Paths, entrances, the sea, beaches, cliffs, stairs and the grass shortcut keep what they are.
    if (ctx.isProtected(i)) continue;
    const [x, y] = ctx.xy(i);
    const jitter = ctx.noise.at(x * 0.5 + 300, y * 0.5) > 0.6 ? 1 : 0;
    if (ctx.edgeDist(i) < p.borderThickness + jitter) {
      if (!open[i] || ctx.edgeDist(i) < p.borderThickness) ctx.set(i, wall, Role.Border);
      continue;
    }
    if (open[i]) ctx.set(i, T.ground);
    else {
      // Alpine maps get rock outcrops inside the tree cover.
      const rocky = ctx.input.biome === "alpine" && ctx.noise.fractal(x + 900, y + 900, 5, 2) > 0.58;
      ctx.set(i, rocky ? T.rockWall : T.tree);
    }
  }

  addWater(ctx, dist);
  addGrass(ctx, dist);
  addBiomeDetail(ctx);
}

function addWater(ctx: GenContext, dist: Float64Array) {
  const p = ctx.params;
  const rng = ctx.rng;
  const { width, height, n } = ctx;

  // Ponds: deep water blobs a little way off the path, with a walkable shore.
  const ponds = Math.round(p.water * 2.5);
  for (let k = 0; k < ponds; k++) {
    const candidates: number[] = [];
    for (let i = 0; i < n; i++)
      if (dist[i] >= 3 && dist[i] <= 8 && ctx.edgeDist(i) >= p.borderThickness + 3 && !ctx.isProtected(i) && ctx.role[i] !== Role.Water) candidates.push(i);
    if (!candidates.length) break;
    const c = rng.pick(candidates);
    const [cx, cy] = ctx.xy(c);
    const r = 1.5 + p.water * 2.5 * rng.range(0.6, 1);
    for (let i = 0; i < n; i++) {
      const [x, y] = ctx.xy(i);
      const d = Math.hypot(x - cx, y - cy) + (ctx.noise.at(x * 0.8 + 50, y * 0.8) - 0.5) * 1.5;
      if (ctx.isProtected(i) || dist[i] < 2 || ctx.edgeDist(i) < p.borderThickness) continue;
      if (d <= r) ctx.set(i, T.waterDeep, Role.Water);
      else if (d <= r + 1.2 && ctx.isWall(i) && ctx.role[i] !== Role.Border) ctx.set(i, T.ground);
    }
  }

  // Stream: crosses the route from side to side. Bridges where it meets a path.
  const wantStream =
    p.stream === "yes" ||
    (p.stream === "auto" && p.water >= 0.2 && rng.chance(ctx.input.biome === "temperate_rainforest" || ctx.input.biome === "wetland" ? 0.75 : 0.45));
  if (!wantStream || ctx.mainLine.length < 12 || ctx.layout === "river" || ctx.layout === "water") return;
  const span = ctx.vertical ? height : width;
  const at = Math.round(span * rng.range(0.3, 0.7));
  const a = ctx.vertical ? ctx.idx(0, at) : ctx.idx(at, 0);
  const bAt = Math.min(span - 1, Math.max(0, at + rng.int(-4, 4)));
  const b = ctx.vertical ? ctx.idx(width - 1, bAt) : ctx.idx(bAt, height - 1);
  const line = cheapestPath(width, height, a, b, (i) => {
    if (ctx.locks[i]) return Infinity;
    const r = ctx.role[i];
    // Cross paths, never run along them, and keep clear of entrances, HM pockets, cliffs and stairs.
    if (r === Role.Opening || r === Role.Pocket || r === Role.Cliff || r === Role.Stairs) return Infinity;
    if (r === Role.Sea) return 1;
    const [x, y] = ctx.xy(i);
    const crossing = r === Role.MainPath || r === Role.Branch || r === Role.GrassRoute || r === Role.Corridor;
    return (crossing ? 30 : 1) + 3 * ctx.noise.fractal(x + 400, y + 400, 6, 2);
  });
  if (!line) return;
  for (const c of line) {
    ctx.stamp(c, 2, T.waterDeep, Role.Water, (j) => {
      const r = ctx.role[j];
      if (r === Role.MainPath || r === Role.Branch || r === Role.Corridor || r === Role.GrassRoute) {
        ctx.set(j, T.bridge, Role.Bridge);
        return false;
      }
      return r !== Role.Opening && r !== Role.Pocket && r !== Role.Bridge && r !== Role.Sea && r !== Role.Beach && r !== Role.Cliff && r !== Role.Stairs;
    });
  }
}

function addGrass(ctx: GenContext, dist: Float64Array) {
  const p = ctx.params;
  const candidates: Array<{ i: number; score: number }> = [];
  for (let i = 0; i < ctx.n; i++) {
    if (ctx.terrain[i] !== T.ground || ctx.locks[i] || ctx.isProtected(i) || besideCliff(ctx, i)) continue;
    const [x, y] = ctx.xy(i);
    // Grass prefers cells near the path, in large patches.
    const score = ctx.noise.fractal(x + 200, y + 700, 8, 3) - 0.04 * Math.min(dist[i], 6);
    candidates.push({ i, score });
  }
  if (!candidates.length || p.grass <= 0) return;
  candidates.sort((a, b) => b.score - a.score || a.i - b.i);
  const count = Math.round(candidates.length * p.grass);
  const biome = ctx.input.biome;
  for (let k = 0; k < count; k++) {
    const { i } = candidates[k];
    const [x, y] = ctx.xy(i);
    const tall = ctx.noise.at(x * 0.4 + 77, y * 0.4 + 11);
    const long = biome === "wetland" || (biome === "temperate_rainforest" && tall > 0.55);
    ctx.set(i, long ? T.longGrass : T.tallGrass);
  }
}

function addBiomeDetail(ctx: GenContext) {
  const biome = ctx.input.biome;
  for (let i = 0; i < ctx.n; i++) {
    if (ctx.terrain[i] !== T.ground || ctx.isProtected(i)) continue;
    const [x, y] = ctx.xy(i);
    const v = ctx.noise.fractal(x + 1300, y + 1700, 4, 2);
    if (biome === "coastal" && v > 0.6) ctx.set(i, T.sand);
    else if (biome === "wetland" && v > 0.66) ctx.set(i, T.mud);
    else if (biome === "meadow" && v > 0.68) ctx.set(i, T.flowers);
  }
}

/** True next to a plateau's cliff (no tall grass on raised edges by cliffs, per the spec). */
function besideCliff(ctx: GenContext, i: number): boolean {
  const [x, y] = ctx.xy(i);
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      if (!ctx.inside(x + dx, y + dy)) continue;
      if (ctx.role[ctx.idx(x + dx, y + dy)] === Role.Cliff) return true;
    }
  return false;
}
