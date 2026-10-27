// "Two ways through": the trade-off between trainers and wild Pokémon.
//
//   • The main path is the longer, winding way. Trainers stand along it.
//   • The grass shortcut is a more direct way between two points of the main
//     path, carved through the trees and filled with tall grass. It skips the
//     trainers on that stretch of path, but one trainer may still watch it.
//   • A few stretches of grass cross the main path itself, so walking the path
//     still means some wild encounters.
//
// The placement stage uses ctx.shortcut to put trainers where they force a
// battle on the path but can be avoided through the grass.

import { T, cheapestPath } from "../grid";
import type { GenContext } from "./context";
import { Role } from "./context";

export function addGrassShortcut(ctx: GenContext): void {
  if (ctx.layout === "water" || !ctx.params.grassShortcut) return;
  const line = ctx.mainLine;
  if (line.length < 30) return;

  // Pick the stretch where the path wanders most: long along the path, short as the crow flies.
  let best: { i: number; j: number; gain: number } | null = null;
  for (let i = Math.floor(line.length * 0.1); i < line.length * 0.8; i += 2) {
    const [ax, ay] = ctx.xy(line[i]);
    for (let j = i + 16; j < Math.min(line.length - 4, i + 70); j += 2) {
      const [bx, by] = ctx.xy(line[j]);
      const direct = Math.abs(ax - bx) + Math.abs(ay - by);
      if (direct < 8) continue;
      const gain = j - i - direct * 1.15 + ctx.rng.next() * 2;
      if (!best || gain > best.gain) best = { i, j, gain };
    }
  }
  if (!best) return;

  const blocked = (c: number) => {
    const r = ctx.role[c];
    return (
      ctx.locks[c] === 1 ||
      r === Role.Opening ||
      r === Role.Cliff ||
      r === Role.Sea ||
      r === Role.Bridge ||
      r === Role.Border ||
      r === Role.Keep ||
      ctx.edgeDist(c) < ctx.params.borderThickness + 1
    );
  };
  const route = cheapestPath(ctx.width, ctx.height, line[best.i], line[best.j], (c) => {
    if (blocked(c)) return Infinity;
    const r = ctx.role[c];
    if (r === Role.MainPath || r === Role.Branch) return 25;
    if (r === Role.Stairs) return 1;
    return 1;
  });
  if (!route) return;
  // It must really be a separate way, not the path itself.
  const fresh = route.filter((c) => ctx.role[c] !== Role.MainPath && ctx.role[c] !== Role.Branch).length;
  if (fresh < route.length * 0.6) return;

  for (const c of route)
    ctx.stamp(c, 3, T.tallGrass, Role.GrassRoute, (j) => {
      const r = ctx.role[j];
      // Keep the shortcut on one level: only the cells the route actually walks cross stairs.
      if (ctx.elevation[j] !== ctx.elevation[c]) return false;
      return !blocked(j) && r !== Role.MainPath && r !== Role.Branch && r !== Role.Stairs && r !== Role.Beach;
    });
  // Wetland grass is long grass.
  for (let i = 0; i < ctx.n; i++) if (ctx.role[i] === Role.GrassRoute && ctx.terrain[i] === T.tallGrass && ctx.biomeAt(i) === "wetland") ctx.set(i, T.longGrass);
  ctx.shortcut = { from: best.i, to: best.j };
}

/** Grass stretches across the main path, so the path has some unavoidable wild encounters. */
export function addPathGrass(ctx: GenContext): void {
  if (ctx.layout === "water") return;
  const line = ctx.mainLine;
  const stretches = Math.round(ctx.params.pathGrass * 3);
  if (line.length < 20 || stretches === 0) return;
  for (let s = 0; s < stretches; s++) {
    // Spread the stretches out along the path, away from the entrances.
    const centre = Math.floor(line.length * ((s + 1) / (stretches + 1)) + ctx.rng.int(-4, 4));
    const half = ctx.rng.int(2, 4);
    for (let k = centre - half; k <= centre + half; k++) {
      if (k < 6 || k >= line.length - 6) continue;
      const [x, y] = ctx.xy(line[k]);
      // Every main-path cell within reach of this stretch of centre line becomes grass.
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          if (!ctx.inside(x + dx, y + dy)) continue;
          const j = ctx.idx(x + dx, y + dy);
          if (ctx.role[j] === Role.MainPath && ctx.terrain[j] === T.path) ctx.set(j, ctx.biomeAt(j) === "wetland" ? T.longGrass : T.tallGrass);
        }
    }
  }
}
