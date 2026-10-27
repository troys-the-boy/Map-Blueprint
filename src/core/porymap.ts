// How Porymap shows collision and elevation, so the blueprint can match it.
//
// Porymap's collision view colours every metatile by its elevation (0–F) and
// writes the number on it: white where the player can walk, red where they
// can't. The colours below are the row backgrounds of Porymap's default
// collision image, resources/images/collisions.png in huderlem/porymap
// (checked 2026-10-27).
//
// The elevation numbers come from the tileset profile (config, not code):
// profiles/tilesets/vanilla-emerald-general.json. Their meaning is in
// pret/pokeemerald include/global.fieldmap.h: ELEVATION_TRANSITION 0 (stairs:
// step on, then off to any level), ELEVATION_SURF 1, ELEVATION_DEFAULT 3,
// ELEVATION_MULTI_LEVEL 15 (bridges).

import vanillaProfile from "../../profiles/tilesets/vanilla-emerald-general.json";
import type { ElevationLevel } from "./terrain";
import { ELEVATION_LEVELS, TERRAIN_TYPES } from "./terrain";

/** Porymap's colour for each elevation value 0–15. */
export const PORYMAP_ELEVATION_COLORS: readonly string[] = [
  "#c8c5be", // 0 transition (stairs)
  "#465175", // 1 surf
  "#4a8c94", // 2
  "#90a667", // 3 normal ground
  "#b4b45d", // 4
  "#cfc280", // 5
  "#ceae54", // 6
  "#c38b3c", // 7
  "#b4702d", // 8
  "#a55e35", // 9
  "#894614", // A
  "#733c17", // B
  "#491906", // C
  "#360f00", // D
  "#000000", // E
  "#363636", // F multi-level (bridges)
];

/** Colour of the number Porymap draws: white for passable, red for impassable. */
export const PORYMAP_PASSABLE_TEXT = "#ffffff";
export const PORYMAP_BLOCKED_TEXT = "#ff0000";

type ElevationTable = Record<ElevationLevel | "transition", number>;

function loadTable(raw: Record<string, unknown>): ElevationTable {
  const out = {} as ElevationTable;
  for (const key of [...ELEVATION_LEVELS, "transition"] as const) {
    const v = raw[key];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 15)
      throw new Error(`profiles/tilesets/vanilla-emerald-general.json: elevation "${key}" must be a whole number 0–15`);
    out[key] = v;
  }
  return out;
}

/** Elevation number (0–15) for each abstract level, plus "transition" for stairs. */
export const ELEVATION_VALUES: Readonly<ElevationTable> = loadTable(vanillaProfile.elevation as Record<string, unknown>);

/** Porymap number for each level index (index into ELEVATION_LEVELS). */
export const LEVEL_VALUE: readonly number[] = ELEVATION_LEVELS.map((l) => ELEVATION_VALUES[l]);

const STAIRS = TERRAIN_TYPES.findIndex((t) => t.id === "stairs");

/** The elevation value Porymap would show for a cell: stairs are transition tiles. */
export function cellElevationValue(terrain: number, level: number): number {
  return terrain === STAIRS ? ELEVATION_VALUES.transition : LEVEL_VALUE[level] ?? ELEVATION_VALUES.ground;
}

/** True when Porymap would mark the cell impassable (collision 1): trees, walls, signs, buildings… */
export function isImpassable(terrain: number): boolean {
  return TERRAIN_TYPES[terrain]?.passability === "blocked";
}

/** One hex digit, as Porymap labels elevations. */
export function hexDigit(v: number): string {
  return v.toString(16).toUpperCase();
}

/** Level index for a Porymap elevation value, or -1 if no abstract level uses it. */
export function levelForValue(v: number): number {
  return LEVEL_VALUE.indexOf(v);
}
