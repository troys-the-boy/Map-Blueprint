// Suggested values for Porymap fields, offered in the Details tab. The user
// can still type anything (a hack may add its own constants). All names are
// vanilla pokeemerald's, from:
//   • include/constants/event_object_movement.h (MOVEMENT_TYPE_*);
//   • include/constants/trainer_types.h (TRAINER_TYPE_*);
//   • include/constants/event_bg.h (BG_EVENT_PLAYER_FACING_*);
//   • include/constants/event_objects.h (OBJ_EVENT_GFX_*);
//   • include/constants/weather.h (WEATHER_*, COORD_EVENT_WEATHER_*);
//   • include/constants/map_types.h (MAP_TYPE_*, MAP_BATTLE_SCENE_*).

export const MOVEMENT_TYPES = [
  "MOVEMENT_TYPE_FACE_DOWN",
  "MOVEMENT_TYPE_FACE_UP",
  "MOVEMENT_TYPE_FACE_LEFT",
  "MOVEMENT_TYPE_FACE_RIGHT",
  "MOVEMENT_TYPE_LOOK_AROUND",
  "MOVEMENT_TYPE_WANDER_AROUND",
  "MOVEMENT_TYPE_WANDER_UP_AND_DOWN",
  "MOVEMENT_TYPE_WANDER_LEFT_AND_RIGHT",
  "MOVEMENT_TYPE_FACE_DOWN_AND_UP",
  "MOVEMENT_TYPE_FACE_LEFT_AND_RIGHT",
  "MOVEMENT_TYPE_ROTATE_CLOCKWISE",
  "MOVEMENT_TYPE_ROTATE_COUNTERCLOCKWISE",
  "MOVEMENT_TYPE_WALK_UP_AND_DOWN",
  "MOVEMENT_TYPE_WALK_LEFT_AND_RIGHT",
  "MOVEMENT_TYPE_BERRY_TREE_GROWTH",
  "MOVEMENT_TYPE_NONE",
];

export const TRAINER_TYPES = ["TRAINER_TYPE_NONE", "TRAINER_TYPE_NORMAL", "TRAINER_TYPE_SEE_ALL_DIRECTIONS", "TRAINER_TYPE_BURIED"];

export const PLAYER_FACING = ["BG_EVENT_PLAYER_FACING_ANY", "BG_EVENT_PLAYER_FACING_NORTH", "BG_EVENT_PLAYER_FACING_SOUTH", "BG_EVENT_PLAYER_FACING_EAST", "BG_EVENT_PLAYER_FACING_WEST"];

export const GRAPHICS = [
  "OBJ_EVENT_GFX_YOUNGSTER",
  "OBJ_EVENT_GFX_LASS",
  "OBJ_EVENT_GFX_BUG_CATCHER",
  "OBJ_EVENT_GFX_HIKER",
  "OBJ_EVENT_GFX_PICNICKER",
  "OBJ_EVENT_GFX_CAMPER",
  "OBJ_EVENT_GFX_TWIN",
  "OBJ_EVENT_GFX_MANIAC",
  "OBJ_EVENT_GFX_FISHERMAN",
  "OBJ_EVENT_GFX_SWIMMER_M",
  "OBJ_EVENT_GFX_SWIMMER_F",
  "OBJ_EVENT_GFX_NINJA_BOY",
  "OBJ_EVENT_GFX_BLACK_BELT",
  "OBJ_EVENT_GFX_BEAUTY",
  "OBJ_EVENT_GFX_RICH_BOY",
  "OBJ_EVENT_GFX_POKEFAN_M",
  "OBJ_EVENT_GFX_POKEFAN_F",
  "OBJ_EVENT_GFX_EXPERT_M",
  "OBJ_EVENT_GFX_PSYCHIC_M",
  "OBJ_EVENT_GFX_HEX_MANIAC",
  "OBJ_EVENT_GFX_GENTLEMAN",
  "OBJ_EVENT_GFX_SCHOOL_KID_M",
  "OBJ_EVENT_GFX_CYCLING_TRIATHLETE_M",
  "OBJ_EVENT_GFX_RUNNING_TRIATHLETE_F",
  "OBJ_EVENT_GFX_TUBER_M",
  "OBJ_EVENT_GFX_TUBER_F",
  "OBJ_EVENT_GFX_SAILOR",
  "OBJ_EVENT_GFX_COOK",
  "OBJ_EVENT_GFX_BOY_1",
  "OBJ_EVENT_GFX_GIRL_1",
  "OBJ_EVENT_GFX_MAN_1",
  "OBJ_EVENT_GFX_MAN_3",
  "OBJ_EVENT_GFX_WOMAN_1",
  "OBJ_EVENT_GFX_OLD_MAN",
  "OBJ_EVENT_GFX_OLD_WOMAN",
  "OBJ_EVENT_GFX_ITEM_BALL",
  "OBJ_EVENT_GFX_BERRY_TREE",
  "OBJ_EVENT_GFX_CUTTABLE_TREE",
  "OBJ_EVENT_GFX_BREAKABLE_ROCK",
  "OBJ_EVENT_GFX_PUSHABLE_BOULDER",
];

export const COORD_WEATHER = [
  "COORD_EVENT_WEATHER_SUNNY",
  "COORD_EVENT_WEATHER_SUNNY_CLOUDS",
  "COORD_EVENT_WEATHER_RAIN",
  "COORD_EVENT_WEATHER_RAIN_THUNDERSTORM",
  "COORD_EVENT_WEATHER_SNOW",
  "COORD_EVENT_WEATHER_FOG_HORIZONTAL",
  "COORD_EVENT_WEATHER_FOG_DIAGONAL",
  "COORD_EVENT_WEATHER_VOLCANIC_ASH",
  "COORD_EVENT_WEATHER_SANDSTORM",
  "COORD_EVENT_WEATHER_SHADE",
  "COORD_EVENT_WEATHER_DROUGHT",
  "COORD_EVENT_WEATHER_ROUTE119_CYCLE",
  "COORD_EVENT_WEATHER_ROUTE123_CYCLE",
];

export const MAP_WEATHER = [
  "WEATHER_NONE",
  "WEATHER_SUNNY",
  "WEATHER_SUNNY_CLOUDS",
  "WEATHER_RAIN",
  "WEATHER_RAIN_THUNDERSTORM",
  "WEATHER_DOWNPOUR",
  "WEATHER_SNOW",
  "WEATHER_FOG_HORIZONTAL",
  "WEATHER_FOG_DIAGONAL",
  "WEATHER_VOLCANIC_ASH",
  "WEATHER_SANDSTORM",
  "WEATHER_SHADE",
  "WEATHER_DROUGHT",
  "WEATHER_UNDERWATER",
  "WEATHER_UNDERWATER_BUBBLES",
  "WEATHER_ABNORMAL",
  "WEATHER_ROUTE119_CYCLE",
  "WEATHER_ROUTE123_CYCLE",
];

export const MAP_TYPES_PORYMAP = [
  "MAP_TYPE_ROUTE",
  "MAP_TYPE_TOWN",
  "MAP_TYPE_CITY",
  "MAP_TYPE_UNDERGROUND",
  "MAP_TYPE_INDOOR",
  "MAP_TYPE_OCEAN_ROUTE",
  "MAP_TYPE_UNDERWATER",
  "MAP_TYPE_SECRET_BASE",
  "MAP_TYPE_UNKNOWN",
  "MAP_TYPE_NONE",
];

export const BATTLE_SCENES = [
  "MAP_BATTLE_SCENE_NORMAL",
  "MAP_BATTLE_SCENE_GYM",
  "MAP_BATTLE_SCENE_MAGMA",
  "MAP_BATTLE_SCENE_AQUA",
  "MAP_BATTLE_SCENE_SIDNEY",
  "MAP_BATTLE_SCENE_PHOEBE",
  "MAP_BATTLE_SCENE_GLACIA",
  "MAP_BATTLE_SCENE_DRAKE",
  "MAP_BATTLE_SCENE_FRONTIER",
];

/** Suggestions for a thing's field, by field name. */
export const FIELD_SUGGESTIONS: Record<string, string[]> = {
  movement_type: MOVEMENT_TYPES,
  trainer_type: TRAINER_TYPES,
  player_facing_dir: PLAYER_FACING,
  graphics_id: GRAPHICS,
  weather: COORD_WEATHER,
  tier: ["common", "uncommon", "rare"],
};

/** What each field means, in plain words (shown as a tooltip and hint). */
export const FIELD_HELP: Record<string, string> = {
  graphics_id: "The sprite: which person or object the player sees.",
  movement_type: "How it stands or moves: faces one way, looks around, wanders…",
  movement_range_x: "How many cells it may wander left and right.",
  movement_range_y: "How many cells it may wander up and down.",
  trainer_type: "NORMAL for a trainer who battles when they see you; NONE for everyone else.",
  trainer_sight_or_berry_tree_id: "For a trainer: how many cells they can see. For a berry tree: its BERRY_TREE_* id.",
  script: "The script label that runs when the player talks to it or steps on it.",
  flag: "Set once it's done (an item picked up, say), so it stays gone. 0 = no flag.",
  item: "The item given (ITEM_*).",
  tier: "How good an item this spot deserves: common, uncommon or rare. A planning note, not a Porymap field.",
  player_facing_dir: "Which way the player must face to read it.",
  text: "Suggested sign text, for your script. A planning note, not a Porymap field.",
  type: "trigger runs a script; weather changes the weather when stepped on.",
  var: "The variable checked (VAR_*): the trigger runs when it equals var_value.",
  var_value: "The value of var that makes the trigger run.",
  weather: "For a weather trigger: the weather it switches to (COORD_EVENT_WEATHER_*).",
  secret_base_id: "Which Secret Base this spot opens (SECRET_BASE_*).",
  id: "The heal location's constant (HEAL_LOCATION_*).",
  map: "The map the heal location belongs to (MAP_*).",
  note: "A reminder for the rebuild.",
};
