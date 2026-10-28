# Gen 3 Map Blueprint

A planning tool for a pokeemerald ROM hack. You lay out maps here as colored terrain blueprints, then rebuild them by hand in Porymap. It runs in your web browser, works offline, and never sends anything over the internet.

**Status:** Milestones 1–4 are done:

- **Generate routes** from a seed, with settings for paths, grass, water, ledges, HM-gated areas, trainers and items, and a travel direction.
- **Edit by hand:** smart strokes, selections, zones, every kind of Porymap event (with all their fields), wild encounter tables.
- **Check every map** for Gen 3 problems, such as an entrance you can't reach or a ledge trap.
- **Export a rebuild packet:** everything you need beside Porymap to rebuild a map by hand, with a step-by-step checklist.

Towns, forests and caves come in Milestone 5, and the region view in Milestone 6.

---

## Start the tool (Windows)

1. Open the `Map Tool` folder.
2. Double-click **`start.bat`**.
   - The first time, it spends about a minute installing the tool's parts into this folder (a `node_modules` folder). Nothing is installed anywhere else.
   - Your browser then opens the tool at `http://localhost:5173`.
3. Keep the black window open while you work. Close it to stop the tool.

If the window says Node.js is missing, install the **LTS** version from https://nodejs.org and double-click `start.bat` again. (Node.js 24 is already installed on this PC.)

### Mac

Double-click **`start.command`**. If macOS refuses to open it:

- Right-click the file, choose **Open**, then confirm **Open**.
- If it says the file isn't executable, open Terminal, type `chmod +x ` (with a trailing space), drag `start.command` into the Terminal window, and press Return.

---

## Try it out (Milestone 1 checklist)

1. Click **Create a map**.
2. Set **Width 40** and **Height 20**. The bar underneath shows how much of the game's map memory the map uses. It turns red if the map is too big to load in pokeemerald.
3. Click **Create map**.
4. Pick a terrain with the square color button in the tool strip (or the Terrain panel on the right). Then drag on the map to paint.
5. Click **Save**. In Chrome or Edge you choose where the file goes. Later saves overwrite the same file.
6. Reload the page (F5). Your map comes back from the browser's autosave.
7. To be sure the file works: close the tab, start the tool again, click **Open**, and pick the saved `.json` file.

### Tools and gestures

| To… | Mouse / keyboard | iPad |
| --- | --- | --- |
| Paint | Left-drag with the Pencil tool (**B**) | Apple Pencil, or one finger (see below) |
| Erase to plain ground | Eraser tool (**E**) | Eraser tool |
| Draw a path, stream, tree wall, ledge, grass patch or pond | Smart strokes (**S**), pick the kind in the Paint tab | Smart strokes tool, with the Pencil |
| Plan zones (biome, water, edges, keep clear) | Zones tab; paint with the Zones tool (**Z**) | Zones tab, then the Zones tool |
| Paint elevation | Elevation brush (**L**) | Elevation brush in the tool strip |
| Lock / unlock cells | Lock brush (**K**) / Unlock brush (**U**) | The two padlock buttons in the tool strip |
| Select an area | Select tool (**V**), drag a rectangle; Lasso (**Q**), draw round any shape; Magic wand (**W**), click a terrain | Select, Lasso or Magic wand tool, with the Pencil |
| Add to / take from a selection | Hold **Shift** / **Alt** while selecting | **+** / **−** in the top bar |
| Select all / invert | **Ctrl+A** / **Ctrl+I** | Buttons in the top bar |
| Move it | Drag inside the selection | Drag inside the selection |
| Copy / cut / paste / delete it | **Ctrl+C** / **Ctrl+X** / **Ctrl+V** / **Delete**; **Enter** places a paste, **Esc** cancels | Buttons in the bar at the top |
| Place a trainer, item… | Things tool (**T**), click | Things tool, tap |
| Move a thing | Drag it | Drag it |
| Turn a trainer | Click it again, or **R** | Tap it again, or the arrows in the top bar |
| Copy a cell's terrain (or its elevation, with the elevation brush) | **Alt**+click, or the eyedropper (**I**) | Tap the eyedropper, then tap a cell |
| Move the view | Space+drag, right-drag, or the Move tool (**H**) | Two-finger drag |
| Zoom | Mouse wheel, **+** / **−**, **0** to fit | Pinch |
| Undo / redo | **Ctrl+Z** / **Ctrl+Y** | Two-finger tap, or the arrow buttons |
| Brush size | **[** and **]** | − / + in the tool strip |

**One finger on iPad:** finger painting is on by default. As soon as you use an Apple Pencil, the Pencil paints and a finger moves the view instead. You can change this under **Settings** (gear icon).

**What's on the canvas:**

- Rulers along the top and left. Grid lines are brighter every 5 and every 10 cells.
- A dashed **15×10 screen frame** follows your pointer. It shows how much one GBA screen displays.
- The status bar shows the cell (x, y), which screen it is in (**A1, B1, A2…**), its terrain, and the map-memory budget.

**Elevation, as in Porymap.** Turn on **Show → Elevation (as in Porymap)**. Every cell shows the elevation number you'll set in Porymap's collision tab, in Porymap's own colours:

- **1** water (blue), **3** ground (green), **4–7** raised ground (yellow to brown, higher is darker), **0** stairs (grey, Porymap's "transition"), **F** bridges (dark grey, "multi-level").
- The number is **white** where the player can walk and **red** where they can't (trees, cliffs, rocks).
- **Elevation opacity** sets how strongly the colours cover the map, like Porymap's slider.

**Elevation brush.** Pick a number in the Paint tab's **Elevation brush** list (or press **L**) and paint. It changes only the elevation, never the terrain, and turns the Elevation view on so you can see what you're doing. Stairs always show 0: paint them with the **Stairs** terrain.

**Locked cells:** everything you paint, move or paste is *locked* (marked with a small yellow corner when **Show → Locked cells** is on). Generate never changes locked cells. Turn this off for painting with **Lock what I paint**. The **Lock brush** (**K**) and **Unlock brush** (**U**), side by side in the tool strip, lock or unlock cells by hand without changing them.

## Editing (Milestone 3)

**Resizing a map.** Open the **Maps** list and tap the resize button next to the open map. Type the new width and height, and pick the **anchor**: the part of the map that stays put. With the anchor top-left, cells are added or cut on the right and bottom; in the middle, equally on every side. New cells are plain ground, not locked, so **Generate** fills them in. Things, locks, zones and entrances move with their cells. When shrinking, a red box lists what would be cut off (locked cells, things, warps, zones, entrances) before you confirm. One **Undo** puts it all back.

**Smart strokes (S).** Pick what to draw in the Paint tab under **Smart strokes**, then draw it. The tool makes it valid:

- **Path:** a line, widened to at least the **Narrowest path** setting (or the brush size, if bigger). Where it crosses water it becomes a bridge.
- **Stream:** deep water at least 2 wide (or the brush size). Where it runs through trees or rock, a bank of open ground is cleared on both sides. Where it crosses a path, there's a bridge.
- **Tree wall:** trees at least 2 thick (or the brush size).
- **Grass patch:** draw round an area; it fills with tall grass. Paths and water inside stay as they are.
- **Water body:** draw round an area; it fills with deep water, with the shoreline tidied (no one-cell spikes or notches). Paths across it become bridges.
- **Ledge:** a line of ledges. Below the kinds, choose which way they jump: **Auto** (a line across the map jumps south, a line down it jumps east), or ↓ → ←.
- **Building lot:** drag across the area a building covers. It becomes a building with its door in the middle of the bottom edge (Gen 3 buildings face south), a path cell in front, and a door warp; set where the door leads in the Details tab.

You see the stroke as you draw; it's applied when you let go, and one Undo takes it back. Everything a stroke draws is locked, so Generate builds the rest of the route around it. Water gets Porymap's water elevation (1) and bridges 15 (F).


**Select, move, copy (Select tool V, Lasso Q, Magic wand W).**

- **Select:** drag a rectangle.
- **Lasso:** draw round any shape. Everything inside the line (and under it) is selected when you let go.
- **Magic wand:** tap a cell to select every joined cell of the same terrain: a whole pond, grass patch or path. Tick **Everywhere** to pick that terrain all over the map.

**Shaping a selection** (left end of the top bar):

- **New / + / −:** whether the next rectangle, lasso or wand tap replaces the selection, adds to it, or takes away from it. On a keyboard, hold **Shift** to add or **Alt** to take away.
- **Grow / Shrink** by one cell all round (for example, a pond plus its shore).
- **Invert** selects everything that isn't selected; **Select all** selects the whole map.
- **▴ / ▾** folds the less-used buttons away when you need to see more of the map.

Then:

- **Move:** drag inside the selection (in New mode). Trainers, items and other things in it move too.
- **Copy / Cut / Paste / Delete:** use the bar at the top of the map (or Ctrl+C, Ctrl+X, Ctrl+V, Delete). A paste appears in the middle of the view: drag it where you want it, then **Place** (or Enter). **Cancel** (or Esc) throws it away.
- **Change it all at once:** **Fill with…** sets every selected cell to one terrain, like a paint bucket (locked, if **Lock what I paint** is on). **Elevation…** sets their elevation. The padlock buttons lock or unlock them.
- **Regenerate area:** makes only the selected area again with the generator. Everything outside it stays exactly as it is. Each try looks different; Undo goes back.
- **Gaps** (in the same bar) decides what fills the hole a move, cut or delete leaves behind: **Generated terrain** (the default) fills it to match the surroundings, and one Undo takes back both the move and the fill; **Plain ground** leaves it empty. Either way the gap is unlocked, so Generate or Regenerate area can change it later.

Everything moved or pasted is locked, so Generate keeps it.

**Things (Things tool, T).** In the Paint tab under **Things on the map**, pick what to place, then tap the map: a trainer, item, hidden item, person, sign, Cut tree, Rock Smash rock, Strength boulder, berry tree, **warp** (door, cave mouth, ladder or stairs), trigger (a script tile, or one that changes the weather), Secret Base spot, or heal location (Fly spot). With the Things tool:

- **Drag** a thing to move it. A trainer's sight line follows as you drag.
- **Tap** a thing to pick it. A bar at the top shows its ID. For a trainer, the arrows set which way it faces (✣ = looks around), and − / + change how far it sees. Tapping a picked trainer again turns it a quarter turn.
- **Remove** a thing with the bin button, the Delete key, or **Remove things** in the Paint tab (then tap things to remove them).

Things you place, move, turn or edit are kept when you Generate, and generated things get IDs that never clash with yours.

**Details tab (Milestone 4).** Pick a thing with the Things tool, then open the **Details** tab to see and change every Porymap field: its sprite (graphics_id), movement type, trainer type, sight range, script, flag, item, and so on. The boxes suggest vanilla pokeemerald names as you type, but you can type anything. Each change is one Undo step.

- **Warps:** pick the kind, where it leads (dest_map: one of your maps or any MAP_* name) and which warp it arrives at there (dest_warp_id). Warps are numbered W0, W1… in the order placed, as in Porymap. Generate keeps every warp and leads a path to it; a warp's cell becomes path (or a cave entrance for a cave mouth) unless you locked it, so a door on a building you painted and locked stays as drawn.
- **Battles you can't avoid:** the Check tab warns when a trainer watches the only way through. If that's on purpose, pick the trainer and tick **This battle can't be avoided, on purpose** in Details; the warning goes away.
- **With nothing picked**, Details shows the map's own settings: the map.json **header** (map constant, music, map section, weather, map type, bike/escape/running, name popup, battle scene, floor), the **layout** (2×2 border block and tilesets), and **connections** (which map joins each edge, and its offset).

**New checks.** A warp the player can't reach is an error; a warp that doesn't lead anywhere yet is a warning. When a warp leads to another map in this project, that map's warp must lead back to it (an error otherwise).

**What Generate changes** (Generate tab):

- **Everything except locked cells and placed things** (the default).
- **The whole map**, which also clears every lock.
- **Regenerate selected area**, as above.

All of these can be undone.

---

## Zones: planning a map before you generate (Milestone 3)

Zones are optional. Without them the generator decides everything; with them it follows your plan and fills in the rest. Open the **Zones** tab.

**Kinds of zone:**

- **Biome area:** part of the map is a different biome, e.g. wetland in the south of a meadow route. A map can have several.
- **Water:** lake, pond, river, ocean or marsh. Deep water needs Surf; shallow can be walked through. The path goes round lakes, ponds and the sea, and crosses rivers on bridges. Marsh is shallow pools, long grass and mud.
- **Boundary:** coast (sea with a beach), riverbank, cliff, forest wall, or open ground, along a map edge or as a line you paint.
- **Keep clear:** walkable ground, no water or trees (a clearing, a town lot, a landmark).

**Making a zone:**

- **New zone** buttons start one; then paint it on the map with the Zones tool (**Z**, brush size applies). **Paint / Erase** switches between adding and removing cells.
- If something is selected (Select, Lasso or Magic wand), a new zone starts as that area. **Add the selection to this zone** adds more.
- **Along a map edge** makes a boundary from a form, e.g. east edge, coast, from y 10 to y 40, 8 cells deep.

**Soft or hard:** zones are soft by default: the generator follows their general shape with natural, irregular edges. **Fuzziness** (0–100) sets how loose: at 100 the edge moves up to 4 cells in or out. Tick **Exact edges (hard)** to have a zone followed cell for cell. On the map, soft zones have a dashed outline and hard ones a solid one (**Show → Zones** turns the overlay off).

Zones are saved with the map and kept every time you generate. Locked cells always win over zones. Automatic entrances move along the edge out of water and wall zones.

## Generate a town (Milestone 5)

Make a map of type **Town** (sizes S 20×20, M 30×30, L 40×40), then press **Generate**. The **Town** group in the Generate tab sets:

- **Streets:** *Grid* (roads in blocks), *Organic* (winding lanes) or *Waterfront* (the sea along one side, the main road along the shore).
- **Buildings:** Pokémon Center (5×4), Mart (4×4), Gym (7×6), a landmark building (6×5), and houses (4×3, some 5×4). Each sits on a lot beside a street with its door in the middle of its front (south) side, a walk to the street, and a **door warp** to its interior: `MAP_<TOWN>_POKEMON_CENTER_1F`, `_MART`, `_GYM`, `_HOUSE1`… (vanilla's naming). The interiors aren't made: build them in Porymap. Buildings that don't fit are left out, and Generate says so.
- **People** wandering beside the streets, and **Grass at the edges**: small tall-grass patches near the border that are never in the way (every exit and door can be reached without stepping in grass).

- **Elevation:** hillsides along the sides of the town with cliffs, stairs and ledges, as on routes (0 = flat, the default).
- **Side streets:** streets off the main ones that end in dead ends, with **Side street length** and **Items at dead ends**.

**Drawing your own streets.** Paint the streets you want with Path or Road (locked, as painting is by default), then Generate. It uses your streets instead of making its own: it joins them to the entrances and to each other, and puts the buildings along them. Gen 3 doors face south, so buildings line up on the north side of east–west streets; beside north–south streets they sit a short walk away.

Towns follow your zones (water, edges, keep-clear ground: nothing is built on keep-clear ground), and streets cross rivers and water you painted on bridges.

Generate also adds the town sign, a sign by the Gym, flower beds, fences and trees, a few hidden items, and the Pokémon Center's **heal location** on the step in front of its door. The building sizes are typical Gen 3 sizes, not checked against pokeemerald's (binary) layouts; tell me if one is wrong.

Doors Generate makes are replaced each time you Generate; warps you place yourself are kept. **Check** reports a door that isn't on a building's bottom edge with walkable ground in front of it.

## Generate a forest (Milestone 5)

Make a map of type **Forest** (sizes S 40×40, M 50×50, L 60×60), then press **Generate**. You get a maze of winding paths through thick forest, like Petalburg Woods: the paths wander and change width, and the woods between them grow in uneven clumps, with dense forest inside and single trees at the edges. The **Forest** group in the Generate tab sets:

- **Maze density** (0–100): low = open woods with a few loops and short side paths; high = one long winding way with long dead ends.
- **Clearings:** open spaces where three or more paths meet.
- **Guaranteed hidden items:** always placed, at quiet dead ends first.
- **Path width:** 1–3 cells (it wanders a little either side).
- **Travel direction:** which way the player first walks through. Trainers face the player coming from the start, the sign stands at the start, and **Ledge shortcuts** jump from deep in the maze back toward the start, so coming back you don't have to find your way through again. Gen 3 has no ledges you can jump north, so a forest travelled north to south gets none.

The deepest dead ends get item balls (two more than **Extra items**), trainers watch the way between the entrances, long grass grows along the paths (**Grass** sets how much), and there's a sign at the entrance. The biome sets the look: long grass in rainforest and wetland woods (wetland clearings hold a little pool and mud), tall grass and lots of flowers in meadow woods, snowy grass and outcrops of rock in alpine ones. Big clearings sometimes have a clump of trees standing in them. Forests follow your zones too, and their paths cross rivers and water you painted on bridges.

## Generate a cave (Milestone 5)

Make a map of type **Cave floor** (sizes S 30×30, M 40×40, L 50×50), then press **Generate**. You get rounded chambers of cave floor in rock, joined by winding tunnels, like Granite Cave. The **Cave** group in the Generate tab sets:

- **Openness:** narrow tunnels and small chambers (0) up to big caverns (100).
- **Exits:** cave mouths, the ways out. Each is a warp in the rock with the floor in front of it. To link one to a route, pick it with the Things tool and set where it leads in the Details tab (for example the route's cave mouth warp); it's then kept when you Generate, and Generate only adds the rest.
- **Raised platforms:** rock platforms with stairs up, off the main way.
- **Underground water:** pools that need Surf, in the far parts of the cave (never on the main way).
- **Rock Smash rocks:** each closes a side passage with an item behind it.
- **Strength boulders:** each blocks a side passage; push it in with Strength to reach the item behind.
- **Dark (needs Flash):** sets the header's requires_flash.
- **Floors** and **Ladders between floors** (first floor only): a cave with 3 floors gets maps named like *Moss Cave B1F* and *Moss Cave B2F* in your project when you Generate the first floor. Ladders join each floor to the next (vanilla's ladder warps); each ladder points at its partner on the other floor and back, and Generate pairs them again whenever a floor is made again. Only the first floor has exits to the outside. Generating a deeper floor remakes just that floor and re-pairs its ladders.

Trainers watch the main way between the exits, the far corners get items and hidden items, and wild Pokémon use the cave rate (land 10). The checks treat the exits and ladders as the cave's entrances: every one must lead to every other one. **Check** also reports a Strength boulder (yours or Generate's) that can be pushed somewhere it blocks the way through for good.

## Generate a route (Milestone 2)

**Water you paint** (a stream, a lake) is kept, and the route's path crosses it on a bridge where it needs to. In meadows the ground is full of flowers.

1. Create a map with **Type: Route** (for example the **M (vertical)** preset, 30×60).
2. Press **Generate**: the ✨ button in the tool strip, the **G** key, or the big button on the **Generate** tab of the right-hand panel. On iPad, tap the colour square in the tool strip to open the panel.
3. Don't like it? Press **New seed**. The same seed always gives exactly the same map.
   - **Variations: compare 6 seeds** generates the map with six new seeds side by side (your locked cells, placed things and zones are kept in all of them). Tap the one you like; Undo goes back. **Show 6 more** makes another batch.
   - **Recent** lists the seeds you generated this session: tap one to go back to it.
   - The **padlock** beside the seed pins it, so New seed, Variations and Recent can't change it by accident.
4. Open the setting groups on the **Generate** tab to change the map:
   - **Basic:** biome, path winding, path width.
   - **Entrances:** which edges, where, and how wide.
   - **Terrain:** grass, water, tree cover, border (Auto = cliffs on alpine routes), stream, clearing.

   Sliders run from 0 to 100.
   - **Structure:** side branches, ledge rows, HM-gated areas.
   - **Gameplay:** trainers, items, hidden items, and which HMs the player has by now.

   Then Generate again. Every setting has a tooltip.
5. **Painting first works too.** Cells you paint are locked, and Generate builds around them. Paint a pond, then Generate, and the pond stays exactly as drawn. If your painting blocks the route, the Check tab tells you where.
6. **Undo** reverses a Generate, like any other change.

**Layouts** (Generate tab → Basic → Layout). The biome sets the look; the layout sets the shape:

- **Land:** a route through forest and fields.
- **Coastal:** the sea fills one long side, out to the map edge, with a sandy beach and surf entrances on the water at both ends. "Auto" picks this for the coastal biome.
- **River:** a river runs the length of the route. The path follows the banks and crosses on bridges, and there are surf entrances on the river at both ends.
- **Open water:** sea or lake with islands. It's a surfing route with swimmers on the water and items on the islands, and the checks assume the player has Surf.

**Travel direction** (Basic → Travel direction) says which way the player first walks the route: South → North, North → South, West → East or East → West. Players see a route going forward first and come back through it later, so the map is shaped for that:

- **Ledge rows jump back toward the start.** Walking forward, the path winds round each ledge, past the trainers; coming back, you jump down as a shortcut.
- **A ledge pocket:** a little room in the trees with a ledge in and a ledge out and an item inside. Going forward you can see it over the ledge but can't climb in; on the way back you drop in, grab it and drop out onto the path.
- **Trainers** mostly face the player coming from the start, wait on the way round ledge rows, and none stand within 10 cells of the start entrance.
- **Hills** are lower near the start and rise toward the end.
- **The route sign** stands at the start entrance.

Gen 3 has no ledges you can jump north. So on a **North → South** route the ledges jump forward instead: there are half as many ledge rows, and the ledge pocket is a reward on the way forward.

The route runs the way you pick, even across a map's short side, and automatic entrances go at the start and end edges. With entrances you placed yourself, there must be one on each of those two edges, or the direction is ignored (the panel says so). "Either way" (the default) makes routes exactly as before. Only straight routes for now: bends such as West → South come later.

**Elevation** (Basic → Elevation, 0–100) makes the route hilly, like Hoenn's. Stretches of ground along the sides of the route rise in terraces toward the map edge, each with a cliff face, stairs up, and ledges you jump down. A path leads to every flight of stairs. It works on every route size, even the smallest.

- At 0 the route is flat.
- Higher values give longer stretches of hillside and more levels: up to 3 (Porymap 4–6), and 4 on alpine routes. A level needs room, so narrow routes get fewer.
- Wide routes also get free-standing plateaus in the middle.
- Coastal and river routes keep the low ground along the water.

**Ledge rows** (Structure → Ledge rows) put a long ledge across the route on flat ground, with a gap at one end. Walking one way, the path winds along the ledge to the gap and back. Coming the other way, you just jump down, a shortcut. In Porymap the ground is 3 on both sides: the ledge is a one-way step, not a change of level. Hillier routes (higher Elevation) get extra rows.

**Alpine routes are mountains.** The route runs up a valley and the ground on both sides climbs in terraces toward the map edges: up to 4 levels (Porymap 4–7) on a 40-wide route, 3 on a 30-wide route, 1–2 on the smallest. Each terrace has its own stairs, set away from the stairs below so the climb switches back. Alpine routes also get cliff borders, mostly bare rock with small clumps of conifers, narrow passes, and boulder fields. Any Elevation above 0 counts as quite hilly on alpine routes.

**Snow** (Basic → Snow, 0–100) is roughly the share of the route under snow, highest ground first, so a hilly route can be white on top and green below. In the snow:

- open ground becomes **Snow**, and grass becomes **Snowy grass** (still wild encounters);
- ponds freeze into **Slippery ice**: the player slides until something stops them, and the checks follow the slide;
- some trees become **Snowdrifts**, which block like trees;
- paths stay paths, as a trodden trail.

Gen 3 has no snow tiles, so these four need custom tiles in your tileset.

**Two ways through** (Structure → Grass shortcut). Every route offers a choice:

- **Stick to the path:** it's longer, and trainers watch it, so you'll fight most of them. You'll still cross some grass, set by **Grass across the path**.
- **Take the grass shortcut:** it's shorter, mostly tall grass, and skips most trainers, but one may still watch it.

No battle is forced for the whole map, because there's always the other way.

Each entrance is **Walk** or **Surf** (Entrances section). Changing the layout resets entrances to automatic. Surf entrances are only checked once the player has Surf.

**What a generated route contains:**

- **Main path:** winds from entrance to entrance, with side branches that end in an item.
- **Grass:** mostly beside the path.
- **Water:** ponds, and sometimes a stream with a bridge where it crosses the path.
- **Ledge rows:** ledges across the route; the path winds round, and coming back you jump down.
- **HM-gated area:** a small area sealed by a Cut tree, a Rock Smash rock or a strip of water (Surf), with an item inside.
- **Trainers:** each faces across the path, and the player can always walk around them.
- **Hidden items** and a **sign** at the entrance.

### Check tab (validation)

Checks run after every change. **Errors** (red) block exporting. **Warnings** (amber) are advice. Click any problem to jump to it on the map.

**Errors:**

- An entrance you can't reach from another, using only the HMs the player has.
- Ledge traps: places you can jump into but never get out of.
- A blocked entrance.
- A map too big for the game.
- Too many objects on the map.

**Warnings:**

- A trainer you can't avoid.
- A grass patch under 6 cells.
- A 1-cell-wide path.
- Single-cell terrain patches.
- Diagonal tree patterns a tileset can't draw.
- An item nobody can reach.
- A dead end with no reward.
- A crowded screen.

### What's on the canvas

The **Paint** tab's **Show** list toggles:

- **Trainer sight lines** (red).
- **Problems** (outlined cells).
- **Reachability:** cells coloured by which HM you need to reach them. Red means unreachable.
- **Elevation (as in Porymap):** numbers and colours from Porymap's collision tab.

Entrances are outlined in yellow. Things on the map are coloured squares; zoom in to see their IDs (T1 = trainer 1, I2 = item 2, H1 = hidden item, S1 = sign, C1 = Cut tree, R1 = Rock Smash rock).

### Export

Click **Export** in the top bar (blocked while the map has errors). The first option is the one you usually want:

- **Rebuild packet (ZIP):** everything below in one folder, with an `index.html` page linking it all. Open the folder, open **checklist.html**, and work down it with Porymap open. It contains:
  - `checklist.html` / `checklist.md`: the rebuild steps with this map's values: create the map, set the size and border, paint by screen tile, place events, set connections, paste encounters, then run the game and walk every exit;
  - `blueprint.png`, `elevation.png` and the `screens` folder;
  - `placements.html` / `placements.csv`;
  - `header-sheet.html`: the map.json header values, layout (size, border, tilesets) and connections with offsets, as a list and as JSON;
  - `map.json`: the whole map.json in pokeemerald's format (header, connections and every event, numbered as in the placement table). You can use it as the map's `data/maps/<Name>/map.json`, or copy values from it;
  - `encounters.html` and `wild_encounters-entry.json`: the encounter draft, readable and ready to paste into `src/data/wild_encounters.json`;
  - `heal_locations-entries.json` if the map has heal locations;
  - `grid.json`: the raw grid (terrain, elevation, things) for scripts.

Each sheet can also be exported on its own:

- **Blueprint (PNG):**
  - The map at 16 px per cell, the same size as a Gen 3 metatile.
  - Rulers every 5 cells, with numbers every 10.
  - Numbered things and trainer sight lines.
  - A colour legend.
- **Elevation (PNG):** the map as Porymap's collision tab shows it, with each cell's elevation number (white = walkable, red = blocked) and a key. Keep it beside Porymap while you set elevations.
- **Screen tiles (ZIP):** one PNG per 15×10 GBA screen, plus an elevation version of each in the `elevation` folder, named A1, B1, A2… (letters go across, numbers go down), with real coordinates. Use these to rebuild the map in Porymap one screen at a time.
- **Placement table (CSV, or a printable page):** one row per thing, with its position and suggested Porymap fields:
  - `graphics_id`, `movement_type`, `trainer_type`, sight range, `script`, `flag` and `item`.
  - The Porymap list it belongs in, and its number in that list.

On iPad, exports open the share sheet. Choose **Save to Files**; in the Files app, tap the ZIP to unpack it, then open `index.html` or `checklist.html`.

---

## Wild encounters (Milestone 4)

Open **Generate → Gameplay → Encounters…**.

**1. The species list (one for the whole project).** Paste your Pokémon, one per line, in this order or any order:

```
ZIGZAGOON 2-5 land meadow
MAGIKARP 5-15 fish
GEODUDE 6-10 rock alpine uncommon
```

- **Name:** with or without `SPECIES_`.
- **Levels:** `5` or `2-5`: the levels it can appear at anywhere in your game.
- **Where:** `land` (grass and caves), `surf`, `fish`, `rock` (Rock Smash). Several are fine. None = land.
- **Biomes (optional):** e.g. `meadow`, `coastal`, `wetland`: it's more likely on maps of those biomes.
- **Rarity (optional):** `common` (default), `uncommon` or `rare`. Rare ones end up in the 1% slots.

A list copied from a spreadsheet (commas or tabs) works too. Press **Use this list**; lines it can't read are listed. **Example list** fills in a short list to try it out. The tool comes with no Pokémon data: replace it with your own.

**2. Each map's draft.** Set the map's levels with **Lowest / Highest wild level** under Gameplay (default 3–6). Generate then drafts the tables the map needs, with vanilla Emerald's slots and rates:

| Table | When | Slots | Rate |
| --- | --- | --- | --- |
| Grass (land) | grass on the map | 12 (20, 20, 10, 10, 10, 10, 5, 5, 4, 4, 1, 1 %) | 20 (10 in caves) |
| Surfing | deep water | 5 (60, 30, 5, 4, 1 %) | 4 |
| Rock Smash | Rock Smash rocks | 5 (60, 30, 5, 4, 1 %) | 20 |
| Fishing | deep water | 10: Old Rod 2, Good Rod 3, Super Rod 5 | 30 |

Common species get the likely slots; fishing levels rise from the Old to the Super Rod. **Redraft** makes a different draft. Change any species, level or rate by hand, add or remove a table: the draft is then kept (**Keep this draft when I Generate** is ticked); untick it to let Generate draft again. Everything is undoable.

The Check tab warns when a map has no draft yet, or has grass, deep water or Rock Smash rocks with no table for them.

## Saving your work

- **Save** writes a `.json` project file. That file is your real copy. Back it up like any other document.
- The browser also keeps an **autosave**, but it's only a convenience: browsers can clear it. "● Unsaved changes" in the top bar means your latest work isn't in a file yet.
- **⋯ → Download a copy** always downloads a fresh copy to your Downloads folder.
- **On iPad**, Save opens the share sheet. Choose **Save to Files** (iCloud Drive or On My iPad). Open projects with **Open**, which shows the Files picker.

Project files are checked carefully when opened. A damaged or unexpected file is refused with a message saying what's wrong, and nothing is half-loaded.

---

## The single-file version (any computer, nothing installed)

To make it, run this in a terminal in the project folder:

```bash
npm run build:standalone
```

This creates **`dist-standalone/Gen3MapBlueprint.html`**, one file with everything inside it.

- Copy it to any computer (USB stick, email, cloud drive) and double-click it. It opens in Edge, Chrome, Firefox or Safari, fully offline.
- Use **Open** and **Save** there just like in the normal tool. Project files work the same in every version.

---

## The iPad version (one-time setup)

iPads can't run an HTML file from the Files app, so the iPad uses a hosted copy of the tool. You add it to the Home Screen, and from then on it works offline. Hosting is free on GitHub Pages. The repository must be **public**: people can see the tool's code, but never your project files, which stay on your devices.

1. **Create a GitHub account** at https://github.com/signup (free).
2. **Create a repository:** click **+ → New repository**, name it (for example `map-blueprint`), choose **Public**, and leave every "Initialize" box unticked. Click **Create repository**.
3. **Upload the code:** in a terminal in the project folder, run these two commands, replacing `YOUR-NAME` with your GitHub user name. The first time, Git asks you to sign in to GitHub in your browser.
   ```bash
   git remote add origin https://github.com/YOUR-NAME/map-blueprint.git
   ```
   ```bash
   git push -u origin main
   ```
   If the first command says **"remote origin already exists"**, it was already run once (perhaps with `YOUR-NAME` still in it). Fix the address instead of adding it again, then push:
   ```bash
   git remote set-url origin https://github.com/YOUR-NAME/map-blueprint.git
   ```
4. **Turn on Pages:** in the repository on github.com, go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**. GitHub then suggests starter workflows ("GitHub Pages Jekyll", "Static HTML"). **Ignore them**: this project already has its own workflow.
5. Open the **Actions** tab. If you pushed before turning on Pages, the first "Publish web app" run will have failed (red ✗). Click it, then **Re-run all jobs**. After about two minutes it shows a green tick. Your tool is at `https://YOUR-NAME.github.io/map-blueprint/`, using the same capital letters as your repository name.
6. **On the iPad:** open that address in **Safari**. Tap **Share → Add to Home Screen**, then open the tool once from the new icon while online. After that it opens with no connection.

Whenever you push new code to GitHub, the hosted copy updates (give GitHub a minute or two). The app opens from its offline copy, so the first time you open it after an update you still get the old version; once the new one has downloaded, a message says so. Close the app and open it again (on a computer: reload the page) to use it. Your work is kept.

---

## For developers

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server at http://localhost:5173 |
| `npm test` | Run all tests (Vitest) |
| `npm run typecheck` | Type-check everything, and check that `src/core` uses no browser APIs |
| `npm run build:standalone` | Build `dist-standalone/Gen3MapBlueprint.html` |
| `npm run build:web` | Build the hosted, installable app into `dist-web/` |
| `npm run gen -- --config examples/route.json --seed 42` | Generate a route with no browser and print the project file (add `--out file.json` to save it) |
| `npm run gen -- --config examples/route.json --seed 42 --export out` | Same, and write every export (PNG, ZIP, CSV, HTML) into the folder `out` |

**Layout**

- `src/core/`: data model, seeded random numbers, size rule, saving and opening files. Pure TypeScript with no browser code, so it runs from the command line.
- `src/ui/`: the React editor and canvas renderer.
- `profiles/`: the terrain vocabulary, color palettes and tileset profile stubs, all JSON.
- `docs/formats.md`: every file format. This is also the contract with the planned tileset generator.
- `scripts/`: build helpers (security policy, service worker stamping, icon drawing).
- `web-public/`: manifest, service worker and icons, used only by the hosted build.

**Security**

- The built app has a strict Content Security Policy. It allows no network connections, no remote scripts, fonts or images, and only the app's own inline code (checked by hash).
- Opened files are validated against the schema, with size limits. Unknown fields are rejected.
- Text from files is only ever shown as plain text.

**Gen 3 facts** live in `src/core/constants.ts`. Each one cites the pokeemerald file it was checked against.

---

## Known limitations

- **Cave floors and Undo.** Undo after generating a cave's first floor undoes that floor only; floors it made or re-paired stay (delete them in the Maps list if you don't want them).
- **Boulders need narrow side passages,** so a cave may get fewer than you asked for.
- **Bridges over painted water.** Water you paint is locked, but Generate may lay a bridge across it where its path has to cross (routes, towns and forests). It's the one change Generate makes to a locked cell; the next Generate can move the bridge.
- **Waterfront towns** sometimes get wide patches of road where lanes run side by side.
- **Mountains follow the map's own biome.** A biome zone changes the ground, trees, grass and detail in its area, but elevation (alpine terraces) still follows the map's main biome.
- **Generate works around drawn features but doesn't route through them.** A path you draw is kept, but the generated main path may run elsewhere; join them with another stroke if you want one route.
- **Regenerated gaps are often forest.** Away from the path, the generator mostly grows trees, so a gap filled with generated terrain may come back as forest. Use Fill with… or the pencil if you want open ground there.
- **Moving across elevation** isn't smoothed: an area moved onto raised ground keeps its own elevation, so check the Elevation view (and the Check tab) afterwards.
- **What Generate places.** Generate places trainers, items, hidden items, Cut trees, Rock Smash rocks and a sign. Berry trees, people, triggers, Secret Base spots, heal locations and warps are placed by hand (towns and caves place their own in Milestone 5). Field values are suggestions to check in Porymap.
- **Generated trainers are always avoidable.** Place a trainer by hand (and tick "on purpose" in Details) for a battle you can't avoid.
- **Connections aren't checked against the neighbour yet.** The rebuild checklist reminds you to line up the entrances; region mode (Milestone 6) will check both sides.
- **The map.json draft is a starting point.** Scripts, flags and trainer data it names don't exist in your project until you write them.
- **Water currents.** They count as plain Surf water: the forced movement is ignored for now.
- **Plain export text.** Labels in exported images use a small built-in pixel font, in capitals only.
- **Not tested on real Apple devices.** Testing used Chromium on Windows, including an iPad-sized viewport. Please try Generate and Export on the real iPad and in desktop Safari.
- **Region view later.** The breadcrumb shows the region name, but the region sketch view arrives in Milestone 6.
- **Approximate screen frame.** The frame assumes the player stands 7 cells from the left and 4 from the top of the screen. This only affects the overlay.
- **Unconfirmed presets.** The forest, cave-floor and interior size presets are placeholders.
