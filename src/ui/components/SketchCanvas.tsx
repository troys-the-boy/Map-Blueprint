// The region sketch canvas: draws the sketch and passes pointer input to the
// sketch editor (sketchEditor.ts).
//
//   Pencil, mouse left button, one finger → the current tool.
//   Two fingers → drag to pan, pinch to zoom.  Middle/right mouse button → pan.
//   Mouse wheel → zoom at the cursor.

import { useEffect, useRef } from "react";
import type { Sketch } from "../../core/sketch";
import { SKETCH_AREAS, SKETCH_CELL, isOutdoor, placePieces, sketchCols, sketchIssues, sketchRows } from "../../core/sketch";
import { checkMapSize } from "../../core/sizeRule";
import { sketchEditor } from "../sketchEditor";
import { store } from "../store";
import { underlayPicture } from "../underlay";
import { SKETCH_AREA_COLORS, sectionColor } from "../zoneColors";
import { draftRegionMap } from "../../core/regionMap";
import { planJourney, stopPoints } from "../../core/journey";

const PLACE_COLORS = { town: "#d98b4a", route: "#c9b48a", forest: "#3f9a55", cave: "#9a8a78" } as const;
const TAP_MAX_MS = 400;
const TAP_MAX_MOVE = 8;

/** The view: CSS pixels per metatile, and where the sketch's top-left corner is on screen. */
export interface SketchView {
  scale: number;
  ox: number;
  oy: number;
}

/** The canvas's view, so buttons (fit, zoom) can reach it. */
export const sketchViewRef: { fit: (() => void) | null; zoom: ((k: number) => void) | null } = { fit: null, zoom: null };

export function SketchCanvas({ onHover }: { onHover: (p: [number, number] | null) => void }) {
  const el = useRef<HTMLCanvasElement>(null);
  const hoverRef = useRef(onHover);
  hoverRef.current = onHover;

  useEffect(() => {
    const canvas = el.current!;
    const ctx = canvas.getContext("2d")!;
    const view: SketchView = { scale: 1, ox: 0, oy: 0 };
    let size = { w: 1, h: 1 };
    let frame = 0;
    let fitted = false;

    const request = () => {
      if (!frame) frame = requestAnimationFrame(draw);
    };
    const fit = () => {
      const s = store.region.sketch;
      if (!s) return;
      // Room on the left for the tool strip.
      const pad = 24;
      const left = 72;
      view.scale = Math.max(0.05, Math.min((size.w - left - pad) / s.width, (size.h - 2 * pad) / s.height));
      view.ox = left + (size.w - left - pad - s.width * view.scale) / 2;
      view.oy = (size.h - s.height * view.scale) / 2;
      request();
    };
    const zoomAt = (k: number, sx: number, sy: number) => {
      const next = Math.max(0.05, Math.min(40, view.scale * k));
      view.ox = sx - ((sx - view.ox) * next) / view.scale;
      view.oy = sy - ((sy - view.oy) * next) / view.scale;
      view.scale = next;
      request();
    };
    sketchViewRef.fit = fit;
    sketchViewRef.zoom = (k) => zoomAt(k, size.w / 2, size.h / 2);

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      size = { w: Math.max(1, r.width), h: Math.max(1, r.height) };
      canvas.width = Math.round(size.w * dpr);
      canvas.height = Math.round(size.h * dpr);
      if (!fitted) {
        fit();
        fitted = true;
      }
      request();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    const unsubscribe = store.subscribe(request);

    function draw() {
      frame = 0;
      const s = store.region.sketch;
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#15191c";
      ctx.fillRect(0, 0, size.w, size.h);
      if (!s) return;
      drawSketch(ctx, s, view, dpr, request);
    }

    // ----- pointer input -----
    const pointers = new Map<number, { x: number; y: number }>();
    let mode: "none" | "tool" | "pan" | "gesture" = "none";
    let press = { x: 0, y: 0, t: 0, moved: false };
    let panLast: [number, number] = [0, 0];
    let gesture: { dist: number; mid: [number, number] } | null = null;
    const local = (e: PointerEvent | WheelEvent): [number, number] => {
      const r = canvas.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };
    const world = (sx: number, sy: number): [number, number] => [(sx - view.ox) / view.scale, (sy - view.oy) / view.scale];
    const tol = () => 12 / view.scale;
    const twoFinger = () => {
      const [a, b] = [...pointers.values()];
      return { dist: Math.hypot(a.x - b.x, a.y - b.y), mid: [(a.x + b.x) / 2, (a.y + b.y) / 2] as [number, number] };
    };

    const down = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      const [x, y] = local(e);
      pointers.set(e.pointerId, { x, y });
      if (pointers.size === 2 && e.pointerType === "touch") {
        if (mode === "tool") sketchEditor.cancelDrag();
        mode = "gesture";
        gesture = twoFinger();
        return;
      }
      if (pointers.size > 1) return;
      press = { x, y, t: performance.now(), moved: false };
      if (e.button === 1 || e.button === 2 || sketchEditor.tool === "pan") {
        mode = "pan";
        panLast = [x, y];
        return;
      }
      mode = "tool";
      const [wx, wy] = world(x, y);
      sketchEditor.down(wx, wy, tol());
    };
    const move = (e: PointerEvent) => {
      const [x, y] = local(e);
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x, y });
      const [wx, wy] = world(x, y);
      hoverRef.current([Math.floor(wx), Math.floor(wy)]);
      if (Math.hypot(x - press.x, y - press.y) > TAP_MAX_MOVE) press.moved = true;
      if (mode === "gesture" && gesture && pointers.size >= 2) {
        const now = twoFinger();
        view.ox += now.mid[0] - gesture.mid[0];
        view.oy += now.mid[1] - gesture.mid[1];
        if (gesture.dist > 0) zoomAt(now.dist / gesture.dist, now.mid[0], now.mid[1]);
        gesture = now;
        request();
      } else if (mode === "pan") {
        view.ox += x - panLast[0];
        view.oy += y - panLast[1];
        panLast = [x, y];
        request();
      } else if (mode === "tool") sketchEditor.move(wx, wy);
      else if (sketchEditor.tool === "river" && sketchEditor.riverPoints) {
        hoverPoint = [wx, wy];
        request();
      }
    };
    const up = (e: PointerEvent, cancelled = false) => {
      pointers.delete(e.pointerId);
      if (mode === "tool") {
        const [x, y] = local(e);
        const [wx, wy] = world(x, y);
        if (cancelled) sketchEditor.cancelDrag();
        else sketchEditor.up(wx, wy, !press.moved && performance.now() - press.t < TAP_MAX_MS * 2);
      }
      if (pointers.size === 0) {
        mode = "none";
        gesture = null;
      }
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const [x, y] = local(e);
      zoomAt(Math.exp(-e.deltaY * 0.0015), x, y);
    };
    let hoverPoint: [number, number] | null = null;
    hoverPointRef.get = () => hoverPoint;
    const leave = () => hoverRef.current(null);
    const noMenu = (e: Event) => e.preventDefault();
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", (e) => up(e, true));
    canvas.addEventListener("pointerleave", leave);
    canvas.addEventListener("wheel", wheel, { passive: false });
    canvas.addEventListener("contextmenu", noMenu);
    return () => {
      observer.disconnect();
      unsubscribe();
      if (frame) cancelAnimationFrame(frame);
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointerleave", leave);
      canvas.removeEventListener("wheel", wheel);
      canvas.removeEventListener("contextmenu", noMenu);
      sketchViewRef.fit = null;
      sketchViewRef.zoom = null;
    };
  }, []);

  return <canvas ref={el} className="map-canvas sketch-canvas" style={{ touchAction: "none" }} aria-label="Region sketch" />;
}

/** Where the pointer is while a river is being drawn (for the line to the next point). */
const hoverPointRef: { get: () => [number, number] | null } = { get: () => null };

function drawSketch(ctx: CanvasRenderingContext2D, s: Sketch, view: SketchView, dpr: number, redraw: () => void) {
  const { scale, ox, oy } = view;
  const X = (x: number) => ox + x * scale;
  const Y = (y: number) => oy + y * scale;
  const target = store.region.settings.targetSegmentLength;
  const limits = store.region.settings.engineLimits;

  // The sketch's paper.
  ctx.fillStyle = "#1c2327";
  ctx.fillRect(X(0), Y(0), s.width * scale, s.height * scale);

  // The underlay, under everything else.
  const u = s.underlay;
  if (u?.visible) {
    const pic = underlayPicture(u, redraw);
    if (pic) {
      ctx.save();
      ctx.globalAlpha = u.opacity;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.translate(X(u.x), Y(u.y));
      ctx.rotate((u.rotation * Math.PI) / 180);
      const k = (scale * u.scale) / pic.pixelsPerUnit;
      ctx.scale(k, k);
      ctx.drawImage(pic.source, 0, 0);
      ctx.restore();
    }
  }

  // Painted areas.
  const cols = sketchCols(s);
  const rows = sketchRows(s);
  const cell = SKETCH_CELL * scale;
  ctx.globalAlpha = 0.55;
  for (let cy = 0; cy < rows; cy++)
    for (let cx = 0; cx < cols; cx++) {
      const v = s.areas[cy * cols + cx];
      if (!v) continue;
      ctx.fillStyle = SKETCH_AREA_COLORS[SKETCH_AREAS[v - 1]];
      ctx.fillRect(X(cx * SKETCH_CELL), Y(cy * SKETCH_CELL), cell + 0.5, cell + 0.5);
    }
  ctx.globalAlpha = 1;

  // The grid: every cell when there's room, and stronger lines every 50 metatiles.
  ctx.lineWidth = 1;
  const every = cell >= 6 ? 1 : 10;
  for (let cx = 0; cx <= cols; cx += every) {
    ctx.strokeStyle = cx % 10 === 0 ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.05)";
    ctx.beginPath();
    ctx.moveTo(Math.round(X(cx * SKETCH_CELL)) + 0.5, Y(0));
    ctx.lineTo(Math.round(X(cx * SKETCH_CELL)) + 0.5, Y(s.height));
    ctx.stroke();
  }
  for (let cy = 0; cy <= rows; cy += every) {
    ctx.strokeStyle = cy % 10 === 0 ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.05)";
    ctx.beginPath();
    ctx.moveTo(X(0), Math.round(Y(cy * SKETCH_CELL)) + 0.5);
    ctx.lineTo(X(s.width), Math.round(Y(cy * SKETCH_CELL)) + 0.5);
    ctx.stroke();
  }

  // Rivers.
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const polyline = (pts: number[]) => {
    ctx.beginPath();
    for (let k = 0; k < pts.length; k += 2) (k ? ctx.lineTo : ctx.moveTo).call(ctx, X(pts[k]), Y(pts[k + 1]));
  };
  for (const r of s.rivers) {
    ctx.strokeStyle = "#3fa6e0";
    ctx.lineWidth = Math.max(2, r.width * scale);
    polyline(r.points);
    ctx.stroke();
  }
  const draftRiver = sketchEditor.riverPoints;
  if (draftRiver) {
    const hp = hoverPointRef.get();
    ctx.strokeStyle = "#7cc8f0";
    ctx.lineWidth = Math.max(2, sketchEditor.riverWidth * scale);
    ctx.setLineDash([6, 4]);
    polyline(hp ? [...draftRiver, hp[0], hp[1]] : draftRiver);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#7cc8f0";
    for (let k = 0; k < draftRiver.length; k += 2) {
      ctx.beginPath();
      ctx.arc(X(draftRiver[k]), Y(draftRiver[k + 1]), 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Places: rectangles, with segment seams and sizes.
  const issues = sketchIssues(s, target, limits);
  const bad = new Set(issues.filter((i) => i.severity === "error").map((i) => i.placeId));
  const selected = sketchEditor.selectedId;
  ctx.font = "600 12px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const label = (text: string, x: number, y: number, color = "#f2f5f6") => {
    const w = ctx.measureText(text).width + 8;
    ctx.fillStyle = "rgba(15,20,23,0.75)";
    ctx.fillRect(x - w / 2, y - 9, w, 18);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  };
  for (const p of s.places) {
    if (!isOutdoor(p.kind)) continue;
    const color = PLACE_COLORS[p.kind];
    for (const r of p.rects) {
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = color;
      ctx.fillRect(X(r.x), Y(r.y), r.w * scale, r.h * scale);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = bad.has(p.id) ? "#e07a6a" : p.id === selected ? "#9fd0bd" : color;
      ctx.lineWidth = p.id === selected ? 3 : 1.5;
      ctx.strokeRect(X(r.x), Y(r.y), r.w * scale, r.h * scale);
    }
    const pieces = placePieces(p, target);
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    ctx.lineWidth = 1.5;
    for (const piece of pieces) {
      if (piece.segment === 0) continue;
      const vertical = p.rects[piece.rect].h >= p.rects[piece.rect].w;
      ctx.beginPath();
      if (vertical) {
        ctx.moveTo(X(piece.x), Y(piece.y));
        ctx.lineTo(X(piece.x + piece.w), Y(piece.y));
      } else {
        ctx.moveTo(X(piece.x), Y(piece.y));
        ctx.lineTo(X(piece.x), Y(piece.y + piece.h));
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);
    // Name on the first piece, sizes on every piece that has room.
    pieces.forEach((piece, k) => {
      const cx = X(piece.x + piece.w / 2);
      const cy = Y(piece.y + piece.h / 2);
      const roomy = piece.w * scale > 44 && piece.h * scale > 30;
      if (k === 0) label(p.name, cx, roomy ? cy - 10 : cy);
      if (roomy) label(`${piece.w}×${piece.h}`, cx, k === 0 ? cy + 10 : cy, checkMapSize(piece.w, piece.h, limits).ok ? "#c9d4d9" : "#e07a6a");
    });
  }

  // The picked place's corner handles.
  const sel = s.places.find((p) => p.id === selected);
  if (sel && isOutdoor(sel.kind)) {
    ctx.fillStyle = "#9fd0bd";
    for (const r of sel.rects)
      for (const [x, y] of [
        [r.x, r.y],
        [r.x + r.w, r.y],
        [r.x + r.w, r.y + r.h],
        [r.x, r.y + r.h],
      ])
        ctx.fillRect(X(x) - 6, Y(y) - 6, 12, 12);
  }

  // Forest and cave entrances: pins, joined when a place has more than one.
  for (const p of s.places) {
    if (isOutdoor(p.kind) || !p.pins.length) continue;
    const color = PLACE_COLORS[p.kind];
    if (p.pins.length > 1) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      polyline(p.pins.flatMap((q) => [q.x + 0.5, q.y + 0.5]));
      ctx.stroke();
      ctx.setLineDash([]);
    }
    p.pins.forEach((q, k) => {
      const x = X(q.x + 0.5);
      const y = Y(q.y + 0.5);
      ctx.beginPath();
      ctx.arc(x, y, 9, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = p.id === selected ? 3 : 1.5;
      ctx.strokeStyle = bad.has(p.id) ? "#e07a6a" : p.id === selected ? "#9fd0bd" : "#0f1417";
      ctx.stroke();
      ctx.fillStyle = "#0f1417";
      ctx.fillText(p.kind === "forest" ? "F" : "C", x, y + 0.5);
      if (k === 0) label(p.name, x, y - 20);
    });
  }

  // The in-game region map's grid and sections, over the sketch.
  if (sketchEditor.showRegionMap) {
    const d = draftRegionMap(s);
    const sq = d.size * scale;
    const GX = (gx: number) => X(d.ox + gx * d.size);
    const GY = (gy: number) => Y(d.oy + gy * d.size);
    ctx.fillStyle = "rgba(10,14,16,0.35)";
    ctx.fillRect(GX(0), GY(0), d.width * sq, d.height * sq);
    for (let gy = 0; gy < d.height; gy++)
      for (let gx = 0; gx < d.width; gx++) {
        const k = d.layout[gy * d.width + gx];
        if (k < 0) continue;
        ctx.globalAlpha = d.sections[k].placeId === selected ? 0.75 : 0.5;
        ctx.fillStyle = sectionColor(k);
        ctx.fillRect(GX(gx) + 1, GY(gy) + 1, sq - 2, sq - 2);
      }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 1;
    for (let gx = 0; gx <= d.width; gx++) {
      ctx.beginPath();
      ctx.moveTo(GX(gx), GY(0));
      ctx.lineTo(GX(gx), GY(d.height));
      ctx.stroke();
    }
    for (let gy = 0; gy <= d.height; gy++) {
      ctx.beginPath();
      ctx.moveTo(GX(0), GY(gy));
      ctx.lineTo(GX(d.width), GY(gy));
      ctx.stroke();
    }
    ctx.strokeStyle = "#e6b450";
    ctx.lineWidth = 2;
    ctx.strokeRect(GX(0), GY(0), d.width * sq, d.height * sq);
    // Entries: the rectangle the game uses for each section, with its name.
    d.sections.forEach((sec, k) => {
      if (!sec.w) return;
      const picked = sec.placeId === selected;
      ctx.strokeStyle = picked ? "#9fd0bd" : sectionColor(k);
      ctx.lineWidth = picked ? 3 : 2;
      ctx.setLineDash(sec.inside ? [4, 3] : []);
      ctx.strokeRect(GX(sec.x), GY(sec.y), sec.w * sq, sec.h * sq);
      ctx.setLineDash([]);
      label(sec.name + (sec.manual ? " ✋" : ""), GX(sec.x + sec.w / 2), GY(sec.y + sec.h / 2) + (sec.inside ? 12 : 0), picked ? "#9fd0bd" : "#f2f5f6");
      if (picked && sketchEditor.tool === "sections") {
        ctx.fillStyle = "#9fd0bd";
        for (const [cx, cy] of [
          [sec.x, sec.y],
          [sec.x + sec.w, sec.y],
          [sec.x + sec.w, sec.y + sec.h],
          [sec.x, sec.y + sec.h],
        ])
          ctx.fillRect(GX(cx) - 6, GY(cy) - 6, 12, 12);
      }
    });
  }

  // The journey: a line through the stops in order, numbered, with arrows the way it goes.
  if (s.journey.stops.length) {
    const stops = stopPoints(s, planJourney(s, store.region));
    const pts = stops.flat();
    const strong = sketchEditor.tool === "journey";
    ctx.strokeStyle = "#f0c25a";
    ctx.globalAlpha = strong ? 1 : 0.8;
    ctx.lineWidth = strong ? 4 : 3;
    if (pts.length >= 4) {
      polyline(pts);
      ctx.stroke();
      // An arrowhead halfway along each leg.
      ctx.fillStyle = "#f0c25a";
      for (let k = 0; k + 3 < pts.length; k += 2) {
        const ax = X(pts[k]);
        const ay = Y(pts[k + 1]);
        const bx = X(pts[k + 2]);
        const by = Y(pts[k + 3]);
        const len = Math.hypot(bx - ax, by - ay);
        if (len < 24) continue;
        const a = Math.atan2(by - ay, bx - ax);
        const mx = (ax + bx) / 2;
        const my = (ay + by) / 2;
        ctx.beginPath();
        ctx.moveTo(mx + 7 * Math.cos(a), my + 7 * Math.sin(a));
        ctx.lineTo(mx + 7 * Math.cos(a + 2.5), my + 7 * Math.sin(a + 2.5));
        ctx.lineTo(mx + 7 * Math.cos(a - 2.5), my + 7 * Math.sin(a - 2.5));
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    stops.forEach((p, k) => {
      if (p.length < 2) return;
      const x = X(p[0]);
      const y = Y(p[1]);
      ctx.beginPath();
      ctx.arc(x, y, 10, 0, Math.PI * 2);
      ctx.fillStyle = "#f0c25a";
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "#0f1417";
      ctx.stroke();
      ctx.fillStyle = "#0f1417";
      ctx.fillText(String(k + 1), x, y + 0.5);
    });
  }

  // The shape being drawn, with its size.
  const draft = sketchEditor.draft;
  if (draft) {
    const kind = sketchEditor.tool === "town" ? "town" : "route";
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = PLACE_COLORS[kind];
    ctx.strokeRect(X(draft.x), Y(draft.y), draft.w * scale, draft.h * scale);
    ctx.setLineDash([]);
    const pieces = placePieces({ id: "", kind, name: "", rects: [draft], pins: [], size: null, ownSection: false, mapIds: [] }, target);
    const fits = pieces.every((q) => checkMapSize(q.w, q.h, limits).ok);
    const text = pieces.length > 1 ? `${draft.w}×${draft.h} → ${pieces.length} segments` : `${draft.w}×${draft.h}`;
    label(text, X(draft.x + draft.w / 2), Y(draft.y) - 14, fits ? "#f2f5f6" : "#e07a6a");
  }

  // Calibration points.
  const cal = sketchEditor.calibration;
  if (cal.length) {
    ctx.strokeStyle = "#e6b450";
    ctx.lineWidth = 2;
    if (cal.length === 2) {
      ctx.beginPath();
      ctx.moveTo(X(cal[0][0]), Y(cal[0][1]));
      ctx.lineTo(X(cal[1][0]), Y(cal[1][1]));
      ctx.stroke();
    }
    cal.forEach(([x, y], k) => {
      ctx.beginPath();
      ctx.moveTo(X(x) - 10, Y(y));
      ctx.lineTo(X(x) + 10, Y(y));
      ctx.moveTo(X(x), Y(y) - 10);
      ctx.lineTo(X(x), Y(y) + 10);
      ctx.stroke();
      label(k === 0 ? "A" : "B", X(x) + 14, Y(y) - 14, "#e6b450");
    });
  }
}
