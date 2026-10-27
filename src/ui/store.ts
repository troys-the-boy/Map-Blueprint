// The editor's state: the open project, the selected map and tool, undo/redo,
// unsaved-changes tracking and autosave.
//
// It lives outside React so the canvas can paint many cells per second without
// re-rendering the whole UI. React components subscribe through useStore();
// the canvas listens for cell changes through onCells().

import { useSyncExternalStore } from "react";
import type { MapBlueprint, NewMapOptions, Region, StrokeEdit } from "../core/model";
import { addNewMap, newRegion } from "../core/model";
import type { CellDiff } from "../core/paint";
import { applyDiff, brushCells, emptyDiff, lineCells, paintCell } from "../core/paint";
import { parseProject, serializeProject } from "../core/project";
import { DEFAULT_FILL_TERRAIN, TERRAIN_TYPES, requireTerrain } from "../core/terrain";
import type { Overlays, Prefs } from "./prefs";
import { loadPrefs, savePrefs } from "./prefs";

export const APP_VERSION = "0.1.0";

export type Tool = "pencil" | "erase" | "pan" | "pick";

/** One undoable action. */
interface Command {
  mapId: string;
  diff: CellDiff;
  edit: StrokeEdit;
}

interface Stroke {
  map: MapBlueprint;
  terrain: number;
  lock: 0 | 1;
  tool: "pencil" | "erase";
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
  brush = 1;
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

  private undoStacks = new Map<string, Command[]>();
  private redoStacks = new Map<string, Command[]>();
  private stroke: Stroke | null = null;
  private listeners = new Set<() => void>();
  private cellListeners = new Set<(mapId: string, indices: number[] | null) => void>();
  private autosaveTimer: ReturnType<typeof setTimeout> | null = null;

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
    for (const fn of this.cellListeners) fn(mapId, indices);
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
    this.tool = tool;
    this.changed();
  }

  setTerrain(index: number) {
    this.terrain = index;
    if (this.tool === "erase" || this.tool === "pan" || this.tool === "pick") this.tool = "pencil";
    this.changed();
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

  openMap(id: string) {
    this.cancelStroke();
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
    if (!map || (this.tool !== "pencil" && this.tool !== "erase")) return;
    const erase = this.tool === "erase";
    this.stroke = {
      map,
      tool: erase ? "erase" : "pencil",
      terrain: erase ? requireTerrain(DEFAULT_FILL_TERRAIN) : this.terrain,
      lock: erase ? 0 : this.prefs.lockWhenPainting ? 1 : 0,
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
        if (paintCell(s.map, cx, cy, s.terrain, s.lock, s.diff, s.seen)) {
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
    const edit: StrokeEdit = {
      type: "stroke",
      tool: s.tool,
      terrain: TERRAIN_TYPES[s.terrain].id,
      brush: this.brush,
      locked: s.lock === 1,
      cells: s.cells,
    };
    s.map.edits.push(edit);
    this.pushUndo({ mapId: s.map.id, diff: s.diff, edit });
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
    this.terrain = map.layers.terrain.data[y * map.width + x];
    this.tool = this.toolBeforePick === "pick" || this.toolBeforePick === "pan" ? "pencil" : this.toolBeforePick;
    this.changed();
  }

  // ----- undo / redo -------------------------------------------------------

  private pushUndo(cmd: Command) {
    const undo = this.undoStacks.get(cmd.mapId) ?? [];
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
    applyDiff(map, cmd.diff, "before");
    const i = map.edits.lastIndexOf(cmd.edit);
    if (i >= 0) map.edits.splice(i, 1);
    (this.redoStacks.get(map.id) ?? this.redoStacks.set(map.id, []).get(map.id)!).push(cmd);
    this.cellsChanged(map.id, cmd.diff.index);
    this.markDirty();
    this.changed();
  }

  redo() {
    const map = this.currentMap;
    if (!map || this.stroke) return;
    const cmd = this.redoStacks.get(map.id)?.pop();
    if (!cmd) return;
    applyDiff(map, cmd.diff, "after");
    map.edits.push(cmd.edit);
    (this.undoStacks.get(map.id) ?? this.undoStacks.set(map.id, []).get(map.id)!).push(cmd);
    this.cellsChanged(map.id, cmd.diff.index);
    this.markDirty();
    this.changed();
  }

  // ----- whole project -----------------------------------------------------

  /** Replace the whole project (after New or Open). */
  loadRegion(region: Region, fileName: string | null, fileHandle: unknown = null, dirty = false) {
    this.cancelStroke();
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
