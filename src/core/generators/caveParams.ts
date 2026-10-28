// Cave generator settings, saved in the map's `params` beside the route settings
// caves share (border, trainers, items, hidden items, levels). "Dark" is the
// header's requires_flash, set in the Generate tab. The floors of one cave are
// separate maps, linked by `caveGroup` (the first floor's map id) and `floor`
// (0 = 1F, 1 = B1F…) in their params (see core/caves.ts).

export interface CaveParams {
  /** Ways out of this floor (cave mouths to the outside). Exits you set up by hand count too. */
  exits: number;
  /** How open the cave is: 0 = narrow tunnels and small chambers, 1 = big caverns. */
  openness: number;
  /** Raised rock platforms with stairs up. */
  platforms: number;
  /** Underground water (needs Surf), away from the main way through, 0 … 1. */
  waterLevel: number;
  /** Rock Smash rocks, each closing a side passage with an item behind it. */
  rockSmash: number;
  /** Strength boulders, each blocking a side passage: push it in to reach the item behind. */
  boulders: number;
  /** First floor only: how many floors the cave has (Generate makes the others: B1F, B2F…). */
  floors: number;
  /** First floor only: ladders between each floor and the next. */
  ladders: number;
  /** Set by Generate on each floor: ladders up to the floor above, and down to the floor below. */
  laddersUp: number;
  laddersDown: number;
}

export const DEFAULT_CAVE_PARAMS: CaveParams = { exits: 2, openness: 0.5, platforms: 1, waterLevel: 0.2, rockSmash: 1, boulders: 0, floors: 1, ladders: 1, laddersUp: 0, laddersDown: 0 };

export const CAVE_RANGES: Record<keyof CaveParams, [number, number, boolean]> = {
  exits: [0, 4, true],
  openness: [0, 1, false],
  platforms: [0, 4, true],
  waterLevel: [0, 1, false],
  rockSmash: [0, 4, true],
  boulders: [0, 3, true],
  floors: [1, 4, true],
  ladders: [1, 3, true],
  laddersUp: [0, 3, true],
  laddersDown: [0, 3, true],
};

export function readCaveParams(params: Record<string, string | number | boolean>): CaveParams {
  const out = { ...DEFAULT_CAVE_PARAMS };
  for (const key of Object.keys(CAVE_RANGES) as Array<keyof CaveParams>) {
    const [min, max, whole] = CAVE_RANGES[key];
    const v = params[key];
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    const c = Math.min(max, Math.max(min, v));
    out[key] = whole ? Math.round(c) : c;
  }
  return out;
}
