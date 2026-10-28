# File formats

This document defines the tool's file formats. The terrain vocabulary and the tileset profile format are also the **contract with the planned tileset/sprite generator**. Every format carries a version number, and any change to a format bumps it.

| File | Identifier (`format`) | Version field | Current |
| --- | --- | --- | --- |
| Project file (`*.json`) | `gen3-map-blueprint-project` | `schemaVersion` | 11 |
| Terrain vocabulary (`profiles/terrain.json`) | `gen3-terrain-vocabulary` | `formatVersion` | 1 |
| Terrain palette (`profiles/palettes/*.json`) | `gen3-terrain-palette` | `formatVersion` | 1 |
| Tileset profile (`profiles/tilesets/*.json`) | `gen3-tileset-profile` | `formatVersion` | 1 (draft) |

Coordinates are in **metatiles** (16×16 px). The origin (0, 0) is the top-left cell. x grows east (right) and y grows south (down).

---

## Project file, schemaVersion 11

A project is a single JSON file holding one region and all of its maps. The app treats it as untrusted data when opening it:

- Each field is checked for type, range and length.
- Unknown fields are rejected.
- Files over 30 MB are rejected.
- Text is only ever shown as plain text.

When the format changes, `schemaVersion` goes up and a migration in `src/core/project.ts` upgrades older files when they're opened.

| Version | Milestone | Change |
| --- | --- | --- |
| 1 | 1 | First version. |
| 2 | 2 | Each map gains `openings` (edge entrances). Version-1 files are upgraded with `openings: []`. |
| 3 | 2 (revision) | Each opening gains `kind`: `walk` or `surf`. Version-2 openings become `walk`. |
| 4 | 2 (second revision) | New terrain types `snow`, `snow_grass`, `ice`, `snowdrift`; elevation levels `raised3`, `raised4`; elevation-brush edits (`"type": "elevation"`). Version-3 files need no changes. |
| 5 | 3 (part A) | Entities may have `"locked": true` (placed or moved by hand; Generate keeps them). New edit types `lock`, `area` and `entity`. Version-4 files need no changes. |
| 6 | 3 (part B) | New edit type `smart` (smart strokes). Version-5 files need no changes. |
| 7 | 4 (part B) | Entities may have `"accepted"` (warnings marked OK). Entity edits may have `"kind": "warp"`. New kinds placed by hand (berry tree, trigger, secret base, heal location, warp). Version-6 files need no changes. |
| 8 | 4 (part C) | The region gains `speciesPool` (added empty to older files); a map's `encounterPlan` may hold draft tables. |
| 9 | 5 (part A) | Warps may have `"locked"` (placed by hand; all warps in older files get `true`). Towns generate door warps (not locked). New smart-stroke kind `building`. |
| 10 | 6 (part A) | Openings may have `role`: `start` or `finish`, replacing the route setting `travel` (moved onto the entrances when opened). `targetSegmentLength` 80 becomes 90. |
| 11 | 6 (part B) | The region's `sketch` may be filled in (see Region sketch below). Version-10 files need no changes. |

```jsonc
{
  "format": "gen3-map-blueprint-project",
  "schemaVersion": 6,
  "appVersion": "0.1.0",
  "savedAt": "2026-10-26T20:00:00.000Z",
  "region": {
    "name": "Cascadia",
    "seed": 42,                       // 0 … 4294967295
    "sketch": null,                   // the region sketch, or null before one is started (from version 11; see Region sketch below)
    "speciesPool": [ … ],             // the species list for encounter drafts (from version 8; see below)
    "settings": {
      "defaultBiome": "temperate_rainforest",
      "levelCurve": { "start": 3, "end": 60 },
      "targetSegmentLength": 90,
      "engineLimits": {               // vanilla Emerald values; raise them if your hack does
        "maxMapDataSize": 10240,      // include/fieldmap.h MAX_MAP_DATA_SIZE
        "mapOffsetW": 15,             // include/fieldmap.h MAP_OFFSET_W
        "mapOffsetH": 14,             // include/fieldmap.h MAP_OFFSET_H
        "objectEventTemplates": 64    // include/constants/global.h OBJECT_EVENT_TEMPLATES_COUNT
      }
    },
    "progression": [ { "id": "step1", "name": "After badge 1", "badges": 1, "hms": ["cut"] } ],
    "routes": [ {
      "id": "route3", "name": "Route 3", "segmentMapIds": ["map_2", "map_3"],
      "primaryTileset": "", "secondaryTileset": "", "regionMapSection": "MAPSEC_ROUTE_3",
      "progressionStep": null, "biome": "coastal"
    } ],
    "nextId": 4,                      // counter for new internal ids, so ids are deterministic
    "maps": [ /* MapBlueprint, below */ ]
  }
}
```

The region's connection graph isn't stored separately. It's derived from each map's `connections`, so there is only one source of truth.

### Region sketch (from version 11)

The sketch is a rough plan of the whole region. Everything is in metatiles; rectangles and pins snap to a grid of 5×5 metatiles.

```jsonc
"sketch": {
  "width": 600, "height": 400,           // metatiles, multiples of 5 (up to 4000)
  "areas": { "legend": ["none", "lake"], "rows": [[0, 0, 1, …], …] },   // one value per 5×5 square, like a map layer
  "places": [
    { "id": "p1", "kind": "route", "name": "Route 1",
      "rects": [ { "x": 100, "y": 0, "w": 30, "h": 150 }, { "x": 130, "y": 120, "w": 90, "h": 30 } ],
      "pins": [], "size": null, "ownSection": false, "mapIds": [] },
    { "id": "p2", "kind": "cave", "name": "Moss Cave",
      "rects": [], "pins": [ { "x": 112, "y": 40 } ], "size": { "w": 40, "h": 40 }, "ownSection": false, "mapIds": [] }
  ],
  "rivers": [ { "id": "r3", "points": [0, 50, 80, 60, 140, 200], "width": 3 } ],
  "underlay": null,
  "nextId": 4
}
```

- **`areas`** legend names: `none`, the six biomes, `lake`, `sea`. The coastline is the edge of the sea.
- **`places`**:
  - `kind` is `town`, `route`, `forest` or `cave`.
  - A town has one rectangle. A route has a chain of them, one per straight stretch, each touching the one before edge to edge.
  - A stretch longer than the region's `targetSegmentLength` becomes several maps (segments), split into near-equal lengths of whole 5-metatile squares. A town is always one map.
  - Forests and caves have no rectangles. Their `pins` are entrances on routes or towns (the route or town under the first pin is the one they belong to), `size` is their map's size, and `ownSection` says whether they get their own region map section.
  - `mapIds` lists the maps built from the place (empty until the region is built).
- **`rivers`**: lines through `points` (x0, y0, x1, y1, …), `width` metatiles across (1–50).
- **`underlay`**: a drawing to trace over, or null:

```jsonc
"underlay": {
  "kind": "pdf",                          // "pdf" or "image"
  "name": "region plan.pdf",
  "data": "data:application/pdf;base64,…",  // the file itself (PDF, PNG, JPEG, WebP or GIF), up to 20 MB of text
  "page": 1,                              // which PDF page
  "x": 0, "y": 0,                         // where its top-left corner sits (metatiles)
  "scale": 0.8,                           // metatiles per image pixel, or per PDF point (1/72 inch)
  "rotation": 0,                          // degrees clockwise, about its top-left corner
  "opacity": 0.5, "visible": true, "locked": false
}
```

### MapBlueprint

```jsonc
{
  "id": "map_1",                      // internal id, unique in the project (not the MAP_* constant)
  "name": "Route 1",
  "mapType": "route",                 // route | town | forest | cave | interior_stub
  "width": 40, "height": 20,
  "seed": 7,
  "biome": "temperate_rainforest",    // temperate_rainforest | coastal | wetland | alpine | meadow | urban_edge
  "params": { "winding": 0.5, "trainers": 3, "availableHms": "cut,surf" },  // generator settings (see below)
  "layers": {
    "terrain":   { "legend": ["ground", "tree"], "rows": [[1,1,0, …], …] },
    "elevation": { "legend": ["ground"], "rows": [[0,0,0, …], …] },
    "locks":     { "legend": ["free", "locked"], "rows": [[0,1,0, …], …] },
    "zones": [ {
      "id": "z1", "name": "Grass pocket A", "kind": "biome",
      "hard": false, "fuzziness": 0.5,
      "mask": { "legend": ["out", "in"], "rows": [[0,1, …], …] },
      "data": { "biome": "wetland" }
    } ]
  },
  "entities": [ { "id": "e1", "kind": "sign", "x": 3, "y": 4, "elevation": "ground",
                  "fields": { "script": "Route1_EventScript_Sign" } } ],
  "warps": [ { "id": "w0", "kind": "cave_mouth", "x": 10, "y": 2, "elevation": "ground",
               "destMap": "map_5", "destWarpId": 0 } ],
  "openings": [ { "id": "o1", "edge": "north", "start": 8, "width": 3, "kind": "walk", "role": "start" } ],   // edge entrances; "role" (from version 10) is optional: "start" or "finish"
  "connections": [ { "direction": "up", "map": "map_2", "offset": 0 } ],
  "header": { /* map.json header, below */ },
  "layout": { "borderBlock": ["tree", "tree", "tree", "tree"], "primaryTileset": "", "secondaryTileset": "" },
  "encounterPlan": null,              // draft wild encounters, or null before the first draft (from version 8; see below)
  "edits": [ /* Edit, below */ ],
  "routeId": null,
  "progressionStep": null
}
```

#### Grid layers: legend + numbers

Every grid layer (`terrain`, `elevation`, `locks`, and each zone's `mask`) is saved as:

- `legend`: the names actually used in this layer, in order of first appearance.
- `rows`: exactly `height` rows of exactly `width` numbers. Each number is an index into `legend`.

Names, not internal numbers, are what get saved. That means terrain types can be added to or reordered in `profiles/terrain.json` without breaking existing files. Opening a file that uses a terrain name the vocabulary doesn't define is an error.

| Layer | Legend names |
| --- | --- |
| `terrain` | terrain type ids from `profiles/terrain.json` |
| `elevation` | `water`, `ground`, `raised1`, `raised2`, `bridge` |
| `locks` | `free`, `locked` (locked = painted or pinned by the user; generators never change it) |
| zone `mask` | `out`, `in` |

#### Header

The field names match pokeemerald's `data/maps/<Map>/map.json` exactly (checked against `Route101/map.json` and `GraniteCave_1F/map.json`):

`id`, `name`, `music`, `region_map_section`, `weather`, `map_type`, `requires_flash`, `allow_cycling`, `allow_escaping`, `allow_running`, `show_map_name`, `battle_scene`, plus `floor_number` (number or null).

Vanilla Emerald's map.json has **no** `floor_number`. That field comes from pokefirered and Porymap, so it defaults to `null`.

#### Entities

`kind` is one of the following:

- `trainer`, `npc`, `item_ball`
- `cut_tree`, `smash_rock`, `strength_boulder`, `berry_tree`
- `trigger`, `sign`, `hidden_item`, `secret_base`, `heal_location`

`fields` holds the suggested Porymap values (for example `graphics_id`, `movement_type`, `script`, `flag`, `trainer_type`, `trainer_sight_or_berry_tree_id`, `var`, `var_value`, `player_facing_dir`, `item`). Field names are filled in by Milestone 4.

Warps may also have `locked` (from version 9): `true` for a warp placed by hand, which Generate keeps; warps Generate made (town doors) leave it out and are made again each time.

`locked` (optional, from version 5) is `true` for a thing placed, moved or turned by hand. Generate keeps locked things where they are and gives generated things IDs that don't clash with them. Left out = `false`.

`accepted` (optional, from version 7) lists check warnings the user marked OK for this thing, by code. Only `"unavoidable-trainer"` is used so far. Left out = none.

Field names follow pokeemerald's `map.json` (checked against Route104, Route111 and Route119). Fields per kind placed by hand:

| Kind | Fields |
| --- | --- |
| `trainer`, `npc` | `graphics_id`, `movement_type`, `movement_range_x`, `movement_range_y`, `trainer_type`, `trainer_sight_or_berry_tree_id`, `script`, `flag` |
| `berry_tree` | as above, with `MOVEMENT_TYPE_BERRY_TREE_GROWTH`, `script` `BerryTreeScript`, and the `BERRY_TREE_*` id in `trainer_sight_or_berry_tree_id` |
| `item_ball` | `graphics_id`, `movement_type`, `script`, `flag`, plus `item` and `tier` (planning notes) |
| `hidden_item` | `item`, `flag`, `tier` |
| `sign` | `player_facing_dir`, `script`, `text` (suggested sign text, a planning note) |
| `trigger` | `type` (`trigger` or `weather`), `var`, `var_value`, `script` (trigger) or `weather` (`COORD_EVENT_WEATHER_*`) |
| `secret_base` | `secret_base_id` |
| `heal_location` | `id` (`HEAL_LOCATION_*`), `map`, `note`: these go in `src/data/heal_locations.json`, not `map.json` |
| `cut_tree`, `smash_rock`, `strength_boulder` | `graphics_id`, `movement_type`, `script`, `flag` |

Warps are kept separately in `warps`, as they are in Porymap.

#### Openings

An opening is a gap in the map edge where the player walks onto a neighbouring map.

- `edge` is `north`, `south`, `east` or `west`.
- `start` is the first cell along that edge: x for north and south, y for east and west.
- `width` is how many cells wide the gap is.
- `kind` is `walk` (on land) or `surf` (on water). Surf entrances are only checked once the player has Surf.

An empty list means "let the generator choose". The first Generate then picks one opening at each short end of the map and saves them here.

#### Generator settings (`params`, routes)

Every value is optional. Missing or out-of-range values fall back to the default, or are clamped to the allowed range.

| Key | Default | Range / values |
| --- | --- | --- |
| `layout` | `auto` | `auto` (coastal for the coastal biome, else land), `land`, `coastal`, `river`, `water` |
| `travel` | `auto` | Before version 10 only: `auto`, `south_north`, `north_south`, `west_east`, `east_west`. Opening a version 9 file moves it onto the entrances as `role` (`start` / `finish`); a map whose entrances are still automatic keeps it until its next Generate, which marks the entrances and removes it |
| `elevation` | 0.35 | 0–1 (how much hillside, and how many levels: up to 3, or 4 on alpine routes; alpine routes use 0.3 + 0.7 × the value, so they are always hilly) |
| `snow` | 0 | 0–1 (share of the route under snow, highest ground first) |
| `grassShortcut` | true | true / false (the "two ways through" grass route) |
| `pathGrass` | 0.5 | 0–1 (grass stretches across the main path) |
| `surfEntrances` | true | true / false (coastal and river: surf entrances on the water) |
| `pathWidthMin`, `pathWidthMax` | 2, 3 | 1–4, 1–5 cells |
| `winding` | 0.5 | 0–1 |
| `branches` | 2 | 0–6 |
| `branchLength` | 0.5 | 0–1 |
| `deadEndRewards` | true | true / false |
| `ledges` | 1 | 0–4 (ledge rows across the route; the generator adds up to 2 more on hilly routes) |
| `grass`, `water`, `treeDensity` | 0.65, 0.25, 0.55 | 0–1 |
| `borderThickness` | 2 | 1–4 |
| `borderStyle` | `auto` | `auto` (cliff on alpine routes, forest otherwise), `forest`, `cliff` |
| `stream` | `auto` | `auto`, `yes`, `no` |
| `clearing` | true | true / false |
| `hmPockets` | 1 | 0–3 |
| `hmPocketTypes` | `cut,rock_smash,surf` | comma list |
| `availableHms` | (empty) | comma list of `cut, flash, rock_smash, strength, surf, dive, waterfall` |
| `trainers`, `trainerSpacing` | 3, 8 | 0–10, 3–20 |
| `items` (extra), `hiddenItems` | 2, 2 | 0–10 |
| `levelMin`, `levelMax` | 3, 6 | 1–100 (wild Pokémon levels for the encounter draft) |

Towns (Milestone 5) also read these keys, and share `treeDensity`, `borderThickness`, `borderStyle` and `hiddenItems` with routes:

| Key | Default | Range / values |
| --- | --- | --- |
| `townLayout` | `grid` | `grid`, `organic`, `waterfront` |
| `center`, `mart`, `gym`, `landmark` | true, true, false, false | true / false |
| `houses`, `largeHouses` | 3, 1 | 0–12, 0–6 (how many of the houses are 5×4) |
| `people` | 3 | 0–10 |
| `edgeGrass` | 0.3 | 0–1 (optional grass patches near the border) |

Forests (Milestone 5) read these keys, and share `pathWidthMin` (path width), `grass`, `borderThickness`, `trainers`, `items` (dead-end item balls = this + 2), `hiddenItems` and the levels with routes:

| Key | Default | Range / values |
| --- | --- | --- |
| `mazeDensity` | 0.6 | 0–1 (0 = open with loops, 1 = one long winding way) |
| `clearings` | 3 | 0–8 |
| `guaranteedHidden` | 2 | 0–8 |

Caves (Milestone 5) read these keys, and share `borderThickness`, `trainers`, `items` (far-end item balls = this + 2), `hiddenItems` and the levels with routes. Dark is the header's `requires_flash`.

| Key | Default | Range / values |
| --- | --- | --- |
| `exits` | 2 | 1–4 (cave mouths; locked cave-mouth warps count toward it) |
| `openness` | 0.5 | 0–1 |
| `platforms` | 1 | 0–4 |
| `waterLevel` | 0.2 | 0–1 |
| `rockSmash` | 1 | 0–4 |
| `boulders` | 0 | 0–3 (Strength boulders guarding side areas) |
| `floors` | 1 | 1–4 (first floor only; Generate makes the other floor maps) |
| `ladders` | 1 | 1–3 (first floor only; ladders between each floor and the next) |
| `caveGroup`, `floor` | (none), 0 | on floors B1F…: the first floor's map id, and the floor number (1 = B1F) |
| `laddersUp`, `laddersDown` | 0, 0 | set by Generate on each floor: its generated ladders list the ladders up first, then down |
| `retries` | 8 | 0–20 |
| `generatorVersion` | (set by the app) | which generator produced the map |
| `seedPinned` | absent | `true` when the seed is pinned in the app (New seed and Variations leave it alone); not used by the generator |

The same map, settings and seed always produce exactly the same result. If the generators change in a way that alters results, `GENERATOR_VERSION` in `src/core/generate.ts` is bumped.

#### Elevation

The `elevation` layer stores one level per cell: `water`, `ground`, `raised1`, `raised2`, `raised3`, `raised4` or `bridge`. The Porymap number for each is in `profiles/tilesets/vanilla-emerald-general.json` (water 1, ground 3, raised 4–7, bridge 15; stairs show 0, "transition"). For movement:

- `water`, `ground` and `bridge` are one low level. `raised1` to `raised4` are plateaus, each one above the last.
- The player can only change level by stepping onto or off **stairs**, one level at a time.
- The player can also drop down a level by jumping a **ledge**.

Generated plateaus are ringed by `rock_wall` (the cliff face). Parts of the rim are `stairs`, and some stretches are `ledge_s`, `ledge_e` or `ledge_w`.

#### Zones (the user's plan)

Each zone is a mask of cells (`"mask"`, legend `["out", "in"]`) with a `kind`, `hard` (followed exactly) or soft with `fuzziness` 0–1 (the edge moves in or out by up to 4 × fuzziness cells, and a thin zone moves inward by at most half its thickness), and kind-specific `data`:

| `kind` | `data` | What the generator does |
| --- | --- | --- |
| `biome` | `biome`: a biome id | That area uses the biome's trees, grass and detail (elevation still follows the map's biome) |
| `water` | `water`: `lake` \| `pond` \| `river` \| `ocean` \| `marsh`; `depth`: `deep` \| `shallow` | Water laid before the path is planned; rivers are crossed on bridges; oceans get a beach; marsh becomes shallow pools, long grass and mud |
| `edge` | `boundary`: `coast` \| `riverbank` \| `cliff` \| `forest` \| `open` | Sea + beach, river water + bank, rock wall, dense forest, or plain walkable ground |
| `keep_clear` | (none) | Walkable ground: no trees or water |

Later zones win where zones overlap. Locked cells always win over zones. Unknown kinds or values are ignored.

#### Zones written by the generator

Each HM-gated area becomes a zone with these values:

- `kind` is `"hm_gate"` and `hard` is `true`.
- `data.hm` names the HM that seals it.
- `data.generated` is `true`.

Bridges Generate laid over water the user locked (from Milestone 5) are remembered in a zone with `id` `"generated_bridges"`, `kind` `"bridge"`, `hard` `true` and `data.generated` `true`. The next Generate turns those cells back into deep water before planning, so the bridges can move.

The next Generate replaces zones with `data.generated: true`. Any other zone is kept.

#### Edits

Edits are user actions, recorded in order. Strokes (`stroke`, `elevation`, `lock`) can be replayed cell by cell. Selection and Things-tool edits (`area`, `entity`) are a record of what was done; their result is in the map's layers and entities.

```jsonc
{ "type": "stroke", "tool": "pencil", "terrain": "tree", "brush": 1, "locked": true,
  "cells": [x0, y0, x1, y1, …] }     // every cell the stroke painted, in order
{ "type": "elevation", "level": "raised2", "brush": 2, "locked": true,
  "cells": [x0, y0, …] }             // sets the elevation level only; terrain is unchanged
{ "type": "lock", "locked": false, "brush": 1,
  "cells": [x0, y0, …] }             // lock brush: locks or unlocks; terrain and elevation unchanged
{ "type": "area", "action": "move", "area": { "x": 2, "y": 10, "w": 5, "h": 4 },
  "toX": 9, "toY": 20 }              // action: move | paste (area = where it was copied from) | delete | regenerate
                                     //   | fill | elevation | lock | unlock
{ "type": "area", "action": "fill", "area": { "x": 0, "y": 0, "w": 2, "h": 2 },
  "cells": [0, 0, 1, 1], "toX": null, "toY": null, "value": "tree" }
{ "type": "entity", "action": "turn", "id": "T4", "kind": "trainer",
  "x": 5, "y": 15 }                  // action: place | move | turn | sight | delete; x, y = where it ends up
                                     //   kind is a thing kind, or "warp" (from version 7)
```

A smart stroke records what was drawn; replaying it (`applySmartStroke` in `src/core/strokes.ts`) on the same map gives the same cells:

```jsonc
{ "type": "smart", "kind": "stream", "width": 2, "direction": null,
  "points": [x0, y0, x1, y1, …] }   // kind: path | stream | tree_wall | grass | water | ledge | building (from version 9)
```

`points` are the cells the pointer passed through, in order; `grass` and `water` treat them as an outline to fill. `width` is the line width in cells (1 for outlines and ledges). `direction` is `s`, `e` or `w` for a ledge whose jump direction was chosen, else `null`.

`cells` (optional) lists the exact cells of a lasso shape, as `[x0, y0, x1, y1, …]`; without it the whole rectangle `area` was used. `value` (optional) is the terrain id for `fill` or the elevation level for `elevation`. `toX`/`toY` are `null` except for move and paste. A move or delete leaves plain, unlocked ground behind; when the app fills that gap with generated terrain, a `regenerate` edit for the same area follows.

Replaying the strokes in order on a fresh map gives exactly the same cells.

---

## Terrain vocabulary, formatVersion 1 (`profiles/terrain.json`)

```jsonc
{ "format": "gen3-terrain-vocabulary", "formatVersion": 1, "types": [
  { "id": "ledge_s", "label": "Ledge south", "category": "ledge",
    "passability": "one_way", "direction": "s", "encounters": null,
    "elevation": "ground", "glyph": "↓", "note": "One-way: jump down (south) only" }
] }
```

| Field | Meaning |
| --- | --- |
| `id` | Lowercase letters, digits and `_`. Never rename an id: saved files refer to it. |
| `passability` | `walk`, `blocked`, `one_way` (needs `direction`), `surf`, `hm` (needs `hm`), `warp` |
| `direction` | `n`, `s`, `e`, `w`, used for ledges and currents. There is no north ledge in vanilla. |
| `hm` | `surf`, `waterfall`, `dive`, … |
| `encounters` | `land`, `water`, `cave` or `null` |
| `elevation` | the usual abstract level for this terrain |
| `glyph` | optional symbol drawn over the color |
| `slide` | optional `true` for ice: the player slides across it until something stops them |

To add a terrain type, add an entry here and a color for it in **every** palette. The app checks this when it loads.

## Terrain palette, formatVersion 1 (`profiles/palettes/*.json`)

`{ "format": "gen3-terrain-palette", "formatVersion": 1, "id", "name", "description", "colors": { "<terrain id>": "#rrggbb" } }`

There are two palettes:

- `pnw`: muted Pacific Northwest colors (the default).
- `high-contrast`: for readability.

---

## Tileset profile, formatVersion 1 (draft, `profiles/tilesets/*.json`)

A tileset profile says how each abstract terrain type becomes real metatiles in a tileset. The app ships the format and two stubs (`vanilla-emerald-general.json`, `pnw-custom.json`). The app doesn't use profiles until Milestone 7.

```jsonc
{
  "format": "gen3-tileset-profile",
  "formatVersion": 1,
  "name": "Vanilla Emerald – General",
  "tilesets": { "primary": "gTileset_General", "secondary": "gTileset_Petalburg" },
  "supportedTypes": ["ground", "tall_grass", "tree"],   // the editor warns about types not listed
  "elevation": { "water": 1, "ground": 3, "raised1": 4, "raised2": 5, "bridge": 15 },
  "terrain": {
    "tall_grass": { "metatile": "0x00D", "collision": 0 },   // simple: one metatile
    "tree": {                                                  // autotiled
      "collision": 1,
      "autotile": {
        "neighbors": 8,                 // 4 or 8
        "sameAs": ["tree", "dense_forest"],
        "rules": [
          { "mask": 255, "care": 255, "metatile": "0x1A0" },  // surrounded: centre piece
          { "mask": 124, "care": 125, "metatile": "0x198" }   // top edge (N open)
        ],
        "fallbackMetatile": "0x1A0"
      }
    }
  }
}
```

Metatile ids are hexadecimal strings (`"0x1A0"`) or numbers. `null` means not filled in yet (TODO).

### Autotile rules

For each cell, the app builds a **neighbor mask**: one bit per neighbor, set when that neighbor's terrain is in `sameAs`. Cells outside the map count as the same terrain.

| Bit | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Value | 1 | 2 | 4 | 8 | 16 | 32 | 64 | 128 |
| 8-neighbor | N | NE | E | SE | S | SW | W | NW |
| 4-neighbor | N | E | S | W | – | – | – | – |

A rule matches when `(neighborMask & care) == (mask & care)`. `care` marks which bits matter: leave a bit out of `care` to mean "don't care". The **first** rule that matches wins. If no rule matches, `fallbackMetatile` is used.

This is how water edges, tree walls, path borders and cliffs get their correct edge and corner pieces. The planned tileset generator reads the vocabulary and these masks, draws matching metatiles, and writes the `rules` back.

## Raw grid, version 1 (`grid.json` in the rebuild packet)

The terrain, elevation and things of one map as plain data, for scripts (the planned Porymap paint script and tileset tool). Made by `rawGrid` in `src/core/exporters/rebuild.ts`.

```json
{ "format": "gen3-map-blueprint-grid", "version": 1,
  "map": "MAP_ROUTE7", "width": 30, "height": 60,
  "terrain":   { "legend": ["path", "road", …], "rows": [[3, 3, 0, …], …] },   // ids from profiles/terrain.json
  "elevation": { "legend": ["water", "ground", …], "values": [1, 3, …], "rows": [[1, 1, …], …] },
              // values: Porymap's elevation number for each legend entry (stairs cells use 0, "transition")
  "entities": [ { "id": "T1", "kind": "trainer", "x": 5, "y": 9, "elevation": "ground", "fields": { … } } ],
  "warps":    [ { "number": 0, "kind": "door", "x": 4, "y": 2, "elevation": "ground", "dest_map": "MAP_…", "dest_warp_id": 0 } ] }
```

The rebuild packet's `map.json` follows pokeemerald's `data/maps/*/map.json` exactly (key order and event fields checked against Route101, Route104, Route119 and LittlerootTown_BrendansHouse_1F); `connections` is `null` when there are none.

### Wild encounters (from version 8)

`speciesPool` (on the region) is the user's species list:

```json
{ "species": "SPECIES_ZIGZAGOON", "minLevel": 2, "maxLevel": 5,
  "habitats": ["land"],              // land | surf | fish | rock
  "biomes": ["meadow"],              // biome ids where it's more likely; [] = anywhere
  "rarity": "common" }               // common | uncommon | rare
```

`encounterPlan` (on each map) holds the draft tables. Each table has an `encounter_rate` and its slots in pokeemerald's order (`src/data/wild_encounters.json`): land 12 slots, surf 5, rock 5, fish 10 (Old Rod slots 0–1, Good Rod 2–4, Super Rod 5–9).

```json
{ "land": { "rate": 20, "slots": [ { "species": "SPECIES_ZIGZAGOON", "min": 3, "max": 4 }, … ] },
  "surf": { … }, "rock": { … }, "fish": { … },   // each optional: only the tables the map needs
  "locked": true }                               // optional: edited by hand, Generate keeps it
```
