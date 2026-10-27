// Gen 3 (pokeemerald) facts used by the tool.
//
// Every value has a comment saying where to check it in pret/pokeemerald
// (https://github.com/pret/pokeemerald). Values were checked against the
// master branch on 2026-10-26. If your hack changes an engine limit, change it
// in the project's "engine limits" settings rather than here: these are only
// the vanilla defaults.

/** The GBA screen is 240×160 px; one metatile is 16×16 px, so 15×10 metatiles.
 *  Verify: include/gba/defines.h (DISPLAY_WIDTH 240, DISPLAY_HEIGHT 160). */
export const SCREEN_WIDTH_METATILES = 15;
export const SCREEN_HEIGHT_METATILES = 10;

/** Pixel size of one metatile. Verify: include/fieldmap.h (NUM_TILES_PER_METATILE 8 = two layers of 2×2 8px tiles). */
export const METATILE_PIXELS = 16;

/** Where the player stands on screen, in metatiles from the top-left of the 15×10 view.
 *  7 columns to the left and right. Vertically the camera keeps 4 rows above and 5 below.
 *  Approximate: check in-game, see src/field_camera.c. Only used to draw the screen frame. */
export const PLAYER_SCREEN_X = 7;
export const PLAYER_SCREEN_Y = 4;

/** Map size rule. Each map is loaded into a RAM buffer with a border margin.
 *  A map is valid when (width + MAP_OFFSET_W) * (height + MAP_OFFSET_H) <= MAX_MAP_DATA_SIZE.
 *  Verify: include/fieldmap.h (MAX_MAP_DATA_SIZE 10240, MAP_OFFSET 7,
 *  MAP_OFFSET_W = MAP_OFFSET*2+1 = 15, MAP_OFFSET_H = MAP_OFFSET*2 = 14). */
export const MAX_MAP_DATA_SIZE = 10240;
export const MAP_OFFSET = 7;
export const MAP_OFFSET_W = MAP_OFFSET * 2 + 1;
export const MAP_OFFSET_H = MAP_OFFSET * 2;

/** Object event templates allowed per map (everything in "object_events").
 *  Verify: include/constants/global.h (OBJECT_EVENT_TEMPLATES_COUNT 64). */
export const OBJECT_EVENT_TEMPLATES_COUNT = 64;

/** Object events that can be active at once (roughly, on screen).
 *  Verify: include/constants/global.h (OBJECT_EVENTS_COUNT 16). */
export const OBJECT_EVENTS_COUNT = 16;

/** The border block repeats outside the map edges. Emerald's border is always 2×2
 *  metatiles (8 bytes in each data/layouts/<Map>/border.bin; no border_width field
 *  in data/layouts/layouts.json, unlike pokefirered). */
export const BORDER_WIDTH = 2;
export const BORDER_HEIGHT = 2;

/** Metatile budget. Verify: include/fieldmap.h (NUM_METATILES_IN_PRIMARY 512, NUM_METATILES_TOTAL 1024). */
export const NUM_METATILES_IN_PRIMARY = 512;
export const NUM_METATILES_TOTAL = 1024;

/** Wild encounter slot counts. Verify: src/data/wild_encounters.json, the "fields"
 *  block: land_mons has 12 encounter_rates, water_mons 5, rock_smash_mons 5,
 *  fishing_mons 10 split into groups old_rod [0,1], good_rod [2,3,4], super_rod [5..9]. */
export const ENCOUNTER_SLOTS = {
  land: 12,
  surf: 5,
  rockSmash: 5,
  fishing: 10,
} as const;
export const FISHING_ROD_SLOTS = { oldRod: 2, goodRod: 3, superRod: 5 } as const;

/** Real elevation values, for reference. The abstract levels (water, ground, raised1…)
 *  are mapped to numbers in the tileset profile, not here.
 *  Verify: include/global.fieldmap.h (ELEVATION_TRANSITION 0, ELEVATION_SURF 1,
 *  ELEVATION_DEFAULT 3, ELEVATION_MULTI_LEVEL 15). Object events in vanilla maps
 *  usually use elevation 3 (e.g. data/maps/Route101/map.json). */
export const ELEVATION = {
  transition: 0,
  surf: 1,
  default: 3,
  multiLevel: 15,
} as const;

/** Ledges. Metatile behaviours MB_JUMP_EAST/WEST/NORTH/SOUTH exist in
 *  include/constants/metatile_behaviors.h, but vanilla tilesets have no
 *  north-facing ledge, so the terrain vocabulary has no ledge_n. */
export const LEDGE_DIRECTIONS = ["s", "e", "w"] as const;

/** HMs in vanilla Emerald (no Gen 4+ field moves). */
export const HMS = ["cut", "flash", "rock_smash", "strength", "surf", "dive", "waterfall"] as const;
export type Hm = (typeof HMS)[number];

/** In-game region map. Locations (MAPSECs) are placed on a grid of 28×15 squares.
 *  Verify: src/region_map.c (MAP_WIDTH 28, MAP_HEIGHT 15). The map image is built
 *  from 8×8 px tiles. Porymap's Region Map Editor needs a tilemap width of 16, 32, 64 or 128 tiles. */
export const REGION_MAP_GRID_WIDTH = 28;
export const REGION_MAP_GRID_HEIGHT = 15;
export const REGION_MAP_TILE_PIXELS = 8;
export const REGION_MAP_TILEMAP_WIDTHS = [16, 32, 64, 128] as const;

/** Map names are at most 16 characters. Verify: include/region_map.h (MAP_NAME_LENGTH 16). */
export const MAP_NAME_LENGTH = 16;
