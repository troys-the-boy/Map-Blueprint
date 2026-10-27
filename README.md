# Gen 3 Map Blueprint

A planning tool for a pokeemerald ROM hack. You lay out maps here as colored terrain blueprints, then rebuild them by hand in Porymap. It runs in your web browser, works offline, and never sends anything over the internet.

**Status:** Milestone 1 (Foundation) is done. You can create maps, paint terrain, and save and open projects. It runs on Windows, Mac and iPad. Map generation comes in Milestone 2.

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
4. **Turn on Pages:** in the repository on github.com, go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
5. Wait about two minutes. The **Actions** tab shows "Publish web app" with a green tick. Your tool is at `https://YOUR-NAME.github.io/map-blueprint/`.
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
| `npm run gen -- --config examples/route.json --seed 42` | Run the core with no browser (prints a project file; add `--out file.json` to save it) |

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

## Known limitations (Milestone 1)

- **No generation yet.** "New map" makes a blank map filled with ground. Generators, validation and exports start in Milestone 2.
- **Not tested on real Apple devices.** Testing used Chromium on Windows with an iPad-sized viewport and simulated Pencil and touch input. Please try it on the real iPad and in desktop Safari, and tell me anything that feels wrong.
- **No resizing.** You can't change an existing map's size; create a new map instead.
- **Region view later.** The breadcrumb shows the region name, but the region sketch view arrives in Milestone 6.
- **Approximate screen frame.** The frame assumes the player stands 7 cells from the left and 4 from the top of the screen. This only affects the overlay.
- **Unconfirmed presets.** The forest, cave-floor and interior size presets are placeholders.
