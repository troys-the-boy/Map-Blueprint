// Travel direction: which entrance the player first arrives at, and which they
// leave by. A route is played forward once, then crossed again later, so the
// generator shapes it for that first trip:
//
//   • ledge rows jump back toward the start: walking forward, the path winds
//     round them (past the trainers); coming back, the player jumps down;
//   • a small ledge pocket holds an item only reachable on the way back;
//   • trainers face the oncoming player, and none wait right at the start;
//   • the hillsides rise toward the end;
//   • the route sign stands at the start.
//
// Vanilla Emerald has no north-facing ledge (MB_JUMP_SOUTH/EAST/WEST only, see
// GetLedgeJumpDirection in src/field_player_avatar.c). So a route travelled
// north to south can't have ledges jumping back: its ledges are forward drops,
// fewer rows, and its ledge pocket is a reward on the way forward.
//
// Only straight routes for now (north–south or west–east, either way).
// "auto" means no direction: the generator behaves exactly as before.

import type { Edge } from "../model";

export const TRAVEL_SETTINGS = ["auto", "south_north", "north_south", "west_east", "east_west"] as const;
export type TravelSetting = (typeof TRAVEL_SETTINGS)[number];

export const TRAVEL_LABELS: Record<TravelSetting, string> = {
  auto: "Either way (no direction)",
  south_north: "South → North",
  north_south: "North → South",
  west_east: "West → East",
  east_west: "East → West",
};

export interface Travel {
  /** The edge the player first arrives at, and the one they leave by. */
  from: Edge;
  to: Edge;
}

/** The travel direction of a setting, or null for "auto". */
export function travelOf(setting: TravelSetting): Travel | null {
  if (setting === "auto") return null;
  const [from, to] = setting.split("_") as [Edge, Edge];
  return { from, to };
}

/** True when the route runs north–south. */
export function travelVertical(t: Travel): boolean {
  return t.from === "north" || t.from === "south";
}

/** The direction pointing back toward the start, as a ledge direction ("n" is impossible). */
export function backDir(t: Travel): "n" | "s" | "e" | "w" {
  return t.from === "north" ? "n" : t.from === "south" ? "s" : t.from === "east" ? "e" : "w";
}

/**
 * How far along the route a cell is, from 0 at the start edge to 1 at the end edge.
 */
export function progress(t: Travel, x: number, y: number, width: number, height: number): number {
  switch (t.from) {
    case "north":
      return height > 1 ? y / (height - 1) : 0;
    case "south":
      return height > 1 ? (height - 1 - y) / (height - 1) : 0;
    case "west":
      return width > 1 ? x / (width - 1) : 0;
    case "east":
      return width > 1 ? (width - 1 - x) / (width - 1) : 0;
  }
}

/** Cells from the start edge. */
export function fromStart(t: Travel, x: number, y: number, width: number, height: number): number {
  return t.from === "north" ? y : t.from === "south" ? height - 1 - y : t.from === "west" ? x : width - 1 - x;
}
