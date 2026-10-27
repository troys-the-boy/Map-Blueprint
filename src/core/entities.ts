// Helpers for entities: trainer sight lines and table IDs.

import { IS_WALKABLE } from "./grid";
import type { Entity, EntityKind } from "./model";
import type { Direction } from "./terrain";

/** Short ID prefixes used on blueprints and in the placement table (T1, I2…). */
export const ENTITY_PREFIX: Record<EntityKind, string> = {
  trainer: "T",
  npc: "N",
  item_ball: "I",
  cut_tree: "C",
  smash_rock: "R",
  strength_boulder: "B",
  berry_tree: "Y",
  trigger: "X",
  sign: "S",
  hidden_item: "H",
  secret_base: "Z",
  heal_location: "P",
};

/** Porymap event group for each kind. */
export const PORYMAP_GROUP: Record<EntityKind, "object" | "coord" | "bg" | "heal"> = {
  trainer: "object",
  npc: "object",
  item_ball: "object",
  cut_tree: "object",
  smash_rock: "object",
  strength_boulder: "object",
  berry_tree: "object",
  trigger: "coord",
  sign: "bg",
  hidden_item: "bg",
  secret_base: "bg",
  heal_location: "heal",
};

const FACING: Record<string, Direction[]> = {
  MOVEMENT_TYPE_FACE_UP: ["n"],
  MOVEMENT_TYPE_FACE_DOWN: ["s"],
  MOVEMENT_TYPE_FACE_LEFT: ["w"],
  MOVEMENT_TYPE_FACE_RIGHT: ["e"],
  MOVEMENT_TYPE_LOOK_AROUND: ["n", "e", "s", "w"],
};

export const FACE_MOVEMENT: Record<Direction, string> = {
  n: "MOVEMENT_TYPE_FACE_UP",
  s: "MOVEMENT_TYPE_FACE_DOWN",
  w: "MOVEMENT_TYPE_FACE_LEFT",
  e: "MOVEMENT_TYPE_FACE_RIGHT",
};

const STEP: Record<Direction, [number, number]> = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };

/**
 * Cells a trainer can see: along each direction it faces, up to its sight range,
 * stopping at the first cell the player couldn't stand on (a tree, wall, water…).
 */
export function trainerSight(e: Entity, width: number, height: number, terrain: Uint8Array): number[] {
  if (e.kind !== "trainer") return [];
  const range = Number(e.fields.trainer_sight_or_berry_tree_id ?? 0);
  if (!Number.isFinite(range) || range <= 0) return [];
  const dirs = FACING[String(e.fields.movement_type ?? "")] ?? [];
  const out: number[] = [];
  for (const d of dirs) {
    const [dx, dy] = STEP[d];
    for (let k = 1; k <= range; k++) {
      const x = e.x + dx * k;
      const y = e.y + dy * k;
      if (x < 0 || y < 0 || x >= width || y >= height) break;
      const i = y * width + x;
      if (!IS_WALKABLE[terrain[i]]) break;
      out.push(i);
    }
  }
  return out;
}
