// The editor's state: the open project, the selected map and tool, undo/redo,
// unsaved-changes tracking and autosave.
//
// It lives outside React so the canvas can paint many cells per second without
// re-rendering the whole UI. React components subscribe through useStore();
// the canvas listens for cell changes through onCells().

import { useSyncExternalStore } from "react";
import type { AreaEdit, Edit, Entity, EntityKind, MapBlueprint, NewMapOptions, Opening, Region, Zone } from "../core/model";
import type { GenerateResult } from "../core/generate";
import { applyAreaResult, applyResult, areaInput, canGenerate, wholeMapInput } from "../core/generate";
import type { Area, Clip } from "../core/selection";
import {
  allArea,
  areaCellList,
  areaCells,
  clearArea,
  clipToMap,
  combineAreas,
  copyArea,
  growArea,
  inArea,
  invertArea,
  lassoArea,
  moveArea,
  pasteClip,
  rectFromCorners,
  wandArea,
} from "../core/selection";
import type { Direction } from "../core/terrain";
import { entityAt, newThing, setFacing, setSight, sightOf, turnClockwise } from "../core/things";
import type { SmartKind } from "../core/strokes";
import type { ZoneKind } from "../core/zones";
import { edgeBand, newZone, zoneLabel } from "../core/zones";
import type { Edge } from "../core/model";
import { AREA_KINDS, applySmartStroke, strokeWidth } from "../core/strokes";
import { hmsFor, readRouteParams } from "../core/generators/params";
import type { Issue } from "../core/validate";
import { validateMap } from "../core/validate";
import { runGenerate } from "./generation";
import { addNewMap, newRegion } from "../core/model";
import type { CellDiff } from "../core/paint";
import { applyDiff, brushCells, emptyDiff, lineCells, paintCell, paintElevation, paintLock } from "../core/paint";
import { parseProject, serializeProject } from "../core/project";
import { DEFAULT_FILL_TERRAIN, ELEVATION_LEVELS, TERRAIN_TYPES, requireTerrain } from "../core/terrain";
import type { Overlays, Prefs } from "./prefs";
import { loadPrefs, savePrefs } from "./prefs";

export const APP_VERSION = "0.1.0";

/**
 * "elevation" is the elevation brush: it paints elevation levels, leaving terrain alone.
 * "lock" is the lock brush. "select" draws a rectangle to copy, move or delete;
 * "lasso" draws any shape for the same; "wand" picks every joined cell of one terrain.
 * "things" places, drags, turns and removes trainers, items and so on.
 * "strokes" draws smart strokes: paths, streams, tree walls, grass, water, ledges.
 * "zones" paints the chosen zone (biome, water, edge, keep-clear) onto the map.
 */
export type Tool = "pencil" | "erase" | "pan" | "pick" | "elevation" | "lock" | "select" | "lasso" | "wand" | "things" | "strokes" | "zones";

/** How a new rectangle, lasso or wand pick changes the selection. */
export type SelectMode = "new" | "add" | "subtract";

/** What generating changes: "keep" leaves locked cells alone; "whole" replaces everything. */
export type GenerateMode = "keep" | "whole";

/** A copied area being placed: drawn over the map until it's put down. */
export interface Floating {
  clip: Clip;
  x: number;
  y: number;
  /** Where it was lifted from, for a move; null for a paste. */
  source: Area | null;
}

/** Everything Generate can change on a map, for undoing it. */
interface MapSnapshot {
  seed: number;
  terrain: Uint8Array;
  elevation: Uint8Array;
  locks: Uint8Array;
  entities: Entity[];
  openings: Opening[];
  zones: Zone[];
  params: MapBlueprint["params"];
}

/** One undoable action: a paint stroke, or a whole-map change such as Generate. */
type Command =
  | { type: "stroke"; mapId: string; diff: CellDiff; edit: Edit }
  | { type: "snapshot"; mapId: string; before: MapSnapshot; after: MapSnapshot; edits?: Edit[]; tag?: string };

function cloneZones(zones: Zone[]): Zone[] {
  return zones.map((z) => ({ ...z, mask: { ...z.mask, data: z.mask.data.slice() }, data: { ...z.data } }));
}

function snapshot(map: MapBlueprint): MapSnapshot {
  return {
    seed: map.seed,
    terrain: map.layers.terrain.data.slice(),
    elevation: map.layers.elevation.data.slice(),
    locks: map.layers.locks.data.slice(),
    entities: structuredClone(map.entities),
    openings: structuredClone(map.openings),
    zones: cloneZones(map.layers.zones),
    params: { ...map.params },
  };
}

function restore(map: MapBlueprint, snap: MapSnapshot) {
  map.seed = snap.seed;
  map.layers.terrain.data.set(snap.terrain);
  map.layers.elevation.data.set(snap.elevation);
  map.layers.locks.data.set(snap.locks);
  map.entities = structuredClone(snap.entities);
  map.openings = structuredClone(snap.openings);
  map.layers.zones = cloneZones(snap.zones);
  map.params = { ...snap.params };
}

interface Stroke {
  map: MapBlueprint;
  /** Terrain index, or elevation level index for the elevation brush. */
  value: number;
  lock: 0 | 1;
  tool: "pencil" | "erase" | "elevation" | "lock";
  diff: CellDiff;
  seen: Map<number, number>;
  cells: number[];
  last: [number, number] | null;
}

const AUTOSAVE_KEY = "g3mb.autosave.v1";
const UNDO_LIMIT = 300;

export interface AutosaveInfo {
  savedAt: string;
  dirty: boolean;
}

class EditorStore {
  region: Region = newRegion("Untitled region", 1);
  currentMapId: string | null = null;
  tool: Tool = "pencil";
  /** The tool to go back to after a one-off "pick" (eyedropper). */
  private toolBeforePick: Tool = "pencil";
  terrain = requireTerrain("tree");
  /** Level the elevation brush paints (index into ELEVATION_LEVELS). */
  elevationLevel = ELEVATION_LEVELS.indexOf("raised1");
  brush = 1;
  /** The zone the Zones tool paints into. */
  activeZoneId: string | null = null;
  /** Whether the Zones tool adds cells to the zone or takes them away. */
  zoneErase = false;
  /** What the Smart strokes tool draws. */
  smartKind: SmartKind = "path";
  /** Which way ledges drawn with Smart strokes jump ("auto" = from the line). */
  ledgeDir: "auto" | "s" | "e" | "w" = "auto";
  /** The smart stroke being drawn: the cells the pointer has passed, [x0, y0, x1, y1, …]. */
  smartPoints: number[] | null = null;
  /** What the Things tool places, or "remove" to take things away. */
  thingKind: EntityKind | "remove" = "trainer";
  /** Whether the lock brush locks or unlocks. */
  lockMode: "lock" | "unlock" = "lock";
  /** The selected rectangle (Select tool), if any. */
  selection: Area | null = null;
  /** The line being drawn with the Lasso, in cell coordinates. */
  lassoPoints: Array<[number, number]> | null = null;
  /** Whether a new shape replaces the selection, adds to it or takes away from it. */
  selectMode: SelectMode = "new";
  /** Magic wand: pick that terrain everywhere on the map, not just the joined patch. */
  wandEverywhere = false;
  /** The last copied area. */
  clipboard: Clip | null = null;
  /** An area being moved or pasted, not yet put down. */
  floating: Floating | null = null;
  /** ID of the thing picked with the Things tool. */
  selectedThing: string | null = null;
  /** What Generate changes (see GenerateMode). */
  generateMode: GenerateMode = "keep";
  /** Seeds generated this session, newest first, per map (to go back to one). */
  seedHistory = new Map<string, number[]>();
  /** A batch of variations: the same map generated with different seeds, to pick from. */
  variations: { mapId: string; mapVersion: number; items: Array<{ seed: number; result: GenerateResult }> } | null = null;
  /** True while variations are being made. */
  variationsBusy = false;
  prefs: Prefs = loadPrefs();
  /** True when there are changes not yet saved to a file. */
  dirty = false;
  /** Name used for the next save. */
  fileName: string | null = null;
  /** Save-in-place handle (Chrome/Edge File System Access API), if available. */
  fileHandle: unknown = null;
  /** A short message shown in the notice bar (errors, "restored from autosave"…). */
  notice: { kind: "info" | "error"; text: string } | null = null;
  /** Bumped on every change React needs to see. */
  version = 0;
  /** Validation results for the open map. */
  issues: Issue[] = [];
  /** True while Generate is running. */
  generating = false;
  /** Summary of the last Generate, for the panel. */
  lastGenerate: { mapId: string; attempts: number; ok: boolean } | null = null;
  /** A cell the canvas should scroll to (e.g. a clicked validation issue). */
  focus: { x: number; y: number; cells: number[]; seq: number } | null = null;
  /** Bumped when the map's terrain or things change, so overlays can refresh. */
  mapVersion = 0;

  private undoStacks = new Map<string, Command[]>();
  private redoStacks = new Map<string, Command[]>();
  private stroke: Stroke | null = null;
  private listeners = new Set<() => void>();
  private cellListeners = new Set<(mapId: string, indices: number[] | null) => void>();
  private autosaveTimer: ReturnType<typeof setTimeout> | null = null;
  private validateTimer: ReturnType<typeof setTimeout> | null = null;

  // ----- subscriptions -----------------------------------------------------

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getVersion = () => this.version;

  /** Called with changed cell indices, or null when the whole map must be redrawn. */
  onCells(fn: (mapId: string, indices: number[] | null) => void) {
    this.cellListeners.add(fn);
    return () => this.cellListeners.delete(fn);
  }

  private changed() {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  private cellsChanged(mapId: string, indices: number[] | null) {
    this.mapVersion++;
    for (const fn of this.cellListeners) fn(mapId, indices);
    this.scheduleValidate();
  }

  // ----- validation --------------------------------------------------------

  private scheduleValidate() {
    if (this.validateTimer) clearTimeout(this.validateTimer);
    this.validateTimer = setTimeout(() => this.validateNow(), 150);
  }

  /** Re-check the open map. Runs shortly after every change. */
  validateNow() {
    this.validateTimer = null;
    const map = this.currentMap;
    this.issues = map
      ? validateMap(map, { limits: this.region.settings.engineLimits, availableHms: hmsFor(readRouteParams(map.params), map.biome) })
      : [];
    this.changed();
  }

  /** Scroll the canvas to an issue and highlight its cells. */
  focusIssue(issue: Issue) {
    const map = this.currentMap;
    if (!map || !issue.cells.length) return;
    const c = issue.cells[0];
    this.focus = { x: c % map.width, y: Math.floor(c / map.width), cells: issue.cells, seq: (this.focus?.seq ?? 0) + 1 };
    this.changed();
  }

  // ----- generation --------------------------------------------------------

  /**
   * Generate the open map from its seed and settings (in the background).
   * By default locked cells and hand-placed things are kept ("keep"); in "whole" mode
   * everything is replaced and all locks are cleared. With `area`, only that rectangle
   * is made again, with a fresh random seed so each try looks different.
   */
  async generate(area: Area | null = null, joinUndo = false) {
    const map = this.currentMap;
    if (!map || this.generating || this.isStroking) return;
    if (!canGenerate(map)) {
      this.setNotice({ kind: "info", text: "Only routes can be generated so far. Towns, forests and caves arrive in Milestone 5." });
      return;
    }
    this.dropFloating();
    const whole = !area && this.generateMode === "whole";
    const input = area ? areaInput(map, area, randomSeed()) : this.fullInput(map);
    // Joining the undo step before only makes sense if nothing else happened meanwhile.
    const stepBefore = this.undoStacks.get(map.id)?.at(-1);
    this.generating = true;
    this.changed();
    let result: GenerateResult;
    try {
      result = await runGenerate(input, this.region.settings.engineLimits);
    } catch (err) {
      this.setNotice({ kind: "error", text: "Generation failed: " + (err instanceof Error ? err.message : String(err)) });
      return;
    } finally {
      this.generating = false;
      this.changed();
    }
    // The map may have been deleted while generating.
    const target = this.region.maps.find((m) => m.id === map.id);
    if (!target) return;
    // Filling a gap after a move: if the move was undone meanwhile, leave the map alone.
    if (joinUndo && this.undoStacks.get(target.id)?.at(-1) !== stepBefore) return;
    const before = snapshot(target);
    let edit: Edit | undefined;
    if (area) {
      applyAreaResult(target, area, result);
      edit = areaEdit(target, "regenerate", area);
      target.edits.push(edit);
    } else {
      applyResult(target, result);
      if (whole) target.layers.locks.data.fill(0);
    }
    this.selectedThing = null;
    this.pushUndo({ type: "snapshot", mapId: target.id, before, after: snapshot(target), edits: edit ? [edit] : [] }, joinUndo);
    this.lastGenerate = { mapId: target.id, attempts: result.attempts, ok: result.ok };
    if (!area) this.rememberSeed(target);
    this.markDirty();
    this.changed();
    this.cellsChanged(target.id, null);
  }

  /** What a whole-map Generate works from: the map, or with every lock cleared in "whole" mode. */
  private fullInput(map: MapBlueprint, seed = map.seed): MapBlueprint {
    const input = this.generateMode === "whole" ? wholeMapInput(map) : map;
    return seed === map.seed ? input : { ...input, seed };
  }

  private rememberSeed(map: MapBlueprint) {
    const list = (this.seedHistory.get(map.id) ?? []).filter((s) => s !== map.seed);
    list.unshift(map.seed);
    this.seedHistory.set(map.id, list.slice(0, 8));
  }

  /** Seeds generated for the open map this session, newest first. */
  get recentSeeds(): number[] {
    return this.seedHistory.get(this.currentMapId ?? "") ?? [];
  }

  /** A pinned seed can't be changed by New seed or the variations (until unpinned). */
  get seedPinned(): boolean {
    return this.currentMap?.params.seedPinned === true;
  }

  togglePinSeed() {
    const map = this.currentMap;
    if (!map) return;
    const params = { ...map.params };
    if (params.seedPinned === true) delete params.seedPinned;
    else params.seedPinned = true;
    map.params = params;
    this.markDirty();
    this.changed();
  }

  /** Pick a new random seed and generate (unless the seed is pinned). */
  async rerollSeed() {
    const map = this.currentMap;
    if (!map || this.seedPinned || this.generating) return;
    map.seed = randomSeed();
    this.changed();
    await this.generate();
  }

  /**
   * Make `count` variations: the map generated with new random seeds (keeping
   * locked cells, things you placed and zones, as Generate does). They run one
   * after another in the background and appear as they finish.
   */
  async makeVariations(count = 6) {
    const map = this.currentMap;
    if (!map || !canGenerate(map) || this.variationsBusy) return;
    this.dropFloating();
    this.variations = { mapId: map.id, mapVersion: this.mapVersion, items: [] };
    this.variationsBusy = true;
    this.changed();
    try {
      for (let k = 0; k < count; k++) {
        const seed = randomSeed();
        const result = await runGenerate(this.fullInput(map, seed), this.region.settings.engineLimits);
        // Stop if the batch was closed or replaced meanwhile.
        if (this.variations?.mapId !== map.id) return;
        this.variations.items.push({ seed, result });
        this.changed();
      }
    } catch (err) {
      this.setNotice({ kind: "error", text: "Making variations failed: " + (err instanceof Error ? err.message : String(err)) });
    } finally {
      this.variationsBusy = false;
      this.changed();
    }
  }

  /** True if the map was changed after the variations were made (they'd undo those changes). */
  get variationsStale(): boolean {
    return !!this.variations && this.variations.mapVersion !== this.mapVersion;
  }

  /** Use one of the variations: its seed becomes the map's seed (one undo step). */
  useVariation(index: number) {
    const map = this.currentMap;
    const v = this.variations;
    const item = v?.items[index];
    if (!map || !v || !item || v.mapId !== map.id) return;
    const before = snapshot(map);
    map.seed = item.seed;
    applyResult(map, item.result);
    if (this.generateMode === "whole") map.layers.locks.data.fill(0);
    this.selectedThing = null;
    this.pushUndo({ type: "snapshot", mapId: map.id, before, after: snapshot(map) });
    this.lastGenerate = { mapId: map.id, attempts: item.result.attempts, ok: item.result.ok };
    this.rememberSeed(map);
    this.variations = null;
    this.markDirty();
    this.changed();
    this.cellsChanged(map.id, null);
  }

  closeVariations() {
    this.variations = null;
    this.changed();
  }

  /** Change generator settings for the open map. */
  setGenerateMode(mode: GenerateMode) {
    this.generateMode = mode;
    this.changed();
  }

  setParams(patch: Record<string, string | number | boolean>) {
    const map = this.currentMap;
    if (!map) return;
    map.params = { ...map.params, ...patch };
    this.markDirty();
    this.changed();
    this.scheduleValidate();
  }

  setBiome(biome: MapBlueprint["biome"]) {
    const map = this.currentMap;
    if (!map) return;
    map.biome = biome;
    this.markDirty();
    this.changed();
  }

  setSeed(seed: number) {
    const map = this.currentMap;
    if (!map || this.seedPinned) return;
    map.seed = seed >>> 0;
    this.markDirty();
    this.changed();
  }

  /** Replace the open map's entrances (undoable). */
  setOpenings(openings: Opening[]) {
    const map = this.currentMap;
    if (!map) return;
    const before = snapshot(map);
    map.openings = openings;
    this.pushUndo({ type: "snapshot", mapId: map.id, before, after: snapshot(map) });
    this.markDirty();
    this.changed();
    this.cellsChanged(map.id, []);
  }

  private markDirty() {
    this.dirty = true;
    this.scheduleAutosave();
  }

  // ----- getters -----------------------------------------------------------

  get currentMap(): MapBlueprint | null {
    return this.region.maps.find((m) => m.id === this.currentMapId) ?? null;
  }

  canUndo() {
    return (this.undoStacks.get(this.currentMapId ?? "")?.length ?? 0) > 0;
  }
  canRedo() {
    return (this.redoStacks.get(this.currentMapId ?? "")?.length ?? 0) > 0;
  }

  // ----- tools and prefs ---------------------------------------------------

  setTool(tool: Tool) {
    if (tool === "pick" && this.tool !== "pick") this.toolBeforePick = this.tool;
    // Leaving the selection tools puts down anything still being placed.
    if (tool !== "select" && tool !== "lasso" && tool !== "wand") this.dropFloating();
    if (tool !== "things") this.selectedThing = null;
    this.tool = tool;
    this.showElevationFor(tool);
    this.changed();
  }

  setTerrain(index: number) {
    this.terrain = index;
    if (this.tool === "erase" || this.tool === "pan" || this.tool === "pick") this.tool = "pencil";
    this.changed();
  }

  /** Pick an elevation level and switch to the elevation brush. */
  setElevationLevel(level: number) {
    this.elevationLevel = level;
    this.tool = "elevation";
    this.showElevationFor("elevation");
    this.changed();
  }

  /** Painting blind is no use: the elevation brush shows elevation, the lock brush shows locks. */
  private showElevationFor(tool: Tool) {
    if (tool === "elevation" && !this.prefs.overlays.elevation) this.setOverlay("elevation", true);
    if (tool === "lock" && !this.prefs.overlays.locks) this.setOverlay("locks", true);
  }

  /** Choose what the Things tool places (or "remove"), and switch to it. */
  setThingKind(kind: EntityKind | "remove") {
    this.thingKind = kind;
    this.setTool("things");
  }

  /** Choose lock or unlock, and switch to the lock brush. */
  setLockMode(mode: "lock" | "unlock") {
    this.lockMode = mode;
    this.setTool("lock");
  }

  setBrush(size: number) {
    this.brush = Math.max(1, Math.min(5, size));
    this.changed();
  }

  updatePrefs(patch: Partial<Prefs>) {
    this.prefs = { ...this.prefs, ...patch };
    savePrefs(this.prefs);
    this.changed();
    if (patch.paletteId !== undefined || patch.overlays !== undefined) this.cellsChanged(this.currentMapId ?? "", null);
  }

  setOverlay(key: keyof Overlays, on: boolean) {
    this.updatePrefs({ overlays: { ...this.prefs.overlays, [key]: on } });
  }

  notePenSeen() {
    if (!this.prefs.penSeen) this.updatePrefs({ penSeen: true });
  }

  setNotice(notice: EditorStore["notice"]) {
    this.notice = notice;
    this.changed();
  }

  // ----- maps --------------------------------------------------------------

  /** Forget the selection, any paste in progress and the picked thing (they belong to one map). */
  private resetPicks() {
    this.selection = null;
    this.floating = null;
    this.grab = null;
    this.selectAnchor = null;
    this.lassoPoints = null;
    this.smartPoints = null;
    this.zonePaint = null;
    this.activeZoneId = null;
    this.variations = null;
    this.selectedThing = null;
    this.thingDrag = null;
  }

  openMap(id: string) {
    this.cancelStroke();
    this.resetPicks();
    this.currentMapId = id;
    this.changed();
    this.cellsChanged(id, null);
  }

  createMap(opts: NewMapOptions) {
    const map = addNewMap(this.region, opts);
    this.markDirty();
    this.openMap(map.id);
    return map;
  }

  renameMap(id: string, name: string) {
    const m = this.region.maps.find((x) => x.id === id);
    if (!m || !name.trim()) return;
    m.name = name.trim().slice(0, 100);
    this.markDirty();
    this.changed();
  }

  deleteMap(id: string) {
    this.cancelStroke();
    this.resetPicks();
    this.region.maps = this.region.maps.filter((m) => m.id !== id);
    this.undoStacks.delete(id);
    this.redoStacks.delete(id);
    if (this.currentMapId === id) this.currentMapId = this.region.maps[0]?.id ?? null;
    this.markDirty();
    this.changed();
    if (this.currentMapId) this.cellsChanged(this.currentMapId, null);
  }

  renameRegion(name: string) {
    if (!name.trim()) return;
    this.region.name = name.trim().slice(0, 100);
    this.markDirty();
    this.changed();
  }

  // ----- painting ----------------------------------------------------------

  /** Start a pencil/eraser stroke at a cell. */
  beginStroke(x: number, y: number) {
    const map = this.currentMap;
    if (!map || (this.tool !== "pencil" && this.tool !== "erase" && this.tool !== "elevation" && this.tool !== "lock")) return;
    const erase = this.tool === "erase";
    const lockTool = this.tool === "lock";
    this.stroke = {
      map,
      tool: this.tool,
      value: this.tool === "elevation" ? this.elevationLevel : erase || lockTool ? requireTerrain(DEFAULT_FILL_TERRAIN) : this.terrain,
      lock: lockTool ? (this.lockMode === "lock" ? 1 : 0) : erase ? 0 : this.prefs.lockWhenPainting ? 1 : 0,
      diff: emptyDiff(),
      seen: new Map(),
      cells: [],
      last: null,
    };
    this.strokeTo(x, y);
  }

  /** Continue the stroke to a cell, filling any gap since the last cell. */
  strokeTo(x: number, y: number) {
    const s = this.stroke;
    if (!s) return;
    const path = s.last ? lineCells(s.last[0], s.last[1], x, y) : [[x, y] as [number, number]];
    const changed: number[] = [];
    for (const [px, py] of path) {
      for (const [cx, cy] of brushCells(px, py, this.brush)) {
        if (cx < 0 || cy < 0 || cx >= s.map.width || cy >= s.map.height) continue;
        const painted =
          s.tool === "elevation"
            ? paintElevation(s.map, cx, cy, s.value, s.lock, s.diff, s.seen)
            : s.tool === "lock"
              ? paintLock(s.map, cx, cy, s.lock, s.diff, s.seen)
              : paintCell(s.map, cx, cy, s.value, s.lock, s.diff, s.seen);
        if (painted) {
          changed.push(cy * s.map.width + cx);
          s.cells.push(cx, cy);
        }
      }
    }
    s.last = [x, y];
    if (changed.length) this.cellsChanged(s.map.id, changed);
  }

  /** Finish the stroke: record it as an Edit and an undo step. */
  endStroke() {
    const s = this.stroke;
    this.stroke = null;
    if (!s || s.diff.index.length === 0) return;
    const edit: Edit =
      s.tool === "elevation"
        ? { type: "elevation", level: ELEVATION_LEVELS[s.value], brush: this.brush, locked: s.lock === 1, cells: s.cells }
        : s.tool === "lock"
          ? { type: "lock", locked: s.lock === 1, brush: this.brush, cells: s.cells }
          : { type: "stroke", tool: s.tool, terrain: TERRAIN_TYPES[s.value].id, brush: this.brush, locked: s.lock === 1, cells: s.cells };
    s.map.edits.push(edit);
    this.pushUndo({ type: "stroke", mapId: s.map.id, diff: s.diff, edit });
    this.markDirty();
    this.changed();
  }

  /** Throw away a stroke in progress (e.g. a second finger turned it into a pinch). */
  cancelStroke() {
    const s = this.stroke;
    this.stroke = null;
    if (!s || s.diff.index.length === 0) return;
    applyDiff(s.map, s.diff, "before");
    this.cellsChanged(s.map.id, s.diff.index);
  }

  get isStroking() {
    return this.stroke !== null;
  }

  /** Eyedropper: take the terrain of a cell, then go back to the previous tool. */
  pickAt(x: number, y: number) {
    const map = this.currentMap;
    if (!map || x < 0 || y < 0 || x >= map.width || y >= map.height) return;
    // Picking for the elevation brush takes the cell's elevation; otherwise its terrain.
    if (this.toolBeforePick === "elevation") this.elevationLevel = map.layers.elevation.data[y * map.width + x];
    else this.terrain = map.layers.terrain.data[y * map.width + x];
    this.tool = this.toolBeforePick === "pick" || this.toolBeforePick === "pan" ? "pencil" : this.toolBeforePick;
    this.changed();
  }

  // ----- Select tool -------------------------------------------------------

  /** The corner a new rectangle is dragged from. */
  private selectAnchor: [number, number] | null = null;
  /** Where in the floating area the pointer grabbed it, while dragging it. */
  private grab: [number, number] | null = null;
  /** Where the clipboard was copied from (for the edit record). */
  private clipboardFrom: Area | null = null;

  /** The selection before an add or subtract started, and which it is. */
  private selectBase: Area | null = null;
  private selectOp: SelectMode = "new";

  /** True for the tools that make selections. */
  get selecting() {
    return this.tool === "select" || this.tool === "lasso" || this.tool === "wand";
  }

  setSelectMode(mode: SelectMode) {
    this.selectMode = mode;
    this.changed();
  }

  setWandEverywhere(on: boolean) {
    this.wandEverywhere = on;
    this.changed();
  }

  /** The selection with a new shape applied: replacing it, added to it, or taken from it. */
  private applyShape(shape: Area | null): Area | null {
    const map = this.currentMap;
    if (!map || this.selectOp === "new") return shape;
    return combineAreas(map, this.selectBase, shape, this.selectOp);
  }

  /**
   * Pointer down with a selection tool. In New mode, pressing inside the selection
   * grabs it to move it (except with the magic wand); otherwise a new rectangle, lasso or wand pick starts.
   * Shift adds to the selection and Alt takes away, whatever the mode.
   */
  selectDown(x: number, y: number, keys: { add?: boolean; subtract?: boolean } = {}) {
    const map = this.currentMap;
    if (!map) return;
    this.selectOp = keys.subtract ? "subtract" : keys.add ? "add" : this.selectMode;
    this.selectBase = this.selection;
    const f = this.floating;
    if (f && inArea({ x: f.x, y: f.y, w: f.clip.w, h: f.clip.h, mask: f.clip.mask }, x, y)) {
      this.grab = [x - f.x, y - f.y];
      return;
    }
    // Tapping away from a paste puts it down where it is.
    if (f) this.dropFloating();
    const sel = this.selection;
    // (The magic wand always picks: a tap is a pick, never a move.)
    if (sel && this.selectOp === "new" && this.tool !== "wand" && inArea(sel, x, y)) {
      this.floating = { clip: copyArea(map, sel), x: sel.x, y: sel.y, source: sel };
      this.grab = [x - sel.x, y - sel.y];
      this.changed();
      return;
    }
    const cx = Math.max(0, Math.min(map.width - 1, x));
    const cy = Math.max(0, Math.min(map.height - 1, y));
    if (this.tool === "wand") {
      this.selection = this.applyShape(wandArea(map, cx, cy, this.wandEverywhere));
      this.changed();
      return;
    }
    if (this.tool === "lasso") {
      this.lassoPoints = [[cx + 0.5, cy + 0.5]];
      // A new lasso replaces the selection; while adding or subtracting, the old one stays in view.
      if (this.selectOp === "new") this.selection = null;
      this.changed();
      return;
    }
    this.selectAnchor = [cx, cy];
    this.selection = this.applyShape({ x: cx, y: cy, w: 1, h: 1 });
    this.changed();
  }

  selectMove(x: number, y: number) {
    const map = this.currentMap;
    if (!map) return;
    const f = this.floating;
    if (f && this.grab) {
      const nx = x - this.grab[0];
      const ny = y - this.grab[1];
      if (nx !== f.x || ny !== f.y) {
        f.x = nx;
        f.y = ny;
        this.changed();
      }
      return;
    }
    const pts = this.lassoPoints;
    if (pts) {
      const last = pts[pts.length - 1];
      const px = Math.max(0, Math.min(map.width - 1, x)) + 0.5;
      const py = Math.max(0, Math.min(map.height - 1, y)) + 0.5;
      if (last[0] !== px || last[1] !== py) {
        pts.push([px, py]);
        this.changed();
      }
      return;
    }
    if (this.selectAnchor) {
      const r = clipToMap(map, rectFromCorners(this.selectAnchor[0], this.selectAnchor[1], x, y));
      const last = this.lastRect;
      if (r && (r.x !== last?.x || r.y !== last.y || r.w !== last.w || r.h !== last.h)) {
        this.lastRect = r;
        this.selection = this.applyShape(r);
        this.changed();
      }
    }
  }

  /** The rectangle being dragged, so the selection is only worked out again when it changes. */
  private lastRect: Area | null = null;

  selectUp() {
    this.selectAnchor = null;
    this.lastRect = null;
    const map = this.currentMap;
    if (this.lassoPoints && map) {
      // Close the lasso: everything inside the line is selected (or added, or taken away).
      this.selection = this.applyShape(lassoArea(map, this.lassoPoints));
      this.lassoPoints = null;
      this.changed();
    }
    const moving = this.grab !== null && this.floating?.source;
    this.grab = null;
    // A move is put down as soon as it's let go; a paste waits for Place (or a tap elsewhere).
    if (moving) this.dropFloating();
  }

  /** Put down the area being moved or pasted. */
  dropFloating() {
    const f = this.floating;
    const map = this.currentMap;
    this.floating = null;
    this.grab = null;
    if (!f || !map) return;
    if (f.source && f.source.x === f.x && f.source.y === f.y) {
      this.changed();
      return;
    }
    const before = snapshot(map);
    const area = f.source ? moveArea(map, f.source, f.x, f.y) : pasteClip(map, f.clip, f.x, f.y, true);
    if (!area) {
      // Dragged right off the map: nothing to put down.
      if (f.source) restore(map, before);
      this.changed();
      return;
    }
    const edit = areaEdit(map, f.source ? "move" : "paste", f.source ?? this.clipboardFrom ?? area, area.x, area.y);
    map.edits.push(edit);
    this.selection = area;
    this.pushUndo({ type: "snapshot", mapId: map.id, before, after: snapshot(map), edits: [edit] });
    this.markDirty();
    this.changed();
    this.cellsChanged(map.id, null);
    if (f.source) this.fillGap(f.source);
  }

  /**
   * After a move, cut or delete, fill the plain ground left behind with generated
   * terrain (unless the "Fill gaps with" choice is plain ground). Cells that are
   * locked, such as the moved area if it overlaps, are kept. One Undo undoes both.
   */
  private fillGap(area: Area) {
    const map = this.currentMap;
    if (!map || this.prefs.gapFill !== "regenerate" || !canGenerate(map)) return;
    void this.generate(area, true);
  }

  setGapFill(fill: "ground" | "regenerate") {
    this.updatePrefs({ gapFill: fill });
  }

  /** Throw away a paste that hasn't been put down (Escape). */
  cancelFloating() {
    this.floating = null;
    this.grab = null;
    this.changed();
  }

  /** Grow the selection by one cell all round (by = 1), or shrink it (by = -1). */
  growSelection(by: number) {
    const map = this.currentMap;
    if (!map || !this.selection) return;
    this.dropFloating();
    this.selection = growArea(map, this.selection, by);
    this.changed();
  }

  /** Select everything that isn't selected (everything, if nothing is). */
  invertSelection() {
    const map = this.currentMap;
    if (!map) return;
    this.dropFloating();
    this.selection = invertArea(map, this.selection);
    if (!this.selecting) this.setTool("select");
    this.changed();
  }

  selectAll() {
    const map = this.currentMap;
    if (!map) return;
    this.dropFloating();
    this.selection = allArea(map);
    if (!this.selecting) this.setTool("select");
    this.changed();
  }

  /** Escape: cancel a paste, or else clear the selection. */
  clearSelection() {
    if (this.floating) return this.cancelFloating();
    this.selection = null;
    this.changed();
  }

  copySelection() {
    const map = this.currentMap;
    if (!map || !this.selection) return;
    this.clipboard = copyArea(map, this.selection);
    this.clipboardFrom = this.selection;
    this.changed();
  }

  cutSelection() {
    this.copySelection();
    this.deleteSelection();
  }

  /** Clear the selected area to plain ground and remove the things in it. */
  deleteSelection() {
    const map = this.currentMap;
    const area = this.selection;
    if (!map || !area) return;
    this.dropFloating();
    const before = snapshot(map);
    clearArea(map, area);
    const edit = areaEdit(map, "delete", area);
    map.edits.push(edit);
    this.pushUndo({ type: "snapshot", mapId: map.id, before, after: snapshot(map), edits: [edit] });
    this.markDirty();
    this.changed();
    this.cellsChanged(map.id, null);
    this.fillGap(area);
  }

  /** Start placing the clipboard, centred on a cell (or over the selection). Drag it, then Place. */
  paste(at: [number, number] | null = null) {
    const map = this.currentMap;
    const clip = this.clipboard;
    if (!map || !clip) return;
    this.dropFloating();
    if (!this.selecting) this.setTool("select");
    const x = at ? at[0] - Math.floor(clip.w / 2) : (this.selection?.x ?? 0);
    const y = at ? at[1] - Math.floor(clip.h / 2) : (this.selection?.y ?? 0);
    this.floating = { clip, x, y, source: null };
    this.selection = null;
    this.changed();
  }

  /** Make the selected area again with the generator (a new look each time). */
  regenerateSelection() {
    if (this.selection) void this.generate(this.selection);
  }

  /**
   * Change every cell of the selection at once: fill it with one terrain (locked,
   * like painting, if "Lock what I paint" is on), set its elevation, or lock or
   * unlock it. Things in it stay where they are.
   */
  changeSelection(change: { fill: number } | { elevation: number } | { lock: boolean }) {
    const map = this.currentMap;
    const area = this.selection;
    if (!map || !area) return;
    this.dropFloating();
    const before = snapshot(map);
    const cells = areaCells(map, area);
    let edit: AreaEdit;
    if ("fill" in change) {
      const lock = this.prefs.lockWhenPainting ? 1 : null;
      for (const i of cells) {
        map.layers.terrain.data[i] = change.fill;
        if (lock !== null) map.layers.locks.data[i] = lock;
      }
      edit = areaEdit(map, "fill", area, null, null, TERRAIN_TYPES[change.fill].id);
    } else if ("elevation" in change) {
      for (const i of cells) map.layers.elevation.data[i] = change.elevation;
      edit = areaEdit(map, "elevation", area, null, null, ELEVATION_LEVELS[change.elevation]);
      this.showElevationFor("elevation");
    } else {
      for (const i of cells) map.layers.locks.data[i] = change.lock ? 1 : 0;
      edit = areaEdit(map, change.lock ? "lock" : "unlock", area);
      if (!this.prefs.overlays.locks) this.setOverlay("locks", true);
    }
    map.edits.push(edit);
    this.pushUndo({ type: "snapshot", mapId: map.id, before, after: snapshot(map), edits: [edit] });
    this.markDirty();
    this.changed();
    this.cellsChanged(map.id, cells);
  }

  // ----- Zones -------------------------------------------------------------

  get activeZone(): Zone | null {
    return this.currentMap?.layers.zones.find((z) => z.id === this.activeZoneId) ?? null;
  }

  /** Make a zone change undoable. Repeated changes with the same tag (e.g. dragging a slider) are one step. */
  private zoneStep(map: MapBlueprint, before: MapSnapshot, tag?: string) {
    const undo = this.undoStacks.get(map.id);
    const prev = undo?.[undo.length - 1];
    const join = !!tag && prev?.type === "snapshot" && prev.tag === tag;
    this.pushUndo({ type: "snapshot", mapId: map.id, before, after: snapshot(map), tag }, join);
    this.markDirty();
    this.changed();
    this.cellsChanged(map.id, []);
  }

  /** Start a new zone and pick it for painting. With `cells`, it starts with those cells. */
  addZone(kind: ZoneKind, data: Zone["data"] = {}, cells: number[] = []) {
    const map = this.currentMap;
    if (!map) return null;
    const before = snapshot(map);
    const z = newZone(map, kind, data);
    for (const i of cells) z.mask.data[i] = 1;
    map.layers.zones.push(z);
    this.activeZoneId = z.id;
    this.zoneErase = false;
    if (!this.prefs.overlays.zones) this.setOverlay("zones", true);
    if (!cells.length) this.setTool("zones");
    this.zoneStep(map, before);
    return z;
  }

  /** A boundary along part of a map edge, e.g. "east edge is coast from y 10 to y 40, 8 deep". */
  addEdgeZone(boundary: string, edge: Edge, from: number, to: number, depth: number) {
    const map = this.currentMap;
    if (!map) return;
    this.addZone("edge", { boundary }, edgeBand(map, edge, from, to, depth));
  }

  /** Change a zone's settings (soft/hard, fuzziness, biome, water type…). */
  updateZone(id: string, patch: Partial<Pick<Zone, "hard" | "fuzziness">> & { data?: Zone["data"] }) {
    const map = this.currentMap;
    const z = map?.layers.zones.find((k) => k.id === id);
    if (!map || !z) return;
    const before = snapshot(map);
    if (patch.hard !== undefined) z.hard = patch.hard;
    if (patch.fuzziness !== undefined) z.fuzziness = Math.max(0, Math.min(1, patch.fuzziness));
    if (patch.data) {
      z.data = { ...z.data, ...patch.data };
      z.name = zoneLabel(z);
    }
    this.zoneStep(map, before, `zone:${id}:${Object.keys(patch).join(",")}`);
  }

  deleteZone(id: string) {
    const map = this.currentMap;
    if (!map) return;
    const before = snapshot(map);
    map.layers.zones = map.layers.zones.filter((z) => z.id !== id);
    if (this.activeZoneId === id) this.activeZoneId = null;
    this.zoneStep(map, before);
  }

  /** Pick a zone to paint into (Zones tool). */
  setActiveZone(id: string | null) {
    this.activeZoneId = id;
    if (id) this.setTool("zones");
    this.changed();
  }

  setZoneErase(erase: boolean) {
    this.zoneErase = erase;
    this.changed();
  }

  /** Add the selected cells to the zone being painted (or take them away, in erase mode). */
  selectionToZone() {
    const map = this.currentMap;
    const z = this.activeZone;
    if (!map || !z || !this.selection) return;
    const before = snapshot(map);
    for (const i of areaCells(map, this.selection)) z.mask.data[i] = this.zoneErase ? 0 : 1;
    this.zoneStep(map, before);
  }

  private zonePaint: { before: MapSnapshot; last: [number, number] | null } | null = null;

  zoneDown(x: number, y: number) {
    const map = this.currentMap;
    if (!map || !this.activeZone) {
      this.setNotice({ kind: "info", text: "Pick a zone in the Zones tab first (or start a new one), then paint it on the map." });
      return;
    }
    this.zonePaint = { before: snapshot(map), last: null };
    this.zoneMove(x, y);
  }

  zoneMove(x: number, y: number) {
    const map = this.currentMap;
    const z = this.activeZone;
    const p = this.zonePaint;
    if (!map || !z || !p) return;
    const path = p.last ? lineCells(p.last[0], p.last[1], x, y) : [[x, y] as [number, number]];
    for (const [px, py] of path)
      for (const [cx, cy] of brushCells(px, py, this.brush)) if (cx >= 0 && cy >= 0 && cx < map.width && cy < map.height) z.mask.data[cy * map.width + cx] = this.zoneErase ? 0 : 1;
    p.last = [x, y];
    this.cellsChanged(map.id, []);
  }

  zoneUp(cancelled = false) {
    const map = this.currentMap;
    const p = this.zonePaint;
    this.zonePaint = null;
    if (!map || !p) return;
    if (cancelled) {
      restore(map, p.before);
      this.cellsChanged(map.id, []);
      return;
    }
    this.zoneStep(map, p.before);
  }

  // ----- Smart strokes tool ------------------------------------------------

  setSmartKind(kind: SmartKind) {
    this.smartKind = kind;
    this.setTool("strokes");
  }

  setLedgeDir(dir: "auto" | "s" | "e" | "w") {
    this.ledgeDir = dir;
    this.changed();
  }

  /** How wide the current smart stroke is drawn (for the preview too). */
  get smartWidth(): number {
    const map = this.currentMap;
    return strokeWidth(this.smartKind, this.brush, map ? readRouteParams(map.params).pathWidthMin : 2);
  }

  smartDown(x: number, y: number) {
    const map = this.currentMap;
    if (!map) return;
    this.smartPoints = [Math.max(0, Math.min(map.width - 1, x)), Math.max(0, Math.min(map.height - 1, y))];
    this.changed();
  }

  smartMove(x: number, y: number) {
    const map = this.currentMap;
    const pts = this.smartPoints;
    if (!map || !pts) return;
    const px = Math.max(0, Math.min(map.width - 1, x));
    const py = Math.max(0, Math.min(map.height - 1, y));
    if (pts[pts.length - 2] === px && pts[pts.length - 1] === py) return;
    pts.push(px, py);
    this.changed();
  }

  /** Let go: make the drawn line or outline valid and paint it (one undo step). */
  smartUp(cancelled = false) {
    const map = this.currentMap;
    const points = this.smartPoints;
    this.smartPoints = null;
    this.changed();
    if (!map || !points || cancelled) return;
    const kind = this.smartKind;
    const edit: Edit = {
      type: "smart",
      kind,
      width: AREA_KINDS.has(kind) ? 1 : this.smartWidth,
      direction: kind === "ledge" && this.ledgeDir !== "auto" ? this.ledgeDir : null,
      points,
    };
    const diff = emptyDiff();
    applySmartStroke(map, edit, diff, new Map());
    if (!diff.index.length) return;
    map.edits.push(edit);
    this.pushUndo({ type: "stroke", mapId: map.id, diff, edit });
    this.markDirty();
    this.changed();
    this.cellsChanged(map.id, diff.index);
  }

  // ----- Things tool -------------------------------------------------------

  private thingDrag: { id: string; before: MapSnapshot; moved: boolean; wasSelected: boolean } | null = null;

  get selectedEntity(): Entity | null {
    return this.currentMap?.entities.find((e) => e.id === this.selectedThing) ?? null;
  }

  /** Pointer down with the Things tool: pick up a thing, place a new one, or remove one. */
  thingsDown(x: number, y: number) {
    const map = this.currentMap;
    if (!map || x < 0 || y < 0 || x >= map.width || y >= map.height) return;
    const hit = entityAt(map, x, y);
    if (this.thingKind === "remove") {
      if (!hit) return;
      const before = snapshot(map);
      map.entities = map.entities.filter((e) => e !== hit);
      if (this.selectedThing === hit.id) this.selectedThing = null;
      this.finishThing(map, before, { type: "entity", action: "delete", id: hit.id, kind: hit.kind, x, y });
      return;
    }
    if (hit) {
      this.thingDrag = { id: hit.id, before: snapshot(map), moved: false, wasSelected: this.selectedThing === hit.id };
      this.selectedThing = hit.id;
      this.changed();
      return;
    }
    const before = snapshot(map);
    const e = newThing(map, this.thingKind, x, y);
    map.entities.push(e);
    map.layers.locks.data[y * map.width + x] = 1;
    this.selectedThing = e.id;
    this.finishThing(map, before, { type: "entity", action: "place", id: e.id, kind: e.kind, x, y });
  }

  /** Drag the picked-up thing; its sight line follows. */
  thingsMove(x: number, y: number) {
    const map = this.currentMap;
    const d = this.thingDrag;
    if (!map || !d) return;
    const e = map.entities.find((k) => k.id === d.id);
    if (!e || x < 0 || y < 0 || x >= map.width || y >= map.height || (e.x === x && e.y === y) || entityAt(map, x, y)) return;
    e.x = x;
    e.y = y;
    d.moved = true;
    this.cellsChanged(map.id, []);
  }

  /** Let go: a drag moves the thing (and locks it there); a tap on a picked trainer turns it. */
  thingsUp() {
    const map = this.currentMap;
    const d = this.thingDrag;
    this.thingDrag = null;
    if (!map || !d) return;
    const e = map.entities.find((k) => k.id === d.id);
    if (!e) return;
    if (d.moved) {
      e.locked = true;
      e.elevation = ELEVATION_LEVELS[map.layers.elevation.data[e.y * map.width + e.x]];
      map.layers.locks.data[e.y * map.width + e.x] = 1;
      this.finishThing(map, d.before, { type: "entity", action: "move", id: e.id, kind: e.kind, x: e.x, y: e.y });
    } else if (d.wasSelected && e.kind === "trainer") {
      turnClockwise(e);
      e.locked = true;
      this.finishThing(map, d.before, { type: "entity", action: "turn", id: e.id, kind: e.kind, x: e.x, y: e.y });
    }
  }

  /** Face the picked trainer one way, or "all" to look around. */
  turnThing(dir: Direction | "all") {
    const map = this.currentMap;
    const e = this.selectedEntity;
    if (!map || !e || e.kind !== "trainer") return;
    const before = snapshot(map);
    setFacing(e, dir);
    e.locked = true;
    this.finishThing(map, before, { type: "entity", action: "turn", id: e.id, kind: e.kind, x: e.x, y: e.y });
  }

  /** Turn the picked trainer a quarter turn clockwise (R). */
  turnClockwise() {
    const map = this.currentMap;
    const e = this.selectedEntity;
    if (!map || !e || e.kind !== "trainer") return;
    const before = snapshot(map);
    turnClockwise(e);
    e.locked = true;
    this.finishThing(map, before, { type: "entity", action: "turn", id: e.id, kind: e.kind, x: e.x, y: e.y });
  }

  /** Lengthen or shorten the picked trainer's sight line. */
  changeSight(delta: number) {
    const map = this.currentMap;
    const e = this.selectedEntity;
    if (!map || !e || e.kind !== "trainer") return;
    const before = snapshot(map);
    setSight(e, sightOf(e) + delta);
    e.locked = true;
    this.finishThing(map, before, { type: "entity", action: "sight", id: e.id, kind: e.kind, x: e.x, y: e.y });
  }

  deleteThing() {
    const map = this.currentMap;
    const e = this.selectedEntity;
    if (!map || !e) return;
    const before = snapshot(map);
    map.entities = map.entities.filter((k) => k !== e);
    this.selectedThing = null;
    this.finishThing(map, before, { type: "entity", action: "delete", id: e.id, kind: e.kind, x: e.x, y: e.y });
  }

  private finishThing(map: MapBlueprint, before: MapSnapshot, edit: Edit & { type: "entity" }) {
    map.edits.push(edit);
    this.pushUndo({ type: "snapshot", mapId: map.id, before, after: snapshot(map), edits: [edit] });
    this.markDirty();
    this.changed();
    this.cellsChanged(map.id, [edit.y * map.width + edit.x]);
  }

  // ----- undo / redo -------------------------------------------------------

  /** Add an undo step. With `join`, it merges into the step before (one Undo undoes both). */
  private pushUndo(cmd: Command, join = false) {
    const undo = this.undoStacks.get(cmd.mapId) ?? [];
    const prev = undo[undo.length - 1];
    if (join && prev?.type === "snapshot" && cmd.type === "snapshot") {
      undo[undo.length - 1] = { ...cmd, before: prev.before, edits: [...(prev.edits ?? []), ...(cmd.edits ?? [])] };
      this.redoStacks.set(cmd.mapId, []);
      return;
    }
    undo.push(cmd);
    if (undo.length > UNDO_LIMIT) undo.shift();
    this.undoStacks.set(cmd.mapId, undo);
    this.redoStacks.set(cmd.mapId, []);
  }

  undo() {
    const map = this.currentMap;
    if (!map || this.stroke) return;
    const cmd = this.undoStacks.get(map.id)?.pop();
    if (!cmd) return;
    if (cmd.type === "stroke") {
      applyDiff(map, cmd.diff, "before");
      const i = map.edits.lastIndexOf(cmd.edit);
      if (i >= 0) map.edits.splice(i, 1);
    } else {
      restore(map, cmd.before);
      for (const e of cmd.edits ?? []) {
        const i = map.edits.lastIndexOf(e);
        if (i >= 0) map.edits.splice(i, 1);
      }
    }
    this.floating = null;
    if (this.selectedThing && !map.entities.some((e) => e.id === this.selectedThing)) this.selectedThing = null;
    (this.redoStacks.get(map.id) ?? this.redoStacks.set(map.id, []).get(map.id)!).push(cmd);
    this.cellsChanged(map.id, cmd.type === "stroke" ? cmd.diff.index : null);
    this.markDirty();
    this.changed();
  }

  redo() {
    const map = this.currentMap;
    if (!map || this.stroke) return;
    const cmd = this.redoStacks.get(map.id)?.pop();
    if (!cmd) return;
    if (cmd.type === "stroke") {
      applyDiff(map, cmd.diff, "after");
      map.edits.push(cmd.edit);
    } else {
      restore(map, cmd.after);
      map.edits.push(...(cmd.edits ?? []));
    }
    this.floating = null;
    if (this.selectedThing && !map.entities.some((e) => e.id === this.selectedThing)) this.selectedThing = null;
    (this.undoStacks.get(map.id) ?? this.undoStacks.set(map.id, []).get(map.id)!).push(cmd);
    this.cellsChanged(map.id, cmd.type === "stroke" ? cmd.diff.index : null);
    this.markDirty();
    this.changed();
  }

  // ----- whole project -----------------------------------------------------

  /** Replace the whole project (after New or Open). */
  loadRegion(region: Region, fileName: string | null, fileHandle: unknown = null, dirty = false) {
    this.cancelStroke();
    this.resetPicks();
    this.region = region;
    this.currentMapId = region.maps[0]?.id ?? null;
    this.undoStacks.clear();
    this.redoStacks.clear();
    this.fileName = fileName;
    this.fileHandle = fileHandle;
    this.dirty = dirty;
    this.changed();
    if (this.currentMapId) this.cellsChanged(this.currentMapId, null);
    this.scheduleAutosave();
  }

  newProject() {
    this.loadRegion(newRegion("Untitled region", Math.floor(Math.random() * 0xffffffff)), null);
  }

  serialize(): string {
    return serializeProject(this.region, APP_VERSION);
  }

  markSaved(fileName: string, fileHandle: unknown = this.fileHandle) {
    this.dirty = false;
    this.fileName = fileName;
    this.fileHandle = fileHandle;
    this.changed();
    this.scheduleAutosave();
  }

  // ----- autosave ----------------------------------------------------------

  private scheduleAutosave() {
    if (this.autosaveTimer) clearTimeout(this.autosaveTimer);
    this.autosaveTimer = setTimeout(() => this.autosaveNow(), 1200);
  }

  /** Save a convenience copy to browser storage. Not a replacement for saving a file. */
  autosaveNow() {
    this.autosaveTimer = null;
    try {
      const payload = JSON.stringify({
        savedAt: new Date().toISOString(),
        dirty: this.dirty,
        fileName: this.fileName,
        currentMapId: this.currentMapId,
        project: this.serialize(),
      });
      localStorage.setItem(AUTOSAVE_KEY, payload);
    } catch {
      // Storage full or blocked. The user still has Save; nothing else to do.
    }
  }

  /** Restore the autosaved project, if there is one. Returns info for the notice, or null. */
  restoreAutosave(): AutosaveInfo | null {
    try {
      const raw = localStorage.getItem(AUTOSAVE_KEY);
      if (!raw) return null;
      const saved = JSON.parse(raw) as { savedAt: string; dirty: boolean; fileName: string | null; currentMapId: string | null; project: string };
      const region = parseProject(saved.project);
      this.loadRegion(region, typeof saved.fileName === "string" ? saved.fileName : null, null, saved.dirty === true);
      if (saved.currentMapId && region.maps.some((m) => m.id === saved.currentMapId)) this.openMap(saved.currentMapId);
      return { savedAt: String(saved.savedAt), dirty: saved.dirty === true };
    } catch {
      return null;
    }
  }
}

export const store = new EditorStore();
export type { EditorStore };

/** React hook: re-render when the store changes. */
export function useStore(): EditorStore {
  useSyncExternalStore(store.subscribe, store.getVersion);
  return store;
}

/** A fresh random seed (for regenerating an area: each try looks different). */
function randomSeed(): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0];
}

/** The record of a selection action: its rectangle, plus the exact cells for a lasso shape. */
function areaEdit(map: MapBlueprint, action: AreaEdit["action"], area: Area, toX: number | null = null, toY: number | null = null, value?: string): AreaEdit {
  const edit: AreaEdit = { type: "area", action, area: { x: area.x, y: area.y, w: area.w, h: area.h }, toX, toY };
  if (area.mask) edit.cells = areaCellList(map, area);
  if (value !== undefined) edit.value = value;
  return edit;
}
