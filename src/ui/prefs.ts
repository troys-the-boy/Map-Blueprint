// Per-device preferences (not part of the project file), kept in localStorage.
// Browser storage can be missing or cleared (private windows, Safari clearing
// unused sites), so every read and write is wrapped and falls back to defaults.

export type FingerMode = "auto" | "paint" | "pan";

export interface Overlays {
  grid: boolean;
  rulers: boolean;
  screenFrame: boolean;
  locks: boolean;
  /** Trainer sight lines. */
  sight: boolean;
  /** Validation markers on the map. */
  issues: boolean;
  /** Reachability heatmap: colour by which HMs are needed. */
  reach: boolean;
  /** Elevation, drawn like Porymap's collision view. */
  elevation: boolean;
  /** The user's zones (biome, water, edges, keep-clear). */
  zones: boolean;
  /** Connected maps, faded, beyond the edges (the stitched view). */
  neighbours: boolean;
}

export interface Prefs {
  /** What one finger does on a touch screen. "auto": paint until an Apple Pencil is seen, then pan. */
  fingerMode: FingerMode;
  /** Set the first time a pen (Apple Pencil) touches the canvas. */
  penSeen: boolean;
  paletteId: string;
  overlays: Overlays;
  /** How strongly the Elevation overlay covers the map, 0.15 … 1 (like Porymap's opacity slider). */
  elevationOpacity: number;
  /** Lock cells the pencil paints, so later generators keep them. */
  lockWhenPainting: boolean;
  /** What fills the gap left by a move, cut or delete: plain ground, or terrain made by the generator. */
  gapFill: "ground" | "regenerate";
  /** Saving with reference images: don't ask again until they add more than this many bytes (0 = always ask). */
  imagesOkUpTo: number;
}

const KEY = "g3mb.prefs.v1";

export const DEFAULT_PREFS: Prefs = {
  fingerMode: "auto",
  penSeen: false,
  paletteId: "pnw",
  overlays: { grid: true, rulers: true, screenFrame: true, locks: false, sight: true, issues: true, reach: false, elevation: false, zones: true, neighbours: true },
  lockWhenPainting: true,
  elevationOpacity: 0.6,
  gapFill: "regenerate",
  imagesOkUpTo: 0,
};

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULT_PREFS);
    const p = JSON.parse(raw) as Partial<Prefs>;
    return {
      fingerMode: p.fingerMode === "paint" || p.fingerMode === "pan" ? p.fingerMode : "auto",
      penSeen: p.penSeen === true,
      paletteId: typeof p.paletteId === "string" ? p.paletteId : DEFAULT_PREFS.paletteId,
      overlays: {
        grid: p.overlays?.grid !== false,
        rulers: p.overlays?.rulers !== false,
        screenFrame: p.overlays?.screenFrame !== false,
        locks: p.overlays?.locks === true,
        sight: p.overlays?.sight !== false,
        issues: p.overlays?.issues !== false,
        reach: p.overlays?.reach === true,
        elevation: p.overlays?.elevation === true,
        zones: p.overlays?.zones !== false,
        neighbours: p.overlays?.neighbours !== false,
      },
      lockWhenPainting: p.lockWhenPainting !== false,
      gapFill: p.gapFill === "ground" ? "ground" : "regenerate",
      imagesOkUpTo: typeof p.imagesOkUpTo === "number" && p.imagesOkUpTo >= 0 ? p.imagesOkUpTo : 0,
      elevationOpacity:
        typeof p.elevationOpacity === "number" && p.elevationOpacity >= 0.15 && p.elevationOpacity <= 1 ? p.elevationOpacity : DEFAULT_PREFS.elevationOpacity,
    };
  } catch {
    return structuredClone(DEFAULT_PREFS);
  }
}

export function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // Storage unavailable: preferences simply won't be remembered.
  }
}
