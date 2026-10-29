// Pointer input for the map canvas: mouse, Apple Pencil and touch, all through
// Pointer Events.
//
//   Pencil (pen)       → always uses the current tool (paint, select, move things).
//   Mouse left button  → current tool. Middle/right button or Space+drag → pan.
//   One finger         → paint or pan, from the "finger" setting. In "auto" a
//                        finger paints until an Apple Pencil is seen, then pans.
//   Two fingers        → drag to pan, pinch to zoom. A quick two-finger tap undoes.
//   Mouse wheel        → zoom at the cursor.

import type { EditorStore, Tool } from "./store";
import type { MapRenderer } from "./renderer";

const TAP_MAX_MS = 280;
const TAP_MAX_MOVE = 12;
/** Two fingers must land within this time of each other to count as a tap. */
const TAP_TOGETHER_MS = 150;

interface PointerInfo {
  x: number;
  y: number;
  type: string;
}

type Mode = "none" | "paint" | "pan" | "gesture" | "image";

export class CanvasInput {
  private pointers = new Map<number, PointerInfo>();
  private mode: Mode = "none";
  private panLast: [number, number] | null = null;
  private gesture: { dist: number; mid: [number, number]; start: number; moved: number } | null = null;
  private spaceHeld = false;
  private firstTouchAt = 0;
  /** The tool a press started with (the Select and Things tools drag rather than paint). */
  private pressTool: Tool = "pencil";
  private detach: Array<() => void> = [];

  constructor(
    private el: HTMLCanvasElement,
    private store: EditorStore,
    private renderer: MapRenderer,
    private onHover: (cell: [number, number] | null) => void,
  ) {
    const on = <K extends keyof HTMLElementEventMap>(target: HTMLElement | Window | Document, type: K | string, fn: (e: any) => void, opts?: AddEventListenerOptions) => {
      target.addEventListener(type, fn, opts);
      this.detach.push(() => target.removeEventListener(type, fn, opts));
    };
    on(el, "pointerdown", (e: PointerEvent) => this.down(e));
    on(el, "pointermove", (e: PointerEvent) => this.move(e));
    on(el, "pointerup", (e: PointerEvent) => this.up(e));
    on(el, "pointercancel", (e: PointerEvent) => this.up(e, true));
    on(el, "pointerleave", (e: PointerEvent) => {
      if (e.pointerType === "mouse" && this.pointers.size === 0) this.setHover(null);
    });
    on(el, "wheel", (e: WheelEvent) => this.wheel(e), { passive: false });
    on(el, "contextmenu", (e: Event) => e.preventDefault());
    // Safari's own pinch-zoom of the page: stop it so pinch zooms the canvas only.
    on(document, "gesturestart", (e: Event) => e.preventDefault(), { passive: false });
    on(document, "gesturechange", (e: Event) => e.preventDefault(), { passive: false });
    on(window, "keydown", (e: KeyboardEvent) => {
      if (e.code === "Space" && !isTyping(e)) {
        this.spaceHeld = true;
        e.preventDefault();
      }
    });
    on(window, "keyup", (e: KeyboardEvent) => {
      if (e.code === "Space") this.spaceHeld = false;
    });
  }

  dispose() {
    for (const off of this.detach) off();
    this.detach = [];
  }

  private local(e: PointerEvent | WheelEvent): [number, number] {
    const r = this.el.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  private setHover(cell: [number, number] | null) {
    const map = this.store.currentMap;
    if (cell && map && (cell[0] < 0 || cell[1] < 0 || cell[0] >= map.width || cell[1] >= map.height)) cell = null;
    const prev = this.renderer.hover;
    if (prev?.[0] === cell?.[0] && prev?.[1] === cell?.[1]) return;
    this.renderer.hover = cell;
    this.renderer.requestFrame();
    this.onHover(cell);
  }

  /** Does a single pointer of this type paint (true) or pan (false)? */
  private paints(e: PointerEvent): boolean {
    const tool = this.store.tool;
    if (tool === "pan") return false;
    if (e.pointerType === "mouse") return e.button === 0 && !this.spaceHeld;
    if (e.pointerType === "pen") return true;
    const mode = this.store.prefs.fingerMode;
    if (mode === "paint") return true;
    if (mode === "pan") return false;
    return !this.store.prefs.penSeen;
  }

  private down(e: PointerEvent) {
    e.preventDefault();
    try {
      // Keep receiving this pointer's events even if it leaves the canvas.
      this.el.setPointerCapture(e.pointerId);
    } catch {
      // Pointer already gone (or a synthetic event); safe to continue without capture.
    }
    const [x, y] = this.local(e);
    this.pointers.set(e.pointerId, { x, y, type: e.pointerType });
    if (e.pointerType === "pen") this.store.notePenSeen();

    if (e.pointerType === "touch" && this.touchCount() === 1) this.firstTouchAt = performance.now();

    // A second finger: switch to pan/zoom, and throw away any stroke the first finger started.
    if (e.pointerType === "touch" && this.touchCount() === 2) {
      if (this.mode === "paint") this.endPress(true);
      if (this.mode === "image") this.store.refUp();
      // Only fingers that land together count as a two-finger tap (undo).
      this.startGesture(performance.now() - this.firstTouchAt < TAP_TOGETHER_MS);
      return;
    }
    if (this.pointers.size > 1) return;

    if (this.paints(e)) {
      const cell = this.renderer.cellAt(x, y);
      if (this.store.refMode) {
        this.store.refDown(...this.renderer.pointAt(x, y));
        this.mode = "image";
        return;
      }
      if (this.store.tool === "pick") {
        this.store.pickAt(cell[0], cell[1]);
        this.mode = "none";
        return;
      }
      // Alt+click picks a cell's terrain, except with the selection tools (where it subtracts).
      if (e.altKey && !this.store.selecting) {
        this.store.setTool("pick");
        this.store.pickAt(cell[0], cell[1]);
        this.mode = "none";
        return;
      }
      this.mode = "paint";
      this.pressTool = this.store.tool;
      if (this.store.selecting) this.store.selectDown(cell[0], cell[1], { add: e.shiftKey, subtract: e.altKey });
      else if (this.pressTool === "things") this.store.thingsDown(cell[0], cell[1]);
      else if (this.pressTool === "strokes") this.store.smartDown(cell[0], cell[1]);
      else if (this.pressTool === "zones") this.store.zoneDown(cell[0], cell[1]);
      else this.store.beginStroke(cell[0], cell[1]);
      this.setHover(cell);
    } else {
      this.mode = "pan";
      this.panLast = [x, y];
    }
  }

  private move(e: PointerEvent) {
    const [x, y] = this.local(e);
    const p = this.pointers.get(e.pointerId);
    if (p) {
      p.x = x;
      p.y = y;
    }
    if (this.mode === "gesture") {
      this.updateGesture();
      return;
    }
    if (this.mode === "image") {
      this.store.refMove(...this.renderer.pointAt(x, y));
      return;
    }
    const cell = this.renderer.cellAt(x, y);
    if (e.pointerType !== "touch" || this.mode === "paint") this.setHover(cell);
    if (this.mode === "paint" && p && isSelectTool(this.pressTool)) this.store.selectMove(cell[0], cell[1]);
    else if (this.mode === "paint" && p && this.pressTool === "things") this.store.thingsMove(cell[0], cell[1]);
    else if (this.mode === "paint" && p && this.pressTool === "zones") this.store.zoneMove(cell[0], cell[1]);
    else if (this.mode === "paint" && p && this.pressTool === "strokes") {
      const events = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
      for (const ce of events.length ? events : [e]) {
        const [cx, cy] = this.local(ce);
        const c = this.renderer.cellAt(cx, cy);
        this.store.smartMove(c[0], c[1]);
      }
    }
    else if (this.mode === "paint" && p) {
      // Use coalesced events for smooth Pencil lines when the browser provides them.
      const events = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
      for (const ce of events.length ? events : [e]) {
        const [cx, cy] = this.local(ce);
        const c = this.renderer.cellAt(cx, cy);
        this.store.strokeTo(c[0], c[1]);
      }
    } else if (this.mode === "pan" && p && this.panLast) {
      this.renderer.panBy(x - this.panLast[0], y - this.panLast[1]);
      this.panLast = [x, y];
    }
  }

  private up(e: PointerEvent, cancelled = false) {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    if (this.mode === "gesture") {
      if (this.touchCount() === 0) {
        const g = this.gesture;
        // Quick two-finger tap without movement → undo.
        if (g && !cancelled && performance.now() - g.start < TAP_MAX_MS && g.moved < TAP_MAX_MOVE) this.store.undo();
        this.gesture = null;
        this.mode = "none";
      }
      return;
    }
    if (this.mode === "paint") this.endPress(cancelled);
    if (this.mode === "image") this.store.refUp();
    if (this.pointers.size === 0) {
      this.mode = "none";
      this.panLast = null;
      if (e.pointerType === "touch") this.setHover(null);
    }
  }

  /** Finish a press with the current tool (a cancelled paint stroke is undone). */
  private endPress(cancelled: boolean) {
    if (isSelectTool(this.pressTool)) this.store.selectUp();
    else if (this.pressTool === "things") this.store.thingsUp();
    else if (this.pressTool === "strokes") this.store.smartUp(cancelled);
    else if (this.pressTool === "zones") this.store.zoneUp(cancelled);
    else if (cancelled) this.store.cancelStroke();
    else this.store.endStroke();
  }

  private touchCount() {
    let n = 0;
    for (const p of this.pointers.values()) if (p.type === "touch") n++;
    return n;
  }

  private twoTouches(): [PointerInfo, PointerInfo] | null {
    const t = [...this.pointers.values()].filter((p) => p.type === "touch");
    return t.length >= 2 ? [t[0], t[1]] : null;
  }

  private startGesture(canBeTap: boolean) {
    const t = this.twoTouches();
    if (!t) return;
    this.mode = "gesture";
    this.setHover(null);
    this.gesture = {
      dist: Math.hypot(t[0].x - t[1].x, t[0].y - t[1].y),
      mid: [(t[0].x + t[1].x) / 2, (t[0].y + t[1].y) / 2],
      start: performance.now(),
      moved: canBeTap ? 0 : Infinity,
    };
  }

  private updateGesture() {
    const t = this.twoTouches();
    const g = this.gesture;
    if (!t || !g) return;
    const dist = Math.hypot(t[0].x - t[1].x, t[0].y - t[1].y);
    const mid: [number, number] = [(t[0].x + t[1].x) / 2, (t[0].y + t[1].y) / 2];
    this.renderer.panBy(mid[0] - g.mid[0], mid[1] - g.mid[1]);
    if (g.dist > 0 && dist > 0) this.renderer.zoomAt(dist / g.dist, mid[0], mid[1]);
    g.moved += Math.hypot(mid[0] - g.mid[0], mid[1] - g.mid[1]) + Math.abs(dist - g.dist);
    g.dist = dist;
    g.mid = mid;
  }

  private wheel(e: WheelEvent) {
    e.preventDefault();
    const [x, y] = this.local(e);
    // Trackpad pinch arrives as ctrl+wheel with small deltas; a mouse wheel has large ones.
    const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    this.renderer.zoomAt(Math.exp(-delta * (e.ctrlKey ? 0.01 : 0.0025)), x, y);
  }
}

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
}

function isSelectTool(tool: Tool): boolean {
  return tool === "select" || tool === "lasso" || tool === "wand";
}
