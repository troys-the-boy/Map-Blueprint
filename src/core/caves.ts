// Multi-floor caves: each floor is its own map (as in pokeemerald, where Granite
// Cave is MAP_GRANITE_CAVE_1F, _B1F, _B2F…). The first floor holds the cave's
// Floors and Ladders settings; the others point back to it:
//
//   params.caveGroup = the first floor's map id,  params.floor = 0 (1F), 1 (B1F)…
//
// Ladders are warps. Each floor's generated ladders list its ladders up first,
// then its ladders down (params.laddersUp / laddersDown, set before Generate).
// pairLadders links ladder k down on one floor with ladder k up on the floor
// below, both ways: dest_map is the other floor's MAP_* constant and
// dest_warp_id its number in that floor's warp list.

import type { MapBlueprint, Warp } from "./model";
import { readCaveParams } from "./generators/caveParams";

/** The first floor's map id for a cave map (its own id if it is the first floor). */
export function caveGroupOf(map: MapBlueprint): string {
  return typeof map.params.caveGroup === "string" ? map.params.caveGroup : map.id;
}

export function floorOf(map: MapBlueprint): number {
  return typeof map.params.floor === "number" ? map.params.floor : 0;
}

/** Floor names as in vanilla: 1F, B1F, B2F… */
export function floorName(floor: number): string {
  return floor === 0 ? "1F" : `B${floor}F`;
}

/** The maps of one cave, first floor first. */
export function caveFloors(maps: readonly MapBlueprint[], map: MapBlueprint): MapBlueprint[] {
  const group = caveGroupOf(map);
  return maps.filter((m) => m.mapType === "cave" && caveGroupOf(m) === group).sort((a, b) => floorOf(a) - floorOf(b));
}

/** How many floors the cave has and how many ladders join each pair (from its first floor). */
export function cavePlan(maps: readonly MapBlueprint[], map: MapBlueprint): { floors: number; ladders: number; first: MapBlueprint } {
  const group = caveGroupOf(map);
  const first = maps.find((m) => m.id === group) ?? map;
  const p = readCaveParams(first.params);
  return { floors: p.floors, ladders: p.ladders, first };
}

/** Ladders up and down for one floor, from the cave's plan. Floors past the last get none. */
export function ladderCounts(maps: readonly MapBlueprint[], map: MapBlueprint): { up: number; down: number } {
  const { floors, ladders } = cavePlan(maps, map);
  const f = floorOf(map);
  if (f >= floors) return { up: 0, down: 0 };
  return { up: f > 0 ? ladders : 0, down: f < floors - 1 ? ladders : 0 };
}

/** A floor's generated ladders, split into up and down (in the order Generate made them). */
function laddersOf(map: MapBlueprint): { up: Warp[]; down: Warp[] } {
  const all = map.warps.filter((w) => w.kind === "ladder" && !w.locked);
  const up = Math.min(all.length, readCaveParams(map.params).laddersUp);
  return { up: all.slice(0, up), down: all.slice(up) };
}

/** Link each floor's ladders down with the next floor's ladders up, both ways. */
export function pairLadders(floors: readonly MapBlueprint[]): void {
  for (let k = 0; k + 1 < floors.length; k++) {
    const upper = floors[k];
    const lower = floors[k + 1];
    if (floorOf(lower) !== floorOf(upper) + 1) continue;
    const down = laddersOf(upper).down;
    const up = laddersOf(lower).up;
    for (let j = 0; j < Math.min(down.length, up.length); j++) {
      down[j].destMap = lower.header.id;
      down[j].destWarpId = lower.warps.indexOf(up[j]);
      up[j].destMap = upper.header.id;
      up[j].destWarpId = upper.warps.indexOf(down[j]);
    }
  }
}
