// The Things tool: placing, turning and removing things on a map by hand
// (trainers, items, signs, HM obstacles…).
//
// Field values are the same suggestions the generator uses, and every one can be
// edited in the Details tab. Names are vanilla pokeemerald's:
//   • field names as in data/maps/*/map.json (checked against Route104, Route111
//     and Route119: object, warp, coord and bg events);
//   • OBJ_EVENT_GFX_* from include/constants/event_objects.h;
//   • EventScript_CutTree, EventScript_RockSmash and EventScript_StrengthBoulder
//     from data/scripts/field_move_scripts.inc; BerryTreeScript from Route104;
//   • MOVEMENT_TYPE_* from include/constants/event_object_movement.h;
//   • TRAINER_TYPE_* from include/constants/trainer_types.h;
//   • BG_EVENT_PLAYER_FACING_* from include/constants/event_bg.h;
//   • heal locations as in src/data/heal_locations.json (id, map, x, y).
//
// Warps are kept apart from the other things (map.warps, as Porymap does), but
// the Things tool places, drags and removes them the same way.

import { ENTITY_PREFIX, FACE_MOVEMENT } from "./entities";
import type { Entity, EntityKind, MapBlueprint, Warp } from "./model";
import { ELEVATION_LEVELS, TERRAIN_TYPES } from "./terrain";
import type { Direction } from "./terrain";

/** What the Things tool can place: any kind of thing, or a warp. */
export type PlaceKind = EntityKind | "warp";

/** The kinds the Things tool can place, in the order shown in the Paint tab. */
export const PLACEABLE_KINDS: readonly PlaceKind[] = [
  "trainer",
  "item_ball",
  "hidden_item",
  "npc",
  "sign",
  "cut_tree",
  "smash_rock",
  "strength_boulder",
  "berry_tree",
  "warp",
  "trigger",
  "secret_base",
  "heal_location",
];

export const THING_LABELS: Record<PlaceKind, string> = {
  trainer: "Trainer",
  item_ball: "Item",
  hidden_item: "Hidden item",
  npc: "Person",
  sign: "Sign",
  cut_tree: "Cut tree",
  smash_rock: "Rock Smash rock",
  strength_boulder: "Strength boulder",
  berry_tree: "Berry tree",
  warp: "Warp (door, cave…)",
  trigger: "Trigger (script tile)",
  secret_base: "Secret base spot",
  heal_location: "Heal location (Fly spot)",
};

/** The letter on a kind's marker: T, I… and W for warps. */
export function placePrefix(kind: PlaceKind): string {
  return kind === "warp" ? "W" : ENTITY_PREFIX[kind];
}

/** A thing on the map: an object/coord/bg event, or a warp. */
export type Thing = Entity | Warp;

export function isWarp(t: Thing): t is Warp {
  return "destMap" in t;
}

/** The thing or warp standing on a cell, if any. */
export function thingAt(map: MapBlueprint, x: number, y: number): Thing | undefined {
  return map.entities.find((e) => e.x === x && e.y === y) ?? map.warps.find((w) => w.x === x && w.y === y);
}

export function findThing(map: MapBlueprint, id: string): Thing | undefined {
  return map.entities.find((e) => e.id === id) ?? map.warps.find((w) => w.id === id);
}

export function removeThing(map: MapBlueprint, t: Thing): void {
  if (isWarp(t)) map.warps = map.warps.filter((w) => w !== t);
  else map.entities = map.entities.filter((e) => e !== t);
}

/** The label shown on the map and in the tables: T1, I2… and W0, W1… for warps (their Porymap number). */
export function thingTag(map: MapBlueprint, t: Thing): string {
  return isWarp(t) ? `W${map.warps.indexOf(t)}` : t.id;
}

export const WARP_LABELS: Record<Warp["kind"], string> = { door: "Door", cave_mouth: "Cave mouth", ladder: "Ladder", stairs: "Stairs", other: "Other" };

/** A new warp at (x, y): a door on a building, otherwise a cave mouth. Its destination is left for the user to fill in. */
export function newWarp(map: MapBlueprint, x: number, y: number): Warp {
  let n = map.warps.length + 1;
  while (map.warps.some((w) => w.id === `w${n}`)) n++;
  const onBuilding = TERRAIN_TYPES[map.layers.terrain.data[y * map.width + x]]?.id === "building";
  return { id: `w${n}`, kind: onBuilding ? "door" : "cave_mouth", x, y, elevation: ELEVATION_LEVELS[map.layers.elevation.data[y * map.width + x]], destMap: "", destWarpId: 0, locked: true };
}

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
    berry_tree: {
      ...object("OBJ_EVENT_GFX_BERRY_TREE", "MOVEMENT_TYPE_BERRY_TREE_GROWTH", "BerryTreeScript"),
      movement_range_x: 0,
      movement_range_y: 0,
      trainer_type: "TRAINER_TYPE_NONE",
      trainer_sight_or_berry_tree_id: `BERRY_TREE_${flagBase}_${n}`,
    },
    trigger: { type: "trigger", var: `VAR_${flagBase}_STATE`, var_value: "0", script: `${label}_EventScript_Trigger${n}`, weather: "" },
    secret_base: { secret_base_id: "SECRET_BASE_RED_CAVE1_1" },
    heal_location: { id: `HEAL_LOCATION_${flagBase}`, map: map.header.id, note: "Goes in src/data/heal_locations.json (id, map, x, y), not map.json" },
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
