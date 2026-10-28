// Travel direction: which entrance the player first arrives at (the Start), and
// which they leave by (the Finish). A route is played forward once, then crossed
// again later, so the generator shapes it for that first trip:
//
//   • ledge rows jump back toward the start: walking forward, the path winds
//     round them (past the trainers); coming back, the player jumps down;
//   • a small ledge pocket holds an item only reachable on the way back;
//   • trainers face the oncoming player, and none wait right at the start;
//   • the hillsides rise toward the end;
//   • the route sign stands at the start.
//
// The Start and Finish are marked on the map's entrances ("role" on an opening).
// They may be on opposite edges (a straight route) or on edges at a corner (a
// route that bends); not on the same edge. How far along the route a cell is
// comes from its distance to the Start's edge and to the Finish's edge.
//
// Vanilla Emerald has no north-facing ledge (MB_JUMP_SOUTH/EAST/WEST only, see
// GetLedgeJumpDirection in src/field_player_avatar.c). So when "back toward the
// start" is north, ledges can't jump back: they're forward drops toward the
// Finish, fewer rows, and the ledge pocket is a reward on the way forward.
//
// No Start or Finish means no direction: the generator behaves as before.

import type { Edge, Opening } from "../model";

/**
 * The old travel direction setting (before file format 10). Still read from a map
 * whose entrances are automatic, so its next Generate marks the Start and Finish.
 */
export const TRAVEL_SETTINGS = ["auto", "south_north", "north_south", "west_east", "east_west"] as const;
export type TravelSetting = (typeof TRAVEL_SETTINGS)[number];

export interface Travel {
  /** The edge the player first arrives at, and the one they leave by. */
  from: Edge;
  to: Edge;
}

/** The travel direction of an old setting, or null for "auto". */
export function travelOf(setting: TravelSetting): Travel | null {
  if (setting === "auto") return null;
  const [from, to] = setting.split("_") as [Edge, Edge];
  return { from, to };
}

/** The travel direction from the entrances marked Start and Finish, or null. */
export function travelFromOpenings(openings: readonly Opening[]): Travel | null {
  const start = openings.find((o) => o.role === "start");
  const finish = openings.find((o) => o.role === "finish");
  if (!start || !finish || start.edge === finish.edge) return null;
  return { from: start.edge, to: finish.edge };
}

/**
 * What's wrong with the Start and Finish marks, in plain words, or null if they
 * give a direction (or there are none at all).
 */
export function travelProblem(openings: readonly Opening[]): string | null {
  const start = openings.find((o) => o.role === "start");
  const finish = openings.find((o) => o.role === "finish");
  if (!start && !finish) return null;
  if (!finish) return "Mark another entrance as the Finish too, or the Start is ignored.";
  if (!start) return "Mark another entrance as the Start too, or the Finish is ignored.";
  if (start.edge === finish.edge) return "The Start and Finish are on the same edge, so they're ignored. Put them on different edges.";
  return null;
}

/**
 * Mark the Start and Finish on entrances from an old travel setting: the first
 * entrance on each end's edge (a walk entrance if there is one). Others are unmarked.
 */
export function markTravel(openings: readonly Opening[], setting: unknown): Opening[] {
  const t = typeof setting === "string" && (TRAVEL_SETTINGS as readonly string[]).includes(setting) ? travelOf(setting as TravelSetting) : null;
  const pick = (edge: Edge) => openings.find((o) => o.edge === edge && o.kind === "walk") ?? openings.find((o) => o.edge === edge);
  const start = t && pick(t.from);
  const finish = t && pick(t.to);
  return openings.map((o) => {
    const { role: _old, ...rest } = o;
    return start && finish && o === start ? { ...rest, role: "start" } : start && finish && o === finish ? { ...rest, role: "finish" } : rest;
  });
}

/** True when the route runs north–south. */
export function travelVertical(t: Travel): boolean {
  return t.from === "north" || t.from === "south";
}

const LETTER: Record<Edge, "n" | "s" | "e" | "w"> = { north: "n", south: "s", east: "e", west: "w" };

/** The direction pointing back toward the start, as a ledge direction ("n" is impossible). */
export function backDir(t: Travel): "n" | "s" | "e" | "w" {
  return LETTER[t.from];
}

/**
 * Which way ledges jump: back toward the start, or, when that would be north
 * (no north ledges in Gen 3), forward toward the finish.
 */
export function ledgeDir(t: Travel): "s" | "e" | "w" {
  const back = backDir(t);
  return back !== "n" ? back : (LETTER[t.to] as "s" | "e" | "w");
}

/** Cells from an edge. */
function edgeDistance(edge: Edge, x: number, y: number, width: number, height: number): number {
  return edge === "north" ? y : edge === "south" ? height - 1 - y : edge === "west" ? x : width - 1 - x;
}

/**
 * How far along the route a cell is, from 0 at the start edge to 1 at the end edge.
 * On a straight route that's the share of the length; on a bend, how much nearer
 * the finish's edge the cell is than the start's.
 */
export function progress(t: Travel, x: number, y: number, width: number, height: number): number {
  const a = edgeDistance(t.from, x, y, width, height);
  const b = edgeDistance(t.to, x, y, width, height);
  return a + b > 0 ? a / (a + b) : 0;
}

/** Cells from the start edge. */
export function fromStart(t: Travel, x: number, y: number, width: number, height: number): number {
  return edgeDistance(t.from, x, y, width, height);
}
