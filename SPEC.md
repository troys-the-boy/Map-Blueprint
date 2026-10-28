# Gen 3 Map Blueprint Generator — Claude Code Prompt

Oct 26, 2026 · @Troy

## How to use this prompt

Export this doc as Markdown, save it as `SPEC.md` in an empty project folder, open Claude Code there, and say: "Read SPEC.md and build Milestone 1. Ask me before any decision the spec leaves open." Work one milestone per session.

**Context for Claude Code.** You are building a planning tool for a Pokémon fan game: a ROM hack on the **pokeemerald decompilation** (pret/pokeemerald), with maps edited in **Porymap**. The game has a Pacific Northwest setting: temperate rainforest, coastline, wetlands, alpine, and small towns. The user is a civil engineer comfortable with maps and GIS but has **no coding experience**, so setup must be one command, errors must be readable, and every milestone ends with plain-language run instructions in `README.md`. The user's machine is a **Windows PC**, and they may move to a Mac later, so everything must work on both.

## Goal and scope

Build a **procedural map blueprint generator and editor**. It produces layouts the user rebuilds by hand in Porymap. It does not write game files in v1.

**In scope (v1)**

- Generate a whole region from a rough sketch, then open and work on any single map (route, town, forest, cave) on its own.
- Generate a single map on its own, with no region.
- Four map types: routes, towns, forests, caves (multi-floor).
- An editor for drawing and changing what's generated (paths, streams, tree walls, grass, ledges, water, buildings), then regenerating around those edits.
- Placement of trainers, items, hidden items, NPCs, signs, warps and triggers, with suggested Porymap field values.
- Validation, a rebuild checklist for Porymap, and a draft in-game region map (Town Map/Fly map) layout.
- Tileset independence: the blueprint uses abstract terrain types, never metatile IDs.

**Out of scope for v1, but design for it**

- Exporting a Porymap paint script, or writing `map.bin`/`map.json` directly. Keep the exporter pluggable, with a placeholder interface.
- Mapping terrain to metatile IDs. Define the tileset profile format now; implement it later (see Tileset profiles).
- A sibling tool, planned next, that procedurally generates tilesets and sprites. This tool's terrain vocabulary is the contract between the two.
- Writing trainer parties, scripts or story logic. The tool only suggests labels and fields.

## Tech stack and architecture

A local browser app in **TypeScript + Vite + React**, drawn on **HTML canvas**. It is started with `npm run dev`, with a one-click `start.bat` for Windows (primary) and `start.command` for macOS. Propose alternatives only if they're clearly simpler for a non-coder.

- **`core/`**: pure TypeScript with no browser APIs. Holds the data model, generators, placement, validation and exporters. It must run headless from a CLI (`npm run gen -- --config x.json --seed 42`) so you can test generation without the UI.
- **`ui/`**: the React editor with a canvas renderer, tool palette, layer toggles and property panels.
- **`profiles/`**: terrain color palettes and future tileset profiles, as JSON.
- **Determinism**: one seeded RNG (for example a small PCG or mulberry32) is passed everywhere. The same seed plus the same inputs plus the same edits must always produce the same output.
- **Saving**: a project is one `.json` file (region plus maps plus edits), saved and opened through download/upload. Autosave to `localStorage` as a fallback. The File System Access API (save in place, in Chrome/Edge on Windows) is an optional enhancement only; download/upload must always work, because Safari lacks it. Keep file paths, line endings and scripts cross-platform.
- **Schema versioning**: every saved file has a `schemaVersion`, plus migration functions.
- **Tests**: Vitest. Cover RNG determinism, generators (reachability property tests over many seeds), validation rules and export round-trips.

**Standalone build.** `npm run build:standalone` must produce a **single self-contained HTML file** (for example with `vite-plugin-singlefile`), with all code, fonts and the PDF reader bundled inside. It must:

- open by double-click in any modern browser (Edge, Chrome, Firefox, Safari);
- work fully offline, on any computer, with nothing installed;
- save and open projects as files on that device.

The same build can be hosted as a static site (such as GitHub Pages) without changes. Only the developer needs Node.js.

**Devices.** Desktop/laptop browsers and **iPad (Safari)** are both first-class targets. Phones only need to view projects and exports.

**iPad requirements**

- **Opening the app:** iPadOS doesn't run a local HTML file from the Files app (it only previews it), so the iPad route is the hosted copy. Set up free static hosting (for example GitHub Pages; walk the user through creating the account) and make the app an installable **Progressive Web App**: a manifest and a service worker, so it can be added to the Home Screen and then work fully offline.
- **Saving:** Safari can clear browser storage for sites that go unused, so autosave is only a convenience. Projects are saved as files through the share/download sheet to the Files app (or iCloud Drive) and opened through a file picker. Show a clear "you have unsaved changes" warning.
- **Touch and Apple Pencil:** use Pointer Events. Pencil paints; one finger paints or pans (user setting); two-finger drag pans; pinch zooms the canvas, not the page; two-finger tap undoes. Make hit targets at least 44 px, keep tool palettes reachable in both orientations, and add an on-screen modifier toggle in place of keyboard shortcuts.
- **Performance:** rendering must stay smooth on a large map (for example 40×170) on a mid-range iPad. Redraw only the cells that changed, and run generation in a Web Worker so the UI doesn't freeze.
- **Testing:** before each milestone handoff, test in desktop Safari plus an iPad-sized viewport, and list any iPad-specific issues.

**Security requirements.** The tool must be safe to open on someone else's computer and safe for opening files from other people.

- **No network:** the app makes no network requests at runtime: no analytics, no CDN fonts, no remote calls. Enforce this with a strict Content Security Policy in the HTML file.
- **Imported files are data:** validate project files against the schema before loading and reject unknown or oversized content. Never render any imported text (map names, sign text, script labels) as HTML; render it as plain text only.
- **PDF import:** use a current, pinned pdf.js version with JavaScript evaluation disabled (`isEvalSupported: false`), and render to canvas only.
- **Dependencies:** keep them few, with exact versions pinned via the lockfile. Run `npm audit` before each milestone handoff and report the results.
- **Sandbox:** no access to the user's files except ones they explicitly pick or save. No browser extensions or native helpers.

## Data model and terrain vocabulary

One grid cell equals one Gen 3 **metatile** (16×16 px). All coordinates are in metatiles, with origin at the top left.

**Core types**

- `Region`: name, seed, sketch (coarse grid plus drawn strokes), list of `MapBlueprint`s, connection graph, progression steps.
- `MapBlueprint`: id, name, mapType (`route` | `town` | `forest` | `cave` | `interior_stub`), width, height, generator params, seed, layers, entities, connections, warps, header metadata, encounter plan.
- **Layers** (all `width × height`):
  - `terrain`: one terrain type per cell.
  - `elevation`: an abstract level (`water`, `ground`, `raised1`, `raised2`, `bridge`), mapped later to Gen 3 elevation values.
  - `locks`: cells the user painted or pinned. Generators must not change them.
  - `zones`: optional named areas, such as "grass pocket A", "HM-gated area: Cut" or "town lot 3".
- `Entity`: kind, x, y, elevation, plus kind-specific fields (see Map features).
- `Edit`: a recorded user action, such as a stroke with tool, cells and brush width, or a placed entity. Edits are replayed on regenerate.

**Route segments.** One logical route can span several connected maps, called segments (for example Route 3 north, middle and south). A `Route` groups its ordered `MapBlueprint` segments and shares across them:

- primary and secondary tileset;
- region map section;
- progression step;
- biome.

The first segment shows the map name popup; continuation segments turn `show_map_name` off. Each segment keeps its own encounter tables and object limit. The editor can show a whole route as one stitched view, with editing allowed across the seams.

**Terrain vocabulary.** These are abstract types, shared with the future tileset tool. Each has a default preview color, a passability and a behavior note.

| Terrain type | Passable | Behavior / note |
| --- | --- | --- |
| `path` | yes | Dirt or gravel route path |
| `road` | yes | Town paving |
| `ground` | yes | Plain walkable ground with no encounters |
| `tall_grass` | yes | Wild encounters (land) |
| `long_grass` | yes | Taller grass; encounters; slows the bike |
| `sand` / `mud` | yes | Cosmetic variety; sand and mud flats on the coast |
| `flowers` | yes | Decorative |
| `tree` | no | Single tree or tree wall; edges need autotiling later |
| `dense_forest` | no | Thick canopy used for map borders |
| `rock_wall` | no | Cliff and cave walls |
| `cave_floor` | yes | Cave walkable ground; encounters in caves |
| `ledge_s` / `ledge_e` / `ledge_w` | one-way | Jump direction is fixed; no `ledge_n` in vanilla |
| `water_shallow` | yes | Puddles or shallows |
| `water_deep` | surf | Surf required; water encounters and fishing |
| `water_current_{n,s,e,w}` | surf | Forced movement |
| `waterfall` | HM | Waterfall HM |
| `dive_spot` | HM | Dive HM |
| `bridge` | yes | Walkable over water or a gap; elevation `bridge` |
| `stairs` | yes | Elevation transition |
| `fence` | no | Town and farm fences |
| `building` | no | Building footprint; doors are warp entities |
| `cave_entrance` | warp | Leads to a cave map |
| `sign_tile` | no | Signpost (paired with a sign entity) |
| `void` | no | Outside the map or unused |

Make the vocabulary data-driven (`profiles/terrain.json`) so new types can be added without code changes.

## Map features to capture

Every blueprint carries the fields the user must fill in Porymap. Values are suggestions the user can edit in a properties panel. **Before you finalize field names, verify each one against a current pokeemerald `map.json` and Porymap's docs.**

**Header (`map.json`)**: name, id (`MAP_*`), music, `region_map_section`, weather, `map_type`, `requires_flash`, `allow_cycling`, `allow_escaping`, `allow_running`, `show_map_name`, `battle_scene`, `floor_number`.

**Layout**: width, height, border block (default 2×2, as a terrain type), primary/secondary tileset (left blank until a profile exists).

**Connections**: for each of north, south, east and west, the target map and an `offset`. Edge openings on both maps must line up exactly.

**Entities** (Porymap event types)

| Kind | Porymap group | Fields to suggest |
| --- | --- | --- |
| Trainer | Object | graphics\_id, x, y, elevation, movement\_type (face direction or look around), trainer\_type, sight range, script label, flag |
| NPC | Object | graphics\_id, movement\_type, movement range x/y, script label |
| Item ball | Object | item (placeholder tier), flag |
| Cut tree / Smash rock / Strength boulder | Object | graphics\_id, flag |
| Berry tree | Object | berry tree id |
| Warp (door, cave mouth, ladder, stairs) | Warp | dest\_map, dest\_warp\_id; paired warps listed both ways |
| Trigger | Coord event | var, var value, script label (story) or weather type |
| Sign | BG event | facing direction, script label, suggested sign text |
| Hidden item | BG event | item tier, flag, quantity |
| Secret base spot | BG event | optional |
| Heal location / Fly spot | (towns) | flagged for Pokémon Center towns |

**Wild encounters (`wild_encounters.json`)**: one encounter plan per map, with slot counts matching vanilla:

- land: 12 slots;
- surf: 5 slots;
- rock smash: 5 slots;
- fishing: 10 slots, split 2/3/5 across the Old, Good and Super Rods.

The tool fills species from a user-supplied pool by level band and suggests an encounter rate. It only outputs a draft; the user finalizes it.

**Gen 3 rules to respect**

- **Ledges:** one-way, with no north-facing ledge.
- **HM gates:** Cut, Rock Smash, Strength, Surf, Waterfall, Dive and Flash.
- **Elevation:** bridges need correct elevation above water.
- **Trainer sight:** a trainer's sight line stops at the first blocking cell.

## Inputs

Every input has a sensible default, so "Generate" works with zero setup. Group inputs in collapsible panels: Basic, Terrain, Gameplay, Advanced.

**Region level**

- **Sketch**: a coarse canvas, where 1 sketch cell is about one screen (15×10 metatiles). The user paints biomes (forest, coast, ocean, mountain, wetland, lake), draws rivers and coastlines as strokes, drops town nodes, and draws route lines between them. Mountains imply caves. The sketch can start from an imported PDF or image (see Sketch import under Editor features).
- **Progression order**: an ordered list of steps, each listing the badges and HMs the player has by then. Each map is assigned a step, which drives HM gating and level bands.
- **Region settings**: region name, seed, default biome palette, level curve (start and end levels).

**Map level**

- Map type, size (preset S/M/L or exact width × height), seed.
- Biome/theme: temperate rainforest, coastal, wetland, alpine, meadow, urban edge. This is the default biome; an optional zone plan can split the map into several biome areas and fix water edges before generating (see Zone plan under Editor features).
- Edge connections: which edges connect, plus where openings sit (position and width). These are filled in from the region automatically.
- Fixed warps: cave entrances, gatehouses, building doors that must exist.

**Terrain**

- Terrain mix sliders: % tall grass, water amount, tree density, path winding (0 to 1), path width (min/max).
- Border style: tree wall thickness, cliff vs forest.

**Structure**

- Linear vs branching (0 to 1), number of side branches, dead-end rewards (on/off).
- Ledge shortcuts: count, and whether they must create one-way loops back to the main path.
- Landmarks to include: pond, bridge, clearing, rest house, viewpoint, campsite, lighthouse.
- HM-gated optional areas: which HMs, and how many.

**Gameplay**

- Trainer count and spacing.
- Item count, hidden item count.
- Level band, encounter species pool (pasted list or CSV of species with min/max levels and habitat tags).

**Type-specific**

- **Town**: building list (Pokémon Center, Mart, Gym, houses, landmark), town size, layout style (grid, organic, waterfront).
- **Cave**: floor count, ladder count, dark (needs Flash), water level, boulder puzzle on/off.
- **Forest**: maze density, clearings count, guaranteed hidden items.

## Generation pipeline

Generation runs in fixed stages. Each stage reads the `locks` layer and must not overwrite locked cells.

1. **Region graph.** Turn the sketch into nodes (towns, caves) and edges (routes). Then:
   - Size each map from its sketch footprint, and split any route longer than the target segment length or over the size limit into connected segments (see Validation).
   - Assign connections and matching edge openings, so offsets line up.
   - Hand off features that cross edges, such as rivers, coastlines and mountain ranges, as boundary conditions: "river enters the south edge at x=12–14".
2. **Skeleton.** Lay out the main path (or town street network, or cave chamber graph) linking all required openings and warps, plus side branches.
3. **Terrain fill.** Fill each biome zone (from the zone plan, or the map's single biome if none) using noise and cellular automata, blending naturally at zone borders and respecting water areas, shorelines and keep-clear areas:
   - water bodies and streams following the handed-off river lines;
   - grass pockets, mostly along the main path;
   - tree and cliff mass around the walkable areas.
4. **Features.** Add ledges (one-way shortcuts), bridges where paths cross water, landmarks, HM-gated pockets (sealed by Cut trees, rocks, boulders or water), and the border.
5. **Cleanup.** Remove single-cell slivers, enforce minimum path width, and smooth tree edges to shapes a real tileset can draw (no 1-wide diagonal checkerboards).
6. **Entities.**
   - Place trainers so their sight lines cross the path at deliberate points, with spacing rules.
   - Put items at dead ends and in gated pockets, and hidden items in odd corners.
   - Add signs at entrances and junctions, NPCs in towns, and warps at doors and cave mouths.
7. **Encounter plan.** Draft the slot tables from the species pool, the level band and the terrain present (no surf table without deep water).
8. **Validation.** Run all rules (see Validation). Retry failed stages with a derived seed, up to N times, then report what still fails.

**Per-type generators** (each a separate module sharing stages 3–8)

- **Route**: path from entrance to exit using a weighted random walk or noise-biased A\*, then branches and ledge loops. Routes are mostly one screen wide (vertical) or one screen tall (horizontal).
- **Town**: street network (grid, organic, or along the waterfront). Building lots sized to typical Gen 3 footprints, door warps facing the street, fences and gardens filling leftover space.
- **Forest**: a maze carved through `dense_forest` (for example a growing-tree maze on a coarse grid, then roughened), clearings at junctions, long grass patches.
- **Cave**: chambers via cellular automata, linked by tunnels. Raised `rock_wall` platforms, ladders as warp pairs between floors, optional underground water and a Strength boulder puzzle. Each floor is its own map.

## Editor features

The editor runs a generate → edit → regenerate loop. Anything the user draws is locked by default, and the generator fills in around it.

**Two views**

- **Region view**: shows the sketch canvas and the map graph. Click any map to open it.
- **Map view**: the editor for a single map.

Breadcrumbs link the two, and adjacent maps show as faded neighbors at the edges, so connections are visible.

**Sketch import**

The region sketch can start from the user's own drawing.

- **Underlay:** load a PDF (rendered with pdf.js) or an image (PNG/JPG) under the sketch canvas, with an opacity slider and show/hide toggle.
- **Alignment:** scale and align the underlay by clicking two known points on it and the matching points on the sketch grid, like georeferencing a scanned plan.
- **Tracing:** trace towns, routes, rivers and coastlines over it with the normal sketch tools.
- **Optional color extraction:** if the sketch uses distinct colors (for example routes in red, towns as blue dots), the user picks a color per feature type and the tool pre-extracts a draft: route polylines and town points. The draft is fully editable. This is a convenience, not core: future sketches may not be color-coded, so tracing must always work on its own.

**Zone plan (before generating)**

This step is \*\*optional\*\*. Without zones, the generator uses the map's single default biome and decides everything itself; the user can also zone just part of a map (for example only a coastline) and leave the rest to the generator. The only zones that appear automatically are coastlines and rivers carried over from region mode, so neighboring maps line up; the user can edit or delete them. The user can rough out a map's layout before anything is generated, on a blank map or one created from the region sketch. Zone tools:

- **Biome brush:** paint coarse areas as a biome (rainforest, coastal, wetland, alpine, meadow, urban edge). One map can hold several biomes, for example meadow in the north and wetland in the south.
- **Water area:** paint where water must be: lake, pond, river corridor, ocean, marsh. Choose depth intent: deep (surf) or shallow.
- **Shoreline/edge tool:** mark a stretch of a map edge, or a line inside the map, as a boundary type: coast, riverbank, cliff, forest wall, or open. For example, "east edge is ocean from y=10 to y=40" or "cliff line along this curve".
- **Keep-clear area:** walkable ground, no water or trees, for a clearing, town lot or landmark.
- **Boundary softness:** each zone is a **soft constraint** by default (the generator follows its general shape but adds natural, irregular edges) or **hard** (followed exactly). The strength is set by a fuzziness slider (0 = exact, 1 = loose).

Zones live in the `zones` layer and are separate from locks. Locks are exact cells the generator must keep; zones are intent the generator follows. Zones are saved and persist across regenerations and seed changes. Edges and water from the region sketch (coastlines, rivers) are pre-filled as zones when a map is opened from region mode.

**Smart stroke tools**

The user draws a line; the tool makes it valid.

- **Path**: drawn as a polyline, widened to the minimum width, with grass cleared from it.
- **Stream/river**: banks added; a bridge auto-inserted where it crosses a path.
- **Tree wall**: thickened to the minimum and edge-smoothed.
- **Grass patch**: freehand area.
- **Ledge**: drawn as a line; direction picked from the drag direction or a toggle.
- **Water body**: freehand area, with the shoreline cleaned up.
- **Building lot**: a rectangle, with a door placed on the side facing the street.

**Basic tools**

- Single-cell pencil for any terrain type, plus fill, erase and select/move/copy region.
- Lock and unlock brush.
- **Regenerate** options: whole map, unlocked cells only, or a selected area.
- Entity tools: place, drag, delete and edit properties for every entity kind. Trainer sight cones are drawn.
- Undo/redo for everything, including regeneration.
- **Seed controls**: reroll, pin, and a "variations" grid of 4–6 seeds to pick from.

**Overlays (toggleable)**

- Grid with coordinates, and a 15×10 GBA screen-frame rectangle that follows the cursor.
- Elevation shading, the lock layer, and trainer sight lines.
- Reachability heatmap, colored by which HMs are needed to reach each cell.
- Validation markers.

## Validation and Gen 3 constraints

Validation runs after every generate and edit. Results show as clickable markers plus a list: **errors** block export, **warnings** don't.

**Errors**

- **Reachability**: every required exit, warp and connection opening is reachable from every entrance, using only the HMs available at this map's progression step. Use BFS over passable cells, honoring ledge direction and elevation.
- **No soft-locks**:
  - No ledge drops into an area with no way out.
  - No Strength boulder can be pushed into a position that blocks the only route.
  - No HM-gated area is required for progression before that HM is available.
- **Connections**: openings match the neighbor map in position and width, and connection offsets are consistent in both directions.
- **Warps**: paired warps reference each other, and every door sits on a building edge facing walkable ground.
- **Limits**:
  - Object event count stays under pokeemerald's per-map template limit (64; Claude Code should confirm it in source).
  - Map size stays under the decomp's maximum map data size (check `MAX_MAP_DATA_SIZE` and the formula in `fieldmap.h`).

**Map size rule (error).** pokeemerald loads each map into a RAM buffer with a 7-metatile margin. A map is valid only when **(width + 15) × (height + 14) ≤ 10,240**, from `MAX_MAP_DATA_SIZE` = 10240, `MAP_OFFSET` = 7, `MAP_OFFSET_W` = 15 and `MAP_OFFSET_H` = 14 in `include/fieldmap.h`. Read these from config so a hack that raises the limit can change them. Show the remaining budget live while the user resizes.

| Width (metatiles) | Max height |
| --- | --- |
| 15 | 327 |
| 20 | 278 |
| 25 | 242 |
| 30 | 213 |
| 40 | 172 |
| 50 | 143 |
| 60 | 122 |
| Square | 86 × 86 |

Routes longer than a **target segment length** (user setting, default 90 metatiles; changed from 80 at the user's request in Milestone 6) or over the limit are split automatically into connected segments. Splits go at natural seams such as narrow points, bridges or clearings, never through a building, trainer sight line or HM pocket.

**Warnings**

- **Trainers**: a trainer whose sight covers a forced chokepoint (an unavoidable battle). Sometimes intended, so the user can mark it OK.
- **Terrain**: a grass pocket of fewer than 6 cells; a path narrower than the minimum; a 1-cell terrain island; diagonal tree patterns hard to tile.
- **Pacing**: no item or reward in a dead end longer than N cells.
- **Encounters**: an encounter plan missing a table for terrain that exists (for example, deep water with no surf or fishing table).

**Segment and connection checks**

- **Error:** connected maps use different tilesets. The engine draws the neighbor's edge strip with the current map's tiles, so mismatched tilesets show a broken seam.
- **Error:** segments of one route disagree on region map section or progression step.
- **Warning:** a terrain feature such as a path, river or tree wall changes width or position abruptly across a seam.

**Gen 3 facts to encode**

Put these in one `constants.ts`, each with a comment saying where in pokeemerald to verify it.

- The GBA screen shows 15×10 metatiles.
- The border block repeats outside the map edges, 2×2 by default.
- No north-facing ledges in vanilla behaviors.
- Only about 16 objects can be active on screen at once, so warn on crowded screens.
- Slot counts: land 12, surf 5, rock smash 5, fishing 10.
- Elevation values: map the abstract levels to real values in config, not code.

**More Gen 3 limits**

- **Metatiles:** 512 in the primary tileset and 1024 total. These are already at their maximum; only the primary/secondary split can change.
- **Region map:** the in-game region map is built from 8×8-pixel tiles, 256×160 px by default. Porymap's Region Map Editor requires a tilemap width of 16, 32, 64 or 128 tiles. Locations (MAPSECs) are placed as rectangles on a coarse grid (about 28×15 squares in vanilla; confirm in source).
- **Region map variants:** there are four (Pokénav, Pokédex, Fly map, Pokémon Center wall map), each with UI that covers parts of the map.

## Outputs and exports

The v1 deliverable is a **rebuild packet** per map: everything the user needs, side by side with Porymap, to recreate the map by hand.

- **Project file** (`.json`): the full region, all maps, edits, seeds and settings. Re-opening it reproduces everything exactly.
- **Blueprint PNG** per map:
  - terrain colors with a legend;
  - coordinate rulers every 5 cells, with labeled major lines every 10;
  - entity icons with IDs;
  - trainer sight lines;
  - warps numbered to match the placement table.
- **Screen-tiled PNGs**: the map cut into 15×10 GBA screens, labeled (A1, A2…). This makes cell-by-cell rebuilding in Porymap easier.
- **Placement table** (CSV and a printable HTML page): one row per entity with kind, id, x, y, elevation and every suggested Porymap field from Map features.
- **Header sheet**: suggested `map.json` header values and connections with offsets, as a readable list and as a JSON snippet.
- **Encounter draft**: a `wild_encounters.json`-shaped snippet plus a readable table.
- **Rebuild checklist** (Markdown/HTML): ordered steps in Porymap, ending with "run the game and walk every exit." The steps are:
  1. Create the map with these settings.
  2. Set the size and border.
  3. Paint by screen tile.
  4. Place events.
  5. Set connections.
  6. Paste encounters.
- **Region overview PNG**: all maps on one sheet with connections.
- **Raw grid JSON** per map: the terrain, elevation and entities layers. This is the input for the future Porymap script exporter and the tileset tool.

**In-game region map export.** The tool already knows where every town, route and cave sits, so it drafts the Town Map/Fly map:

- **MAPSEC layout:** each location's rectangle (x, y, width, height) on the region map grid. Output it as a readable table and a JSON snippet to enter in Porymap's Region Map Editor. Route segments share one MAPSEC.
- **Draft region map image:** at the correct pixel size, on the 8×8 tile grid, in the PNW palette. Routes are drawn as lines, towns as squares, and terrain (water, mountains, forest) as broad fills. It's a base for the user to redraw or refine into final art, and should keep the unique-tile count low.
- **Variant preview:** overlays showing what the Fly map, Pokénav and Pokédex UI frames cover.
- **Flags:** Fly destinations and heal locations for towns with a Pokémon Center.

The region view gets a **region map preview** toggle that snaps the sketch to the region map grid, so the user can adjust placements before export.

All exports are produced by `core/exporters/*`, behind one `Exporter` interface, so the future Porymap-script and `map.bin` exporters plug in without UI changes.

## Tileset profiles

Define the format in v1 and implement the mapping later. A **tileset profile** is a JSON file that says how each abstract terrain type maps to a real tileset. This lets one blueprint target vanilla Emerald tilesets now and custom PNW tilesets later.

A profile holds:

- **Name**: the profile's own name.
- **Tilesets**: the primary and secondary tileset names.
- **Terrain rules**: for each terrain type, either one metatile ID or an autotile rule. An autotile rule is a neighbor mask (4- or 8-neighbor) mapped to a metatile ID, which is how water edges, tree walls, path borders and cliffs get their correct corner pieces.
- **Collision and elevation**: the values for each terrain type and abstract elevation.
- **Supported types**: a list of which terrain types the profile can draw. The editor warns when a map uses a type the selected profile can't.

Ship two stubs: `vanilla-emerald-general.json` (entries marked TODO for the user to fill or verify in Porymap's tileset editor) and `pnw-custom.json` (empty). Also ship a **PNW preview palette** for the blueprint colors: desaturated, cool, dark-leaning greens, slate blues and greys, avoiding anything that reads tropical or vivid. Add a toggle for a high-contrast palette for readability.

**Contract with the planned tileset/sprite generator.** The terrain vocabulary and the profile's autotile rule format are the shared interface. The future tool will read a project's terrain vocabulary plus autotile masks, generate matching metatiles, and write a profile back. Keep both formats documented in `docs/formats.md` and versioned.

## Milestones

Build in this order. Stop after each milestone, show the user how to run it, and wait for feedback before starting the next.

1. **Foundation**
   - **Build:** project setup, `start.bat` (plus `start.command` for macOS), seeded RNG, data model, terrain vocabulary, project save/load, a canvas showing an empty grid with rulers and the screen frame, the standalone single-file build, the hosted installable web app for iPad, and the security requirements.
   - **Done when:** the user double-clicks to launch, creates a 40×20 map, paints terrain with the pencil, saves, reloads and sees the same map; the standalone HTML file, copied to a second computer with nothing installed, opens offline and loads that saved project; and the hosted copy, added to an iPad's Home Screen, opens offline and lets the user paint with finger and Pencil.
2. **Route generator plus validation**
   - **Build:** stages 2–8 for routes, the reachability check, overlays, and the PNG and placement-table exports.
   - **Done when:** 200 random seeds all pass reachability, each export opens correctly, and the same seed gives identical output.
3. **Smart editing**
   - **Build:** stroke tools, locks, regenerating around locks, partial regenerate, undo/redo, and the variations grid.
   - **Done when:** the user draws a winding path and a stream, regenerates, and the drawn features survive with a bridge auto-inserted where they cross. Also: on a blank map, painting an ocean edge on the east and a wetland zone in the south produces a generated map that follows both, across 20 seeds.
4. **Entities and encounters**
   - **Build:** all entity kinds, trainer sight cones, the properties panel, the encounter draft from a pasted species pool, the header sheet and the rebuild checklist.
   - **Done when:** a full rebuild packet exports for one route.
5. **Towns, forests, caves**
   - **Build:** the three type-specific generators and multi-floor caves with ladder warp pairs.
   - **Done when:** each type generates valid maps over 100 seeds, and cave floors' warps pair correctly.
6. **Region mode**
   - **Build:** the sketch canvas, the region graph, cross-edge handoff of rivers and coastlines, progression steps with HM gating, the region overview export, click-into-map, sketch import (PDF/image underlay, two-point alignment, optional color extraction), route segments with auto-splitting, and the in-game region map export.
   - **Done when:** a sketch with 3 towns, 4 routes and 1 cave generates, every connection lines up, and a river flows continuously across two routes; a route longer than the target length auto-splits into matching segments; the user's PDF sketch can be aligned and traced; and the MAPSEC layout entered in Porymap matches the draft region map.
7. **Profiles (stretch)**
   - **Build:** the tileset profile loader, autotile preview using actual metatile images loaded from a pokeemerald project folder, and the exporter interface stubs for the Porymap script and `map.bin`.
   - **Note:** confirm with the user before starting.

## Working rules and open assumptions

**Rules for Claude Code**

- **Process**
  - Ask before any decision this spec leaves open. Don't guess on things that change the data format.
  - Before writing code for a milestone, post a short plan (files, key algorithms, risks) and wait for approval.
- **Accuracy**
  - Verify Gen 3 facts (field names, limits, slot counts, elevation values) against pret/pokeemerald and Porymap docs. Cite the file in a code comment.
  - When unsure, say so rather than inventing.
- **Code**
  - Keep `core/` free of UI code.
  - Every generator is deterministic and covered by seed-sweep tests.
  - Prefer clear, commented code over clever code. The user may read it to learn.
- **For the user**
  - Explain errors in plain language.
  - End each milestone with what was built, how to run it, how to try the new features, and known limitations.
  - Keep the UI uncluttered: sensible defaults, advanced options collapsed, tooltips on every control.

**Safety on the developer's PC (Windows)**

- **Project folder only:** read and write only inside the project folder. Never modify, move or delete anything outside it.
- **Explain before running:** before each command, say in plain language what it does and why. Ask before any install, update or deletion.
- **No global or admin changes:** don't install packages globally, change system settings or PATH, or run anything as Administrator. If something truly needs it, explain why and let the user do it.
- **Trusted sources only:** get packages from the official npm registry, prefer well-known packages, and don't run scripts piped from the internet.
- **No secrets:** the tool needs no accounts, keys or passwords. Never ask for, store or commit any. For hosting setup, guide the user through the steps in their own browser.
- **Version control:** set up git in the project at Milestone 1 and commit at every working checkpoint, so any bad change can be undone.

**Assumptions to confirm with the user**

- Map size presets (all pass the size rule): route segment S/M/L = 20×40, 30×60, 40×80 (vertical; swap for horizontal), with longer routes built as chained segments; town about 30×30; cave floor about 40×40. Target segment length defaults to 90.
- Default minimum path width is 2 cells; default tree border is 2–3 cells thick.
- No Gen 4+ mechanics (no Rock Climb, no Defog); vanilla Emerald HMs only.
- The encounter species pool is entered by the user. The tool ships no Pokémon data beyond example placeholders.
- Tall grass can't sit on raised elevation next to cliffs unless a profile says otherwise.
