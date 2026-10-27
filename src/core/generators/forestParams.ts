// Forest generator settings, saved in the map's `params` beside the route
// settings forests share (path width, grass, border, trainers, items, hidden
// items, levels).

export interface ForestParams {
  /** How twisty the maze is: 0 = open, with loops and short side paths; 1 = one long winding way with long dead ends. */
  mazeDensity: number;
  /** Clearings at junctions. */
  clearings: number;
  /** Hidden items that are always placed (at quiet dead ends first, then in corners). */
  guaranteedHidden: number;
}

export const DEFAULT_FOREST_PARAMS: ForestParams = { mazeDensity: 0.6, clearings: 3, guaranteedHidden: 2 };

export const FOREST_RANGES: Record<keyof ForestParams, [number, number, boolean]> = {
  mazeDensity: [0, 1, false],
  clearings: [0, 8, true],
  guaranteedHidden: [0, 8, true],
};

export function readForestParams(params: Record<string, string | number | boolean>): ForestParams {
  const out = { ...DEFAULT_FOREST_PARAMS };
  for (const key of Object.keys(FOREST_RANGES) as Array<keyof ForestParams>) {
    const [min, max, whole] = FOREST_RANGES[key];
    const v = params[key];
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    const c = Math.min(max, Math.max(min, v));
    out[key] = whole ? Math.round(c) : c;
  }
  return out;
}
