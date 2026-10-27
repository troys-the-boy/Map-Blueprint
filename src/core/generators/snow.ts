// Snow: the "Snow" setting (0–100) covers part of the route in snow, highest
// ground first, so a hilly route can be snowy on top and green in the valley.
//
// Inside the snowy area:
//   • open ground, sand, mud and flowers become snow;
//   • tall and long grass become snowy grass (still wild encounters);
//   • ponds and puddles freeze into slippery ice (the sea and rivers don't);
//   • some trees become snowdrifts (both block, so the way through is unchanged).
// Paths stay paths, as a trodden trail through the snow.
//
// Gen 3 has no snow tiles: all of these need custom tiles in the region's tileset.

import { T } from "../grid";
import type { GenContext } from "./context";
import { LEVEL, RAISED, Role } from "./context";

const TO_SNOW = new Set<number>([T.ground, T.sand, T.mud, T.flowers]);
const TO_SNOW_GRASS = new Set<number>([T.tallGrass, T.longGrass]);

/** How many levels up a cell is: 0 for ground and water, 1–4 on plateaus. */
function tier(ctx: GenContext, i: number): number {
  return RAISED.indexOf(ctx.elevation[i]) + 1;
}

export function addSnow(ctx: GenContext): void {
  const amount = ctx.params.snow;
  if (amount <= 0) return;
  // Score every cell by height, plus noise so the snow line isn't just the cliff
  // edges. The setting is the share of the route that gets snow: the highest-scoring
  // cells, so the tops of plateaus go white first.
  const score = new Float32Array(ctx.n);
  for (let i = 0; i < ctx.n; i++) {
    const [x, y] = ctx.xy(i);
    score[i] = tier(ctx, i) + 1.2 * ctx.noise.fractal(x + 5100, y + 5300, 10, 3);
  }
  const sorted = Array.from(score).sort((a, b) => b - a);
  const line = amount >= 1 ? -Infinity : sorted[Math.min(ctx.n - 1, Math.floor(amount * ctx.n))];
  const snowy = new Uint8Array(ctx.n);
  for (let i = 0; i < ctx.n; i++) if (score[i] > line) snowy[i] = 1;

  for (let i = 0; i < ctx.n; i++) {
    if (!snowy[i] || ctx.locks[i]) continue;
    const t = ctx.terrain[i];
    const [x, y] = ctx.xy(i);
    if (TO_SNOW.has(t)) ctx.set(i, T.snow);
    else if (TO_SNOW_GRASS.has(t)) ctx.set(i, T.snowGrass);
    else if (t === T.tree && ctx.noise.at(x * 0.6 + 5500, y * 0.6) > 0.66) ctx.set(i, T.snowdrift);
  }

  // Freeze ponds and puddles that lie wholly in the snow. The sea, rivers and
  // Surf pockets stay water, so Surf routes still work.
  const frozen = new Uint8Array(ctx.n);
  const seen = new Uint8Array(ctx.n);
  const isPond = (i: number) =>
    !ctx.locks[i] &&
    ((ctx.terrain[i] === T.waterDeep && ctx.role[i] === Role.Water) || ctx.terrain[i] === T.waterShallow) &&
    ctx.elevation[i] !== LEVEL.bridge;
  for (let s = 0; s < ctx.n; s++) {
    if (seen[s] || !isPond(s)) continue;
    const body: number[] = [s];
    seen[s] = 1;
    let allSnowy = true;
    for (let h = 0; h < body.length; h++) {
      const i = body[h];
      if (!snowy[i]) allSnowy = false;
      const [x, y] = ctx.xy(i);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (!ctx.inside(x + dx, y + dy)) continue;
        const j = ctx.idx(x + dx, y + dy);
        if (!seen[j] && isPond(j)) {
          seen[j] = 1;
          body.push(j);
        }
      }
    }
    if (allSnowy) for (const i of body) frozen[i] = 1;
  }
  for (let i = 0; i < ctx.n; i++) if (frozen[i]) ctx.set(i, T.ice, Role.Clearing);

  // Along the snow line, tidy single cells a tileset can't draw: a lone cell of
  // grass takes a neighbouring grass kind; a lone fleck of sand, mud, flowers or
  // grass with no grass beside it becomes snow (in the snow) or plain ground.
  const grassy = [T.tallGrass, T.longGrass, T.snowGrass];
  const flecks = new Set<number>([...grassy, T.sand, T.mud, T.flowers]);
  for (let i = 0; i < ctx.n; i++) {
    const t = ctx.terrain[i];
    if (!flecks.has(t) || ctx.locks[i]) continue;
    const [x, y] = ctx.xy(i);
    const around = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => ctx.inside(x + dx, y + dy)).map(([dx, dy]) => ctx.idx(x + dx, y + dy));
    const near = around.map((j) => ctx.terrain[j]);
    if (near.includes(t) || (!snowy[i] && !around.some((j) => snowy[j]))) continue;
    const other = grassy.includes(t) ? near.find((u) => u !== t && grassy.includes(u)) : undefined;
    // Grass on the path and the grass shortcut stays grass (it's there on purpose).
    const keepGrass = ctx.role[i] === Role.MainPath || ctx.role[i] === Role.GrassRoute;
    if (other !== undefined) ctx.set(i, other);
    else if (!keepGrass) ctx.set(i, snowy[i] ? T.snow : T.ground);
  }
}
