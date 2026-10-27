// The Things tool: placing, turning and removing things on a map by hand
// (trainers, items, signs, HM obstacles…).
//
// Field values are the same suggestions the generator uses; Milestone 4 adds a
// panel to edit every field. Graphics and scripts are vanilla pokeemerald names:
//   • OBJ_EVENT_GFX_* from include/constants/event_objects.h;
//   • EventScript_CutTree, EventScript_RockSmash and EventScript_StrengthBoulder
//     from data/scripts/field_move_scripts.inc;
//   • MOVEMENT_TYPE_* from include/constants/event_object_movement.h.

import { ENTITY_PREFIX, FACE_MOVEMENT } from "./entities";
import type { Entity, EntityKind, MapBlueprint } from "./model";
import { ELEVATION_LEVELS } from "./terrain";
import type { Direction } from "./terrain";

/** The kinds the Things tool can place, in the order shown in the Paint tab. */
export const PLACEABLE_KINDS: readonly EntityKind[] = ["trainer", "item_ball", "hidden_item", "npc", "sign", "cut_tree", "smash_rock", "strength_boulder"];

export const THING_LABELS: Partial<Record<EntityKind, string>> = {
  trainer: "Trainer",
  item_ball: "Item",
  hidden_item: "Hidden item",
  npc: "Person",
  sign: "Sign",
  cut_tree: "Cut tree",
  smash_rock: "Rock Smash rock",
  strength_boulder: "Strength boulder",
};

/** Default sight range for a trainer placed by hand, in cells. */
export const DEFAULT_SIGHT = 3;
/** Longest sight range the tool offers. */
export const MAX_SIGHT = 9;

/** "Route 1" → "Route1", for script labels (same rule the generator uses). */
export function scriptLabel(map: MapBlueprint): string {
  return map.header.name.replace(/[^A-Za-z0-9]/g, "") || map.name.replace(/[^A-Za-z0-9]/g, "") || "Map";
}

/** The next free ID for a kind: T1, T2… skipping numbers already in use. */
export function nextEntityId(map: MapBlueprint, kind: EntityKind): string {
  const prefix = ENTITY_PREFIX[kind];
  let max = 0;
  for (const e of map.entities) {
    const m = /^([A-Z])(\d+)$/.exec(e.id);
    if (m && m[1] === prefix) max = Math.max(max, Number(m[2]));
  }
  return `${prefix}${max + 1}`;
}

/** The thing standing on a cell, if any. */
export function entityAt(map: MapBlueprint, x: number, y: number): Entity | undefined {
  return map.entities.find((e) => e.x === x && e.y === y);
}

/** A new thing of this kind at (x, y), locked, with suggested Porymap fields. */
export function newThing(map: MapBlueprint, kind: EntityKind, x: number, y: number): Entity {
  const id = nextEntityId(map, kind);
  const n = id.slice(1);
  const label = scriptLabel(map);
  const flagBase = label.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase();
  const object = (graphics: string, movement: string, script: string) => ({ graphics_id: graphics, movement_type: movement, script, flag: "0" });
  const fieldsFor: Record<string, Entity["fields"]> = {
    trainer: {
      ...object("OBJ_EVENT_GFX_YOUNGSTER", FACE_MOVEMENT.s, `${label}_EventScript_Trainer${n}`),
      movement_range_x: 0,
      movement_range_y: 0,
      trainer_type: "TRAINER_TYPE_NORMAL",
      trainer_sight_or_berry_tree_id: String(DEFAULT_SIGHT),
    },
    npc: {
      ...object("OBJ_EVENT_GFX_BOY_1", "MOVEMENT_TYPE_WANDER_AROUND", `${label}_EventScript_Person${n}`),
      movement_range_x: 1,
      movement_range_y: 1,
      trainer_type: "TRAINER_TYPE_NONE",
      trainer_sight_or_berry_tree_id: "0",
    },
    item_ball: {
      ...object("OBJ_EVENT_GFX_ITEM_BALL", "MOVEMENT_TYPE_LOOK_AROUND", `${label}_EventScript_Item${n}`),
      item: "ITEM_POTION",
      tier: "common",
      flag: `FLAG_ITEM_${flagBase}_${n}`,
    },
    hidden_item: { item: "ITEM_POTION", tier: "common", flag: `FLAG_HIDDEN_ITEM_${flagBase}_${n}` },
    sign: { player_facing_dir: "BG_EVENT_PLAYER_FACING_ANY", script: `${label}_EventScript_Sign${n}`, text: "" },
    cut_tree: object("OBJ_EVENT_GFX_CUTTABLE_TREE", "MOVEMENT_TYPE_LOOK_AROUND", "EventScript_CutTree"),
    smash_rock: object("OBJ_EVENT_GFX_BREAKABLE_ROCK", "MOVEMENT_TYPE_LOOK_AROUND", "EventScript_RockSmash"),
    strength_boulder: object("OBJ_EVENT_GFX_PUSHABLE_BOULDER", "MOVEMENT_TYPE_LOOK_AROUND", "EventScript_StrengthBoulder"),
  };
  return {
    id,
    kind,
    x,
    y,
    elevation: ELEVATION_LEVELS[map.layers.elevation.data[y * map.width + x]],
    fields: { ...(fieldsFor[kind] ?? {}) },
    locked: true,
  };
}

const TURN_ORDER: Direction[] = ["n", "e", "s", "w"];

/** Which way a trainer faces, or "all" for one that looks around. */
export function facingOf(e: Entity): Direction | "all" {
  const m = String(e.fields.movement_type ?? "");
  const d = (Object.keys(FACE_MOVEMENT) as Direction[]).find((k) => FACE_MOVEMENT[k] === m);
  return d ?? "all";
}

/** Face a trainer one way ("all" = looks around in every direction). */
export function setFacing(e: Entity, dir: Direction | "all"): void {
  e.fields.movement_type = dir === "all" ? "MOVEMENT_TYPE_LOOK_AROUND" : FACE_MOVEMENT[dir];
}

/** Turn a trainer a quarter turn clockwise (one that looks around starts facing north). */
export function turnClockwise(e: Entity): void {
  const now = facingOf(e);
  setFacing(e, now === "all" ? "n" : TURN_ORDER[(TURN_ORDER.indexOf(now) + 1) % 4]);
}

export function sightOf(e: Entity): number {
  const n = Number(e.fields.trainer_sight_or_berry_tree_id ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function setSight(e: Entity, range: number): void {
  e.fields.trainer_sight_or_berry_tree_id = String(Math.max(1, Math.min(MAX_SIGHT, Math.round(range))));
}

/** A copy of a thing (its fields are plain text, numbers and true/false). */
export function cloneThing(e: Entity): Entity {
  return { ...e, fields: { ...e.fields } };
}
