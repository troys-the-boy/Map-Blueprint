// The region sketch editor's state: the tool, what's picked, the shape being
// drawn, and undo. It changes store.region.sketch (see core/sketch.ts) and tells
// the store, which re-renders the panels; the sketch canvas redraws on every
// change too.
//
// Positions come in from the canvas in metatiles (fractions allowed); shapes
// snap to the sketch grid.

import type { Sketch, SketchArea, SketchPlace, SketchRect } from "../core/sketch";
import {
  SKETCH_AREAS,
  SKETCH_CELL,
  addInside,
  addOutdoor,
  cloneSketch,
  inRect,
  isOutdoor,
  outdoorPlaceAt,
  paintAreas,
  rectBetween,
  snap,
  touching,
} from "../core/sketch";
import { store } from "./store";
import type { Hm } from "../core/constants";
import type { ProgressionStep } from "../core/model";
import type { SectionOverride } from "../core/regionMap";
import { draftRegionMap, sectionAt, sectionCells } from "../core/regionMap";

export type SketchTool = "select" | "town" | "route" | "forest" | "cave" | "pin" | "paint" | "erase" | "river" | "pan" | "underlay" | "calibrate" | "sections" | "journey";

/** One undo step: the sketch, plus the region's progression steps and level curve (the journey uses them). */
interface Snap {
  sketch: Sketch;
  progression: ProgressionStep[];
  curve: { start: number; end: number };
}

const UNDO_LIMIT = 100;

type Drag =
  | { kind: "move"; placeId: string; startX: number; startY: number; rects: SketchRect[]; pins: Array<{ x: number; y: number }>; moved: boolean }
  | { kind: "resize"; placeId: string; rect: number; corner: 0 | 1 | 2 | 3; moved: boolean }
  | { kind: "pin"; placeId: string; pin: number; moved: boolean }
  | { kind: "paint"; value: number; changed: boolean; x: number; y: number }
  | { kind: "draw"; ax: number; ay: number; bx: number; by: number }
  | { kind: "underlay"; startX: number; startY: number; ox: number; oy: number; moved: boolean }
  | { kind: "section"; placeId: string; startX: number; startY: number; rect: SectionOverride; corner: -1 | 0 | 1 | 2 | 3; moved: boolean };

export class SketchEditor {
  tool: SketchTool = "select";
  selectedId: string | null = null;
  area: SketchArea = "lake";
  /** Paint brush, in sketch cells across. */
  brush = 3;
  riverWidth = 3;
  /** The river being drawn: x0, y0, x1, y1… in metatiles. */
  riverPoints: number[] | null = null;
  /** Show the in-game region map's grid and sections over the sketch. */
  showRegionMap = false;
  /** Calibrating the underlay: the two points tapped on it so far. */
  calibration: Array<[number, number]> = [];
  drag: Drag | null = null;
  /** Bumped on every change, so the canvas knows to redraw. */
  version = 0;
  private undoStack: Snap[] = [];
  private redoStack: Snap[] = [];
  /** The sketch as it was before the current drag, for its undo step. */
  private before: Sketch | null = null;

  get sketch(): Sketch | null {
    // Another project was opened: its sketch has its own history.
    if (this.region !== store.region) {
      this.region = store.region;
      this.undoStack = [];
      this.redoStack = [];
      this.selectedId = null;
      this.drag = null;
      this.riverPoints = null;
      this.calibration = [];
    }
    return store.region.sketch;
  }
  private region = store.region;

  get selected(): SketchPlace | null {
    return this.sketch?.places.find((p) => p.id === this.selectedId) ?? null;
  }

  /** Drawing shapes and the river in progress (for the canvas). */
  get draft(): SketchRect | null {
    return this.drag?.kind === "draw" ? rectBetween(this.drag.ax, this.drag.ay, this.drag.bx, this.drag.by) : null;
  }

  private notify(edited: boolean) {
    this.version++;
    store.sketchChanged(edited);
  }

  /** Remember the sketch before a change, for undo. */
  private checkpoint() {
    if (!this.sketch) return;
    this.undoStack.push(this.snap(cloneSketch(this.sketch)));
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
    this.redoStack = [];
  }

  /** Make one change to the sketch, as one undo step. */
  edit(fn: (s: Sketch) => void) {
    const s = this.sketch;
    if (!s) return;
    this.checkpoint();
    fn(s);
    this.notify(true);
  }

  canUndo() {
    return this.undoStack.length > 0;
  }
  canRedo() {
    return this.redoStack.length > 0;
  }

  undo() {
    const prev = this.undoStack.pop();
    if (!prev || !this.sketch) return;
    this.redoStack.push(this.snap(cloneSketch(this.sketch)));
    this.restoreSnap(prev);
    this.afterRestore();
  }

  redo() {
    const next = this.redoStack.pop();
    if (!next || !this.sketch) return;
    this.undoStack.push(this.snap(cloneSketch(this.sketch)));
    this.restoreSnap(next);
    this.afterRestore();
  }

  private snap(sketch: Sketch): Snap {
    return { sketch, progression: structuredClone(store.region.progression), curve: { ...store.region.settings.levelCurve } };
  }

  private restoreSnap(snap: Snap) {
    store.region.sketch = snap.sketch;
    store.region.progression = snap.progression;
    store.region.settings.levelCurve = snap.curve;
  }

  private afterRestore() {
    this.drag = null;
    this.riverPoints = null;
    if (!this.selected) this.selectedId = null;
    this.notify(true);
  }

  /** Forget undo history (another project was opened). */
  reset() {
    this.undoStack = [];
    this.redoStack = [];
    this.selectedId = null;
    this.drag = null;
    this.riverPoints = null;
    this.calibration = [];
    this.notify(false);
  }

  setTool(tool: SketchTool) {
    if (this.riverPoints && tool !== "river") this.finishRiver();
    this.tool = tool;
    this.drag = null;
    this.calibration = [];
    this.notify(false);
  }

  select(id: string | null) {
    this.selectedId = id;
    this.notify(false);
  }

  setArea(area: SketchArea) {
    this.area = area;
    if (this.tool !== "paint") this.tool = "paint";
    this.notify(false);
  }

  setBrush(n: number) {
    this.brush = Math.max(1, Math.min(12, Math.round(n)));
    this.notify(false);
  }

  setRiverWidth(n: number) {
    this.riverWidth = Math.max(1, Math.min(12, Math.round(n)));
    this.notify(false);
  }

  // ----- pointer input (positions in metatiles; tol = how near counts as "on" something) -----

  down(x: number, y: number, tol: number) {
    const s = this.sketch;
    if (!s) return;
    switch (this.tool) {
      case "select":
        return this.selectDown(s, x, y, tol);
      case "town":
      case "route":
        this.drag = { kind: "draw", ax: x, ay: y, bx: x, by: y };
        break;
      case "paint":
      case "erase": {
        this.before = cloneSketch(s);
        const value = this.tool === "paint" ? 1 + SKETCH_AREAS.indexOf(this.area) : 0;
        this.drag = { kind: "paint", value, changed: paintAreas(s, x, y, this.brush, value), x, y };
        break;
      }
      case "sections":
        return this.sectionDown(s, x, y, tol);
      case "journey":
        this.pressTol = tol;
        break;
      case "underlay":
        if (s.underlay && !s.underlay.locked) this.drag = { kind: "underlay", startX: x, startY: y, ox: s.underlay.x, oy: s.underlay.y, moved: false };
        this.before = cloneSketch(s);
        break;
    }
    this.notify(false);
  }

  move(x: number, y: number) {
    const s = this.sketch;
    const d = this.drag;
    if (!s || !d) return;
    if (d.kind === "draw") {
      d.bx = x;
      d.by = y;
    } else if (d.kind === "paint") {
      // Paint every cell along the way from the last position, so a quick stroke has no gaps.
      const steps = Math.max(1, Math.ceil(Math.hypot(x - d.x, y - d.y) / (SKETCH_CELL / 2)));
      for (let k = 1; k <= steps; k++) if (paintAreas(s, d.x + ((x - d.x) * k) / steps, d.y + ((y - d.y) * k) / steps, this.brush, d.value)) d.changed = true;
      d.x = x;
      d.y = y;
    } else if (d.kind === "underlay" && s.underlay) {
      s.underlay.x = d.ox + (x - d.startX);
      s.underlay.y = d.oy + (y - d.startY);
      d.moved = true;
    } else if (d.kind === "move") {
      const place = s.places.find((p) => p.id === d.placeId);
      if (!place) return;
      const dx = snap(x - d.startX);
      const dy = snap(y - d.startY);
      place.rects = d.rects.map((r) => ({ ...r, x: r.x + dx, y: r.y + dy }));
      // Forest and cave entrances on this place move with it.
      for (const [k, pin] of d.pins.entries()) {
        const [owner, index] = this.pinRefs[k];
        const p = s.places.find((q) => q.id === owner);
        if (p) p.pins[index] = { x: pin.x + dx, y: pin.y + dy };
      }
      if (dx || dy) d.moved = true;
    } else if (d.kind === "section") {
      const draft = draftRegionMap(s);
      const gx = (x - draft.ox) / draft.size;
      const gy = (y - draft.oy) / draft.size;
      const W = s.regionMap.width;
      const H = s.regionMap.height;
      const r = d.rect;
      let next: SectionOverride;
      if (d.corner < 0) {
        // Move: by whole squares, kept on the grid, keeping the section's shape.
        const dx = Math.round(gx - d.startX);
        const dy = Math.round(gy - d.startY);
        next = { x: Math.max(0, Math.min(W - r.w, r.x + dx)), y: Math.max(0, Math.min(H - r.h, r.y + dy)), w: r.w, h: r.h, ...(r.cells ? { cells: r.cells } : {}) };
      } else {
        // Resize: the section becomes a plain rectangle.
        // Resize: the opposite corner stays put.
        const fx = d.corner === 0 || d.corner === 3 ? r.x + r.w : r.x;
        const fy = d.corner === 0 || d.corner === 1 ? r.y + r.h : r.y;
        const ex = Math.max(0, Math.min(W, Math.round(gx)));
        const ey = Math.max(0, Math.min(H, Math.round(gy)));
        const x0 = Math.min(fx, ex);
        const y0 = Math.min(fy, ey);
        next = { x: x0, y: y0, w: Math.max(1, Math.abs(ex - fx)), h: Math.max(1, Math.abs(ey - fy)) };
        if (next.x + next.w > W) next.x = W - next.w;
        if (next.y + next.h > H) next.y = H - next.h;
      }
      const old = s.regionMap.overrides[d.placeId];
      if (!old || old.x !== next.x || old.y !== next.y || old.w !== next.w || old.h !== next.h) {
        s.regionMap.overrides[d.placeId] = next;
        d.moved = d.moved || next.x !== r.x || next.y !== r.y || next.w !== r.w || next.h !== r.h;
      }
    } else if (d.kind === "resize") {
      const place = s.places.find((p) => p.id === d.placeId);
      const r = place?.rects[d.rect];
      if (!place || !r) return;
      // The corner opposite the one dragged stays put.
      const fx = d.corner === 0 || d.corner === 3 ? r.x + r.w : r.x;
      const fy = d.corner === 0 || d.corner === 1 ? r.y + r.h : r.y;
      const next = rectBetween(fx, fy, x, y);
      if (next.x !== r.x || next.y !== r.y || next.w !== r.w || next.h !== r.h) {
        place.rects[d.rect] = next;
        d.moved = true;
      }
    } else if (d.kind === "pin") {
      const place = s.places.find((p) => p.id === d.placeId);
      if (!place) return;
      place.pins[d.pin] = { x: Math.floor(x), y: Math.floor(y) };
      d.moved = true;
    }
    this.notify(false);
  }

  up(x: number, y: number, tap: boolean) {
    const s = this.sketch;
    if (!s) return;
    const d = this.drag;
    this.drag = null;
    switch (this.tool) {
      case "town":
      case "route":
        if (d?.kind === "draw" && !tap) this.addShape(s, rectBetween(d.ax, d.ay, x, y));
        else this.notify(false);
        return;
      case "forest":
      case "cave":
        if (tap) this.addPlace(s, this.tool, x, y);
        return;
      case "pin":
        if (tap) this.addPin(s, x, y);
        return;
      case "river":
        if (tap) this.riverTap(x, y);
        return;
      case "calibrate":
        if (tap) this.calibrateTap(x, y);
        return;
      case "journey":
        if (tap) this.journeyTap(s, x, y, this.pressTol);
        return;
    }
    // Drags that changed the sketch become one undo step.
    const changed = d && (d.kind === "paint" ? d.changed : d.kind === "move" || d.kind === "resize" || d.kind === "pin" || d.kind === "underlay" || d.kind === "section" ? d.moved : false);
    // A section only tapped (not moved) stays as it was worked out.
    if (d?.kind === "section" && !d.moved && this.before) store.region.sketch = this.before;
    if (changed && this.before) {
      this.undoStack.push(this.snap(this.before));
      if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
      this.redoStack = [];
    }
    this.before = null;
    this.notify(!!changed);
  }

  private pressTol = 1;

  // ----- the journey -----

  /** Tap a place to add it as the next stop; tap the last stop again to take it off. */
  private journeyTap(s: Sketch, x: number, y: number, tol: number) {
    const pinned = s.places.find((p) => !isOutdoor(p.kind) && p.pins.some((q) => Math.hypot(q.x + 0.5 - x, q.y + 0.5 - y) <= tol * 1.2));
    const place = pinned ?? outdoorPlaceAt(s, x, y);
    if (!place) return;
    const stops = s.journey.stops;
    if (stops[stops.length - 1] === place.id) return this.removeStop(stops.length - 1);
    if (stops.includes(place.id)) {
      store.setNotice({ kind: "info", text: `${place.name} is already stop ${stops.indexOf(place.id) + 1} of the journey. Each place is on it once (where the player first visits it).` });
      this.selectedId = place.id;
      return this.notify(false);
    }
    this.edit((sk) => sk.journey.stops.push(place.id));
    this.selectedId = place.id;
    this.notify(false);
  }

  removeStop(i: number) {
    this.edit((s) => {
      const [id] = s.journey.stops.splice(i, 1);
      for (const [step, at] of Object.entries(s.journey.stepStarts)) if (at === id) delete s.journey.stepStarts[step];
    });
  }

  moveStop(i: number, by: -1 | 1) {
    this.edit((s) => {
      const j = i + by;
      if (j < 0 || j >= s.journey.stops.length) return;
      const st = s.journey.stops;
      [st[i], st[j]] = [st[j], st[i]];
    });
  }

  clearJourney() {
    this.edit((s) => {
      s.journey = { stops: [], stepStarts: {} };
    });
  }

  setLevelCurve(start: number, end: number) {
    this.edit(() => {
      store.region.settings.levelCurve = { start: Math.max(1, Math.min(100, start)), end: Math.max(1, Math.min(100, end)) };
    });
  }

  // ----- progression steps (the badges and HMs the player has by each part of the journey) -----

  addStep() {
    this.edit(() => {
      const steps = store.region.progression;
      const used = new Set(steps.map((x) => x.id));
      let n = steps.length + 1;
      while (used.has(`step${n}`)) n++;
      const badges = Math.min(8, steps.length ? steps[steps.length - 1].badges + 1 : 0);
      steps.push({ id: `step${n}`, name: badges ? `After badge ${badges}` : "Start", badges, hms: steps.length ? [...steps[steps.length - 1].hms] : [] });
    });
  }

  updateStep(id: string, patch: Partial<Pick<ProgressionStep, "name" | "badges">>) {
    this.edit(() => {
      const step = store.region.progression.find((x) => x.id === id);
      if (step) Object.assign(step, patch);
    });
  }

  toggleStepHm(id: string, hm: Hm, on: boolean) {
    this.edit(() => {
      const step = store.region.progression.find((x) => x.id === id);
      if (!step) return;
      step.hms = on ? [...new Set([...step.hms, hm])] : step.hms.filter((h) => h !== hm);
    });
  }

  removeStep(id: string) {
    this.edit((s) => {
      store.region.progression = store.region.progression.filter((x) => x.id !== id);
      delete s.journey.stepStarts[id];
    });
  }

  /** Where a step starts on the journey (a stop's place id), or "" for nowhere yet. */
  setStepStart(id: string, placeId: string) {
    this.edit((s) => {
      if (placeId) s.journey.stepStarts[id] = placeId;
      else delete s.journey.stepStarts[id];
    });
  }

  /** Stop the drag in progress and put back what it changed (a second finger landed: it's a pinch). */
  cancelDrag() {
    if (!this.drag) return;
    if (this.before && this.drag.kind !== "draw") store.region.sketch = this.before;
    this.before = null;
    this.drag = null;
    this.notify(false);
  }

  /** Which forest/cave pins move along with the place being moved: [place id, pin index]. */
  private pinRefs: Array<[string, number]> = [];

  private selectDown(s: Sketch, x: number, y: number, tol: number) {
    this.before = cloneSketch(s);
    // The picked place's corner handles first, then any entrance pin, then the places themselves.
    const sel = this.selected;
    if (sel && isOutdoor(sel.kind)) {
      for (const [k, r] of sel.rects.entries()) {
        const corners: Array<[number, number]> = [
          [r.x, r.y],
          [r.x + r.w, r.y],
          [r.x + r.w, r.y + r.h],
          [r.x, r.y + r.h],
        ];
        const c = corners.findIndex(([cx, cy]) => Math.abs(cx - x) <= tol && Math.abs(cy - y) <= tol);
        if (c >= 0) {
          this.drag = { kind: "resize", placeId: sel.id, rect: k, corner: c as 0 | 1 | 2 | 3, moved: false };
          return this.notify(false);
        }
      }
    }
    for (let k = s.places.length - 1; k >= 0; k--) {
      const p = s.places[k];
      const pin = p.pins.findIndex((q) => Math.hypot(q.x + 0.5 - x, q.y + 0.5 - y) <= tol * 1.2);
      if (pin >= 0) {
        this.selectedId = p.id;
        this.drag = { kind: "pin", placeId: p.id, pin, moved: false };
        return this.notify(false);
      }
    }
    const place = outdoorPlaceAt(s, x, y);
    this.selectedId = place?.id ?? null;
    if (place) {
      this.pinRefs = [];
      const pins: Array<{ x: number; y: number }> = [];
      for (const other of s.places)
        other.pins.forEach((q, i) => {
          if (place.rects.some((r) => inRect(r, q.x, q.y))) {
            this.pinRefs.push([other.id, i]);
            pins.push({ ...q });
          }
        });
      this.drag = { kind: "move", placeId: place.id, startX: x, startY: y, rects: place.rects.map((r) => ({ ...r })), pins, moved: false };
    }
    this.notify(false);
  }

  /** The region map: pick a section, then drag it to move it or drag a corner to resize it. */
  private sectionDown(s: Sketch, x: number, y: number, tol: number) {
    this.before = cloneSketch(s);
    const draft = draftRegionMap(s);
    const gx = (x - draft.ox) / draft.size;
    const gy = (y - draft.oy) / draft.size;
    const t = tol / draft.size;
    const rectOf = (placeId: string): SectionOverride | null => {
      const sec = draft.sections.find((q) => q.placeId === placeId);
      if (!sec || sec.w <= 0) return null;
      // Keep the squares it has now, unless that's the whole rectangle (or it's a one-square entry).
      const cells = sec.inside ? [] : sectionCells(draft, sec);
      return { x: sec.x, y: sec.y, w: sec.w, h: sec.h, ...(cells.includes(0) ? { cells } : {}) };
    };
    const sel = this.selectedId ? rectOf(this.selectedId) : null;
    if (sel && this.selectedId) {
      const corners: Array<[number, number]> = [
        [sel.x, sel.y],
        [sel.x + sel.w, sel.y],
        [sel.x + sel.w, sel.y + sel.h],
        [sel.x, sel.y + sel.h],
      ];
      const c = corners.findIndex(([cx, cy]) => Math.abs(cx - gx) <= Math.max(t, 0.3) && Math.abs(cy - gy) <= Math.max(t, 0.3));
      if (c >= 0) {
        this.drag = { kind: "section", placeId: this.selectedId, startX: gx, startY: gy, rect: sel, corner: c as 0 | 1 | 2 | 3, moved: false };
        return this.notify(false);
      }
    }
    // Forest and cave entries (one square each) sit on top of their route's squares.
    const sx = Math.floor(gx);
    const sy = Math.floor(gy);
    const inside = draft.sections.find((q) => q.inside && q.x === sx && q.y === sy);
    const sec = inside ?? sectionAt(draft, sx, sy);
    this.selectedId = sec?.placeId ?? null;
    if (sec) this.drag = { kind: "section", placeId: sec.placeId, startX: gx, startY: gy, rect: rectOf(sec.placeId)!, corner: -1, moved: false };
    this.notify(false);
  }

  toggleRegionMap() {
    this.showRegionMap = !this.showRegionMap;
    this.tool = this.showRegionMap ? "sections" : "select";
    this.drag = null;
    this.notify(false);
  }

  /** Let the region map work a section out from the sketch again. */
  resetSection(placeId: string) {
    this.edit((s) => {
      delete s.regionMap.overrides[placeId];
    });
  }

  resetAllSections() {
    this.edit((s) => {
      s.regionMap.overrides = {};
    });
  }

  private addShape(s: Sketch, rect: SketchRect) {
    this.checkpoint();
    const kind = this.tool as "town" | "route";
    // A new stretch touching the end of the picked route carries the route on (a bend or a straight run).
    const sel = this.selected;
    const extend = kind === "route" && sel?.kind === "route" && sel.rects.length && touching(sel.rects[sel.rects.length - 1], rect) ? sel : null;
    const place = addOutdoor(s, kind, rect, extend);
    this.selectedId = place.id;
    this.notify(true);
  }

  private addPlace(s: Sketch, kind: "forest" | "cave", x: number, y: number) {
    if (!outdoorPlaceAt(s, x, y)) {
      store.setNotice({ kind: "info", text: `Put the ${kind}'s entrance on a route or town: tap inside one.` });
      return;
    }
    this.checkpoint();
    const place = addInside(s, kind, { x: Math.floor(x), y: Math.floor(y) });
    this.selectedId = place.id;
    this.notify(true);
  }

  private addPin(s: Sketch, x: number, y: number) {
    const sel = this.selected;
    if (!sel || isOutdoor(sel.kind)) return this.setTool("select");
    if (!outdoorPlaceAt(s, x, y)) {
      store.setNotice({ kind: "info", text: "Put the entrance on a route or town: tap inside one." });
      return;
    }
    this.checkpoint();
    sel.pins.push({ x: Math.floor(x), y: Math.floor(y) });
    this.tool = "select";
    this.notify(true);
  }

  // ----- rivers -----

  private riverTap(x: number, y: number) {
    const px = Math.round(x);
    const py = Math.round(y);
    const pts = this.riverPoints;
    // Tapping the last point again finishes the river.
    if (pts && pts.length >= 4 && Math.hypot(pts[pts.length - 2] - px, pts[pts.length - 1] - py) <= SKETCH_CELL) return this.finishRiver();
    this.riverPoints = pts ? [...pts, px, py] : [px, py];
    this.notify(false);
  }

  finishRiver() {
    const pts = this.riverPoints;
    this.riverPoints = null;
    if (!pts || pts.length < 4 || !this.sketch) return this.notify(false);
    this.edit((s) => s.rivers.push({ id: `r${s.nextId++}`, points: pts, width: this.riverWidth }));
  }

  cancelRiver() {
    this.riverPoints = null;
    this.notify(false);
  }

  // ----- underlay calibration -----

  private calibrateTap(x: number, y: number) {
    if (this.calibration.length >= 2) this.calibration = [];
    this.calibration.push([x, y]);
    this.notify(false);
  }

  /**
   * Scale the underlay so the two tapped points are `distance` metatiles apart,
   * keeping the first point where it is.
   */
  applyCalibration(distance: number) {
    const [a, b] = this.calibration;
    const u = this.sketch?.underlay;
    if (!a || !b || !u || !(distance > 0)) return;
    const now = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (now <= 0) return;
    const k = distance / now;
    this.edit((s) => {
      const v = s.underlay!;
      v.scale *= k;
      v.x = a[0] + (v.x - a[0]) * k;
      v.y = a[1] + (v.y - a[1]) * k;
    });
    this.calibration = [];
    this.tool = "select";
    this.notify(false);
  }

  /**
   * Turn the underlay to `degrees` (clockwise), about its centre. `w`, `h` = its size in
   * its own units (image pixels or PDF points).
   */
  rotateUnderlay(degrees: number, w: number, h: number) {
    const u = this.sketch?.underlay;
    if (!u) return;
    const turn = (deg: number, x: number, y: number): [number, number] => {
      const a = (deg * Math.PI) / 180;
      return [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
    };
    const half: [number, number] = [(w * u.scale) / 2, (h * u.scale) / 2];
    const [cx0, cy0] = turn(u.rotation, ...half);
    const centre = [u.x + cx0, u.y + cy0];
    const next = ((((degrees + 180) % 360) + 360) % 360) - 180;
    const [cx1, cy1] = turn(next, ...half);
    this.edit((s) => {
      const v = s.underlay!;
      v.rotation = next;
      v.x = centre[0] - cx1;
      v.y = centre[1] - cy1;
    });
  }

  /** Stretch the underlay across the sketch's width, at its top-left corner, unturned. */
  fitUnderlay(w: number) {
    if (!this.sketch?.underlay || w <= 0) return;
    this.edit((s) => Object.assign(s.underlay!, { x: 0, y: 0, rotation: 0, scale: s.width / w }));
  }

  setUnderlay(patch: Partial<NonNullable<Sketch["underlay"]>> | null) {
    this.edit((s) => {
      s.underlay = patch === null ? null : s.underlay ? { ...s.underlay, ...patch } : null;
    });
  }

  /** Start calibrating: tap two points on the drawing, then say how far apart they are. */
  startCalibration() {
    this.tool = "calibrate";
    this.calibration = [];
    this.notify(false);
  }

  setSegmentLength(n: number) {
    store.region.settings.targetSegmentLength = Math.max(10, Math.min(512, Math.round(n)));
    this.notify(true);
  }

  // ----- the picked place -----

  deleteSelected() {
    const sel = this.selected;
    if (!sel) return;
    this.edit((s) => {
      s.places = s.places.filter((p) => p.id !== sel.id);
      delete s.regionMap.overrides[sel.id];
      s.journey.stops = s.journey.stops.filter((id) => id !== sel.id);
      for (const [step, at] of Object.entries(s.journey.stepStarts)) if (at === sel.id) delete s.journey.stepStarts[step];
    });
    this.selectedId = null;
    this.notify(false);
  }

  /** Remove one stretch of a route (the last one leaves the route empty: delete it instead). */
  deleteStretch(k: number) {
    const sel = this.selected;
    if (!sel || sel.rects.length <= 1) return this.deleteSelected();
    this.edit(() => {
      sel.rects.splice(k, 1);
    });
  }

  removePin(k: number) {
    const sel = this.selected;
    if (!sel) return;
    this.edit(() => {
      sel.pins.splice(k, 1);
    });
  }

  deleteRiver(id: string) {
    this.edit((s) => {
      s.rivers = s.rivers.filter((r) => r.id !== id);
    });
  }

  updateSelected(patch: Partial<Pick<SketchPlace, "name" | "ownSection" | "size">>) {
    const sel = this.selected;
    if (!sel) return;
    this.edit(() => Object.assign(sel, patch));
  }

  setStretch(k: number, rect: SketchRect) {
    const sel = this.selected;
    if (!sel?.rects[k]) return;
    this.edit(() => {
      sel.rects[k] = rect;
    });
  }
}

export const sketchEditor = new SketchEditor();
