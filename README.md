# Gen 3 Map Blueprint

A planning tool for a pokeemerald ROM hack. You lay out maps here as colored terrain blueprints, then rebuild them by hand in Porymap. It runs in your web browser, works offline, and never sends anything over the internet.

**Status:** Milestone 2 (route generator and validation) is done:

- **Generate routes** from a seed, with settings for paths, grass, water, ledges, HM-gated areas, trainers and items.
- **Check every map** for Gen 3 problems, such as an entrance you can't reach or a ledge trap.
- **Export** a blueprint PNG, screen-by-screen tiles, and a placement table.

Milestone 1 (Foundation: create maps, paint, save and open, on Windows, Mac and iPad) is also done. Smart drawing tools come in Milestone 3.

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
| Copy a cell's terrain | **Alt**+click, or the eyedropper (**I**) | Tap the eyedropper, then tap a cell |
| Move the view | Space+drag, right-drag, or the Move tool (**H**) | Two-finger drag |
| Zoom | Mouse wheel, **+** / **−**, **0** to fit | Pinch |
| Undo / redo | **Ctrl+Z** / **Ctrl+Y** | Two-finger tap, or the arrow buttons |
| Brush size | **[** and **]** | − / + in the tool strip |

**One finger on iPad:** finger painting is on by default. As soon as you use an Apple Pencil, the Pencil paints and a finger moves the view instead. You can change this under **Settings** (gear icon).

**What's on the canvas:**

- Rulers along the top and left. Grid lines are brighter every 5 and every 10 cells.
- A dashed **15×10 screen frame** follows your pointer. It shows how much one GBA screen displays.
- The status bar shows the cell (x, y), which screen it is in (**A1, B1, A2…**), its terrain, and the map-memory budget.

**Locked cells:** everything you paint is *locked* (turn this off with **Lock what I paint**). Locked cells will be left alone by the generators that arrive in Milestone 2. Turn on **Show → Locked cells** to see them.

---

## Generate a route (Milestone 2)

1. Create a map with **Type: Route** (for example the **M (vertical)** preset, 30×60).
2. Press **Generate**: the ✨ button in the tool strip, the **G** key, or the big button on the **Generate** tab of the right-hand panel. On iPad, tap the colour square in the tool strip to open the panel.
3. Don't like it? Press **New seed**. The same seed always gives exactly the same map, so note the seeds you like.
4. Open the setting groups on the **Generate** tab to change the map:
   - **Basic:** biome, path winding, path width.
   - **Entrances:** which edges, where, and how wide.
   - **Terrain:** grass, water, tree cover, border, stream, clearing.
   - **Structure:** side branches, ledge shortcuts, HM-gated areas.
   - **Gameplay:** trainers, items, hidden items, and which HMs the player has by now.

   Then Generate again. Every setting has a tooltip.
5. **Painting first works too.** Cells you paint are locked, and Generate builds around them. Paint a pond, then Generate, and the pond stays exactly as drawn. If your painting blocks the route, the Check tab tells you where.
6. **Undo** reverses a Generate, like any other change.

**What a generated route contains:**

- **Main path:** winds from entrance to entrance, with side branches that end in an item.
- **Grass:** mostly beside the path.
- **Water:** ponds, and sometimes a stream with a bridge where it crosses the path.
- **Ledge shortcut:** a one-way loop that always leads back to the path.
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
- **Elevation shading.**

Entrances are outlined in yellow. Things on the map are coloured squares; zoom in to see their IDs (T1 = trainer 1, I2 = item 2, H1 = hidden item, S1 = sign, C1 = Cut tree, R1 = Rock Smash rock).

### Export

Click **Export** in the top bar (blocked while the map has errors):

- **Blueprint (PNG):**
  - The map at 16 px per cell, the same size as a Gen 3 metatile.
  - Rulers every 5 cells, with numbers every 10.
  - Numbered things and trainer sight lines.
  - A colour legend.
- **Screen tiles (ZIP):** one PNG per 15×10 GBA screen, named A1, B1, A2… (letters go across, numbers go down), with real coordinates. Use these to rebuild the map in Porymap one screen at a time.
- **Placement table (CSV, or a printable page):** one row per thing, with its position and suggested Porymap fields:
  - `graphics_id`, `movement_type`, `trainer_type`, sight range, `script`, `flag` and `item`.
  - The Porymap list it belongs in, and its number in that list.

On iPad, exports open the share sheet. Choose **Save to Files**.

---

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

Whenever you push new code to GitHub, the hosted copy updates. The iPad picks up the new version the second time you open the app after an update.

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

## Known limitations (Milestone 2)

- **Routes only.** Generate works for routes. Towns, forests and caves arrive in Milestone 5, and until then those map types stay blank.
- **No stroke tools yet.** Painting is still the single-cell pencil. Stroke tools (paths, streams, tree walls…), "regenerate only part of the map" and the variations grid come in Milestone 3.
- **Basic entities only.** Generate places trainers, items, hidden items, Cut trees, Rock Smash rocks and a sign. Their field values are suggestions to check in Porymap. Other kinds, editing entities, and encounter tables come in Milestone 4.
- **No intentional unavoidable trainers.** Generated trainers can always be avoided. Marking an unavoidable battle as intended comes with the properties panel in Milestone 4.
- **Simplified movement checks.** Water currents count as plain Surf water (the forced movement is ignored). Elevation is only modelled for bridges. Both will be refined when caves and cliffs arrive.
- **Plain export text.** Labels in exported images use a small built-in pixel font, in capitals only.
- **Not tested on real Apple devices.** Testing used Chromium on Windows, including an iPad-sized viewport. Please try Generate and Export on the real iPad and in desktop Safari.
- **No resizing.** You can't change an existing map's size; create a new map instead.
- **Region view later.** The breadcrumb shows the region name, but the region sketch view arrives in Milestone 6.
- **Approximate screen frame.** The frame assumes the player stands 7 cells from the left and 4 from the top of the screen. This only affects the overlay.
- **Unconfirmed presets.** The forest, cave-floor and interior size presets are placeholders.
