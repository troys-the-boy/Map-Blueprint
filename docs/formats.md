# File formats

This document defines the tool's file formats. The terrain vocabulary and the tileset profile format are also the **contract with the planned tileset/sprite generator**. Every format carries a version number, and any change to a format bumps it.

| File | Identifier (`format`) | Version field | Current |
| --- | --- | --- | --- |
| Project file (`*.json`) | `gen3-map-blueprint-project` | `schemaVersion` | 4 |
| Terrain vocabulary (`profiles/terrain.json`) | `gen3-terrain-vocabulary` | `formatVersion` | 1 |
| Terrain palette (`profiles/palettes/*.json`) | `gen3-terrain-palette` | `formatVersion` | 1 |
| Tileset profile (`profiles/tilesets/*.json`) | `gen3-tileset-profile` | `formatVersion` | 1 (draft) |

Coordinates are in **metatiles** (16×16 px). The origin (0, 0) is the top-left cell. x grows east (right) and y grows south (down).

---

## Project file, schemaVersion 4

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

```jsonc
{
  "format": "gen3-map-blueprint-project",
  "schemaVersion": 4,
  "appVersion": "0.1.0",
  "savedAt": "2026-10-26T20:00:00.000Z",
  "region": {
    "name": "Cascadia",
    "seed": 42,                       // 0 … 4294967295
    "sketch": null,                   // region sketch: Milestone 6 (must be null in v1)
    "settings": {
      "defaultBiome": "temperate_rainforest",
      "levelCurve": { "start": 3, "end": 60 },
      "targetSegmentLength": 80,
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
  "openings": [ { "id": "o1", "edge": "north", "start": 8, "width": 3, "kind": "walk" } ],   // edge entrances
  "connections": [ { "direction": "up", "map": "map_2", "offset": 0 } ],
  "header": { /* map.json header, below */ },
  "layout": { "borderBlock": ["tree", "tree", "tree", "tree"], "primaryTileset": "", "secondaryTileset": "" },
  "encounterPlan": null,              // Milestone 4 (must be null in v1)
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
| `elevation` | 0.35 | 0–1 (how much hillside, and how many levels: up to 3, or 4 on alpine routes; alpine routes treat any value above 0 as 0.3 higher) |
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
| `retries` | 8 | 0–20 |
| `generatorVersion` | (set by the app) | which generator produced the map |

The same map, settings and seed always produce exactly the same result. If the generators change in a way that alters results, `GENERATOR_VERSION` in `src/core/generate.ts` is bumped.

#### Elevation

The `elevation` layer stores one level per cell: `water`, `ground`, `raised1`, `raised2`, `raised3`, `raised4` or `bridge`. The Porymap number for each is in `profiles/tilesets/vanilla-emerald-general.json` (water 1, ground 3, raised 4–7, bridge 15; stairs show 0, "transition"). For movement:

- `water`, `ground` and `bridge` are one low level. `raised1` to `raised4` are plateaus, each one above the last.
- The player can only change level by stepping onto or off **stairs**, one level at a time.
- The player can also drop down a level by jumping a **ledge**.

Generated plateaus are ringed by `rock_wall` (the cliff face). Parts of the rim are `stairs`, and some stretches are `ledge_s`, `ledge_e` or `ledge_w`.

#### Zones written by the generator

Each HM-gated area becomes a zone with these values:

- `kind` is `"hm_gate"` and `hard` is `true`.
- `data.hm` names the HM that seals it.
- `data.generated` is `true`.

The next Generate replaces zones with `data.generated: true`. Any other zone is kept.

#### Edits

Edits are user actions, recorded so they can be replayed when the map is regenerated. There are two edit types: terrain strokes (pencil and eraser) and, from version 4, elevation-brush strokes:

```jsonc
{ "type": "stroke", "tool": "pencil", "terrain": "tree", "brush": 1, "locked": true,
  "cells": [x0, y0, x1, y1, …] }     // every cell the stroke painted, in order
{ "type": "elevation", "level": "raised2", "brush": 2, "locked": true,
  "cells": [x0, y0, …] }             // sets the elevation level only; terrain is unchanged
```

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
