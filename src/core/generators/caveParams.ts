// Cave generator settings, saved in the map's `params` beside the route settings
// caves share (border, trainers, items, hidden items, levels). "Dark" is the
// header's requires_flash, set in the Generate tab.

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
}

export const DEFAULT_CAVE_PARAMS: CaveParams = { exits: 2, openness: 0.5, platforms: 1, waterLevel: 0.2, rockSmash: 1 };

export const CAVE_RANGES: Record<keyof CaveParams, [number, number, boolean]> = {
  exits: [1, 4, true],
  openness: [0, 1, false],
  platforms: [0, 4, true],
  waterLevel: [0, 1, false],
  rockSmash: [0, 4, true],
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
