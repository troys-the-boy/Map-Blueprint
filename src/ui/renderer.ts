// Draws a map on an HTML canvas.
//
// The map is cut into chunks of 32×32 cells. Each chunk is pre-drawn once into
// its own off-screen bitmap (16 px per cell), and only cells that change are
// redrawn into it. Each frame just stretches the visible chunk bitmaps onto the
// screen and draws the overlays (grid, rulers, screen frame) on top. This keeps
// large maps (e.g. 40×170) smooth on an iPad.

import { SCREEN_HEIGHT_METATILES, SCREEN_WIDTH_METATILES, PLAYER_SCREEN_X, PLAYER_SCREEN_Y } from "../core/constants";
import type { MapBlueprint } from "../core/model";
import type { Area, Clip } from "../core/selection";
import { inArea } from "../core/selection";
import { TERRAIN_TYPES, getPalette } from "../core/terrain";
import { PORYMAP_BLOCKED_TEXT, PORYMAP_ELEVATION_COLORS, PORYMAP_PASSABLE_TEXT, cellElevationValue, hexDigit, isImpassable } from "../core/porymap";
import { trainerSight } from "../core/entities";
import { ENTITY_COLORS, screenName } from "../core/exporters/blueprint";
import { openingCells } from "../core/reach";
import type { Issue } from "../core/validate";
import type { Overlays } from "./prefs";
import { zoneColor } from "./zoneColors";
import { DEFAULT_PREFS } from "./prefs";
import { drawUnderlay, underlayPicture } from "./underlay";

/** Heatmap colours: index = heatmap value + 1 (see hmHeatmap in core/reach.ts). */
export const HEAT_COLORS: Record<number, string> = {
  [-1]: "rgba(224, 72, 72, 0.55)", // can't be reached at all
  0: "rgba(0, 0, 0, 0)", // reachable with no HMs
  1: "rgba(72, 190, 90, 0.5)", // Cut
  2: "rgba(176, 128, 72, 0.55)", // Rock Smash
  3: "rgba(150, 150, 150, 0.55)", // Strength
  4: "rgba(70, 150, 230, 0.5)", // Surf
  5: "rgba(120, 220, 230, 0.55)", // Waterfall
  6: "rgba(40, 70, 170, 0.55)", // Dive
  7: "rgba(170, 90, 210, 0.55)", // several HMs
};

const CHUNK = 32;
const CELL_PX = 16;
export const RULER_TOP = 22;
export const RULER_LEFT = 30;
/** Room kept free for the floating tool strip when fitting the map. */
const TOOLBAR_SPACE = 64;
export const MIN_SCALE = 2;
export const MAX_SCALE = 64;

interface Chunk {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

export interface View {
  /** Screen pixels per cell. */
  scale: number;
  /** Screen position (CSS px) of the map's top-left corner. */
  offsetX: number;
  offsetY: number;
}

/** Spreadsheet-style label of the 15×10 GBA screen containing a cell: A1, B1, A2… */
export function screenLabel(x: number, y: number): string {
  return screenName(Math.floor(x / SCREEN_WIDTH_METATILES), Math.floor(y / SCREEN_HEIGHT_METATILES));
}

export class MapRenderer {
  private ctx: CanvasRenderingContext2D;
  private chunks: Chunk[] = [];
  private chunkCols = 0;
  private map: MapBlueprint | null = null;
  private colors: string[] = [];
  private frameRequested = false;
  private cssWidth = 0;
  private cssHeight = 0;

  view: View = { scale: 16, offsetX: RULER_LEFT + 16, offsetY: RULER_TOP + 16 };
  overlays: Overlays = { ...DEFAULT_PREFS.overlays };
  /** Cell under the pointer, or null. */
  hover: [number, number] | null = null;
  /** Reachability heatmap for the shown map (or null when the overlay is off). */
  heat: Int8Array | null = null;
  /** Validation results to mark on the map. */
  issues: Issue[] = [];
  /** Cells to highlight briefly after clicking a problem. */
  private flash: { cells: number[]; until: number } | null = null;
  /** Opacity of the Elevation overlay. */
  elevationOpacity = DEFAULT_PREFS.elevationOpacity;
  /** Width of the outline drawn around the hovered cell: the brush size when painting, else 1. */
  brush = 1;
  /** The selected area (a rectangle, or a lasso shape). */
  selection: Area | null = null;
  /** A smart stroke being drawn: its cells, width, whether it's an outline, and its colour. */
  smartPreview: { points: number[]; width: number; closed: boolean; color: string } | null = null;
  /** The line being drawn with the Lasso. */
  lassoPoints: Array<[number, number]> | null = null;
  /** An area being moved or pasted, drawn where it would land. */
  floating: { clip: Clip; x: number; y: number } | null = null;
  /** ID of the thing picked with the Things tool. */
  selectedThing: string | null = null;
  /** The zone being painted (drawn stronger, with an outline). */
  activeZoneId: string | null = null;
  /** Connected maps, drawn faded beyond the edges (cell offsets from this map's top-left). */
  neighbours: Array<{ name: string; dx: number; dy: number; w: number; h: number; bitmap: HTMLCanvasElement }> = [];
  /** Setting the reference image's scale: the points tapped so far (metatiles). */
  calibration: Array<[number, number]> = [];

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser can't draw on a canvas.");
    this.ctx = ctx;
  }

  /** The palette colour of a terrain type (for previews). */
  colorOf(terrain: number): string {
    return this.colors[terrain] ?? "#ffffff";
  }

  setPalette(paletteId: string) {
    const p = getPalette(paletteId);
    this.colors = TERRAIN_TYPES.map((t) => p.colors[t.id]);
  }

  /** Show a different map (or the same map after a big change): rebuild every chunk. */
  setMap(map: MapBlueprint | null) {
    this.map = map;
    this.chunks = [];
    if (map) {
      this.chunkCols = Math.ceil(map.width / CHUNK);
      const rows = Math.ceil(map.height / CHUNK);
      for (let cy = 0; cy < rows; cy++)
        for (let cx = 0; cx < this.chunkCols; cx++) {
          const canvas = document.createElement("canvas");
          canvas.width = Math.min(CHUNK, map.width - cx * CHUNK) * CELL_PX;
          canvas.height = Math.min(CHUNK, map.height - cy * CHUNK) * CELL_PX;
          const ctx = canvas.getContext("2d")!;
          this.chunks.push({ canvas, ctx });
        }
      for (let i = 0; i < map.width * map.height; i++) this.drawCell(i);
    }
    this.requestFrame();
  }

  /**
   * The maps connected to this one, placed as the game joins them: a map connected "down"
   * sits below, `offset` cells to the right (pokeemerald src/fieldmap.c), and so on.
   */
  setNeighbours(map: MapBlueprint | null, all: MapBlueprint[]) {
    this.neighbours = [];
    if (!map) return;
    for (const c of map.connections) {
      const n = all.find((m) => m.id === c.map);
      if (!n) continue;
      const at =
        c.direction === "up" ? [c.offset, -n.height] : c.direction === "down" ? [c.offset, map.height] : c.direction === "left" ? [-n.width, c.offset] : c.direction === "right" ? [map.width, c.offset] : null;
      if (!at) continue;
      const bitmap = document.createElement("canvas");
      bitmap.width = n.width;
      bitmap.height = n.height;
      const ctx = bitmap.getContext("2d")!;
      for (let i = 0; i < n.width * n.height; i++) {
        ctx.fillStyle = this.colors[n.layers.terrain.data[i]] ?? "#ff00ff";
        ctx.fillRect(i % n.width, Math.floor(i / n.width), 1, 1);
      }
      this.neighbours.push({ name: n.name, dx: at[0], dy: at[1], w: n.width, h: n.height, bitmap });
    }
    this.requestFrame();
  }

  /** Redraw only these cells (by index y * width + x). */
  updateCells(indices: number[]) {
    for (const i of indices) this.drawCell(i);
    this.requestFrame();
  }

  private drawCell(i: number) {
    const map = this.map!;
    const x = i % map.width;
    const y = (i - x) / map.width;
    const chunk = this.chunks[Math.floor(y / CHUNK) * this.chunkCols + Math.floor(x / CHUNK)];
    const ctx = chunk.ctx;
    const px = (x % CHUNK) * CELL_PX;
    const py = (y % CHUNK) * CELL_PX;
    const t = map.layers.terrain.data[i];
    ctx.fillStyle = this.colors[t] ?? "#ff00ff";
    ctx.fillRect(px, py, CELL_PX, CELL_PX);
    const glyph = TERRAIN_TYPES[t]?.glyph;
    if (glyph) {
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.font = "bold 12px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(glyph, px + CELL_PX / 2, py + CELL_PX / 2 + 1);
    }
    if (this.overlays.locks && map.layers.locks.data[i]) {
      // A small corner triangle marks locked cells.
      ctx.fillStyle = "rgba(255, 210, 90, 0.9)";
      ctx.beginPath();
      ctx.moveTo(px + CELL_PX, py);
      ctx.lineTo(px + CELL_PX, py + 6);
      ctx.lineTo(px + CELL_PX - 6, py);
      ctx.closePath();
      ctx.fill();
    }
  }

  /** Match the canvas bitmap to its on-screen size (and the screen's pixel density). */
  resize(cssWidth: number, cssHeight: number) {
    const dpr = window.devicePixelRatio || 1;
    this.cssWidth = cssWidth;
    this.cssHeight = cssHeight;
    this.canvas.width = Math.round(cssWidth * dpr);
    this.canvas.height = Math.round(cssHeight * dpr);
    this.requestFrame();
  }

  get size() {
    return { width: this.cssWidth, height: this.cssHeight };
  }

  /** Which cell is at a screen position (may be outside the map). */
  cellAt(sx: number, sy: number): [number, number] {
    return [Math.floor((sx - this.view.offsetX) / this.view.scale), Math.floor((sy - this.view.offsetY) / this.view.scale)];
  }

  /** The point under a screen position, in metatiles, not rounded to a cell. */
  pointAt(sx: number, sy: number): [number, number] {
    return [(sx - this.view.offsetX) / this.view.scale, (sy - this.view.offsetY) / this.view.scale];
  }

  /** Zoom by a factor, keeping the point (sx, sy) fixed on screen. */
  zoomAt(factor: number, sx: number, sy: number) {
    const v = this.view;
    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor));
    const k = next / v.scale;
    v.offsetX = sx - (sx - v.offsetX) * k;
    v.offsetY = sy - (sy - v.offsetY) * k;
    v.scale = next;
    this.requestFrame();
  }

  panBy(dx: number, dy: number) {
    this.view.offsetX += dx;
    this.view.offsetY += dy;
    this.requestFrame();
  }

  /** Centre the view on a cell and briefly highlight some cells. */
  focusOn(x: number, y: number, cells: number[]) {
    const v = this.view;
    if (v.scale < 12) v.scale = 12;
    v.offsetX = this.cssWidth / 2 - (x + 0.5) * v.scale;
    v.offsetY = this.cssHeight / 2 - (y + 0.5) * v.scale;
    this.flash = { cells: cells.slice(0, 2000), until: performance.now() + 2500 };
    this.requestFrame();
  }

  /** Zoom and centre so the whole map fits on screen, clear of the tool strip on the left. */
  fit() {
    const map = this.map;
    if (!map || !this.cssWidth) return;
    const pad = 24;
    const left = RULER_LEFT + TOOLBAR_SPACE;
    const availW = this.cssWidth - left - pad * 2;
    const availH = this.cssHeight - RULER_TOP - pad * 2;
    const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.floor(Math.min(availW / map.width, availH / map.height))));
    this.view.scale = scale;
    this.view.offsetX = left + pad + Math.max(0, (availW - map.width * scale) / 2);
    this.view.offsetY = RULER_TOP + pad + Math.max(0, (availH - map.height * scale) / 2);
    this.requestFrame();
  }

  requestFrame() {
    if (this.frameRequested) return;
    this.frameRequested = true;
    requestAnimationFrame(() => {
      this.frameRequested = false;
      this.draw();
    });
  }

  private draw() {
    const ctx = this.ctx;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#15191c";
    ctx.fillRect(0, 0, this.cssWidth, this.cssHeight);
    const map = this.map;
    if (!map) return;
    const { scale, offsetX, offsetY } = this.view;

    // Connected maps, faded, where the game joins them on (the stitched view).
    ctx.imageSmoothingEnabled = false;
    if (this.overlays.neighbours)
      for (const n of this.neighbours) {
        const x = offsetX + n.dx * scale;
        const y = offsetY + n.dy * scale;
        ctx.globalAlpha = 0.4;
        ctx.drawImage(n.bitmap, x, y, n.w * scale, n.h * scale);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = "rgba(255,255,255,0.35)";
        ctx.setLineDash([6, 4]);
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, n.w * scale, n.h * scale);
        ctx.setLineDash([]);
        // The name, in the part of it nearest this map that's on screen.
        const cx = Math.max(x + 60, Math.min(x + n.w * scale - 60, offsetX + (map.width * scale) / 2));
        const cy = Math.max(y + 14, Math.min(y + n.h * scale - 14, offsetY + (map.height * scale) / 2));
        ctx.font = "600 12px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const w = ctx.measureText(n.name).width + 10;
        ctx.fillStyle = "rgba(15,20,23,0.75)";
        ctx.fillRect(cx - w / 2, cy - 9, w, 18);
        ctx.fillStyle = "#dfe5e8";
        ctx.fillText(n.name, cx, cy);
      }

    // Terrain: stretch each visible chunk bitmap onto the screen, without blurring.
    this.chunks.forEach((chunk, k) => {
      const cx = (k % this.chunkCols) * CHUNK;
      const cy = Math.floor(k / this.chunkCols) * CHUNK;
      const x = offsetX + cx * scale;
      const y = offsetY + cy * scale;
      const w = (chunk.canvas.width / CELL_PX) * scale;
      const h = (chunk.canvas.height / CELL_PX) * scale;
      if (x > this.cssWidth || y > this.cssHeight || x + w < 0 || y + h < 0) return;
      ctx.drawImage(chunk.canvas, x, y, w, h);
    });

    // The reference image, faded, on top of the terrain.
    const u = map.underlay;
    if (u?.visible) {
      const pic = underlayPicture(u, () => this.requestFrame(), "map");
      if (pic) drawUnderlay(ctx, u, pic, (x) => offsetX + x * scale, (y) => offsetY + y * scale, scale);
    }

    // Visible cell range, for overlays and grid lines.
    const x0 = Math.max(0, Math.floor(-offsetX / scale));
    const y0 = Math.max(0, Math.floor(-offsetY / scale));
    const x1 = Math.min(map.width, Math.ceil((this.cssWidth - offsetX) / scale));
    const y1 = Math.min(map.height, Math.ceil((this.cssHeight - offsetY) / scale));
    const cellRect = (i: number, inset = 0) => {
      const x = i % map.width;
      const y = (i - x) / map.width;
      return [offsetX + x * scale + inset, offsetY + y * scale + inset, scale - inset * 2, scale - inset * 2] as const;
    };

    // Elevation, as Porymap's collision view shows it: each cell in the colour of its
    // elevation number (0–F), with the number in white (walkable) or red (blocked).
    if (this.overlays.elevation) {
      const elev = map.layers.elevation.data;
      const terrain = map.layers.terrain.data;
      ctx.globalAlpha = this.elevationOpacity;
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) {
          const i = y * map.width + x;
          ctx.fillStyle = PORYMAP_ELEVATION_COLORS[cellElevationValue(terrain[i], elev[i])];
          ctx.fillRect(offsetX + x * scale, offsetY + y * scale, scale, scale);
        }
      ctx.globalAlpha = 1;
      if (scale >= 10) {
        ctx.font = `bold ${Math.floor(scale * 0.6)}px system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.lineWidth = Math.max(2, scale / 8);
        ctx.strokeStyle = "rgba(0,0,0,0.75)";
        for (let y = y0; y < y1; y++)
          for (let x = x0; x < x1; x++) {
            const i = y * map.width + x;
            const label = hexDigit(cellElevationValue(terrain[i], elev[i]));
            const cx = offsetX + (x + 0.5) * scale;
            const cy = offsetY + (y + 0.5) * scale + 1;
            ctx.strokeText(label, cx, cy);
            ctx.fillStyle = isImpassable(terrain[i]) ? PORYMAP_BLOCKED_TEXT : PORYMAP_PASSABLE_TEXT;
            ctx.fillText(label, cx, cy);
          }
      }
    }

    // The user's zones: a wash of each zone's colour, the one being painted stronger and outlined.
    if (this.overlays.zones) {
      for (const z of map.layers.zones) {
        if (z.data.generated === true) continue;
        const active = z.id === this.activeZoneId;
        ctx.fillStyle = zoneColor(z);
        ctx.globalAlpha = active ? 0.45 : 0.28;
        for (let y = y0; y < y1; y++)
          for (let x = x0; x < x1; x++) if (z.mask.data[y * map.width + x]) ctx.fillRect(offsetX + x * scale, offsetY + y * scale, scale, scale);
        ctx.globalAlpha = 1;
        // Outline round the zone's edge.
        ctx.beginPath();
        const inZ = (x: number, y: number) => x >= 0 && y >= 0 && x < map.width && y < map.height && z.mask.data[y * map.width + x] === 1;
        for (let y = y0; y < y1; y++)
          for (let x = x0; x < x1; x++) {
            if (!inZ(x, y)) continue;
            const sx = offsetX + x * scale;
            const sy = offsetY + y * scale;
            if (!inZ(x, y - 1)) (ctx.moveTo(sx, sy), ctx.lineTo(sx + scale, sy));
            if (!inZ(x, y + 1)) (ctx.moveTo(sx, sy + scale), ctx.lineTo(sx + scale, sy + scale));
            if (!inZ(x - 1, y)) (ctx.moveTo(sx, sy), ctx.lineTo(sx, sy + scale));
            if (!inZ(x + 1, y)) (ctx.moveTo(sx + scale, sy), ctx.lineTo(sx + scale, sy + scale));
          }
        ctx.strokeStyle = zoneColor(z);
        ctx.lineWidth = active ? 3 : 1.5;
        if (!z.hard) ctx.setLineDash([5, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // Reachability heatmap.
    if (this.overlays.reach && this.heat) {
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) {
          const v = this.heat[y * map.width + x];
          if (v <= 0 && v !== -1) continue;
          ctx.fillStyle = HEAT_COLORS[v];
          ctx.fillRect(offsetX + x * scale, offsetY + y * scale, scale, scale);
        }
    }

    if (this.overlays.grid) {
      const line = (along: "x" | "y", i: number, style: string, width: number) => {
        ctx.strokeStyle = style;
        ctx.lineWidth = width;
        ctx.beginPath();
        if (along === "x") {
          const x = Math.round(offsetX + i * scale) + 0.5;
          ctx.moveTo(x, offsetY + y0 * scale);
          ctx.lineTo(x, offsetY + y1 * scale);
        } else {
          const y = Math.round(offsetY + i * scale) + 0.5;
          ctx.moveTo(offsetX + x0 * scale, y);
          ctx.lineTo(offsetX + x1 * scale, y);
        }
        ctx.stroke();
      };
      for (let x = x0; x <= x1; x++) {
        if (x % 10 === 0) line("x", x, "rgba(255,255,255,0.45)", 1);
        else if (x % 5 === 0) line("x", x, "rgba(255,255,255,0.25)", 1);
        else if (scale >= 8) line("x", x, "rgba(0,0,0,0.22)", 1);
      }
      for (let y = y0; y <= y1; y++) {
        if (y % 10 === 0) line("y", y, "rgba(255,255,255,0.45)", 1);
        else if (y % 5 === 0) line("y", y, "rgba(255,255,255,0.25)", 1);
        else if (scale >= 8) line("y", y, "rgba(0,0,0,0.22)", 1);
      }
    }

    // Map outline.
    ctx.strokeStyle = "rgba(255,255,255,0.8)";
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(offsetX) - 0.5, Math.round(offsetY) - 0.5, map.width * scale + 1, map.height * scale + 1);

    // Entrances: yellow outline for walk entrances, light blue for surf entrances.
    ctx.lineWidth = 2;
    for (const o of map.openings) {
      ctx.strokeStyle = o.kind === "surf" ? "rgba(120, 220, 255, 0.95)" : "rgba(255, 214, 60, 0.95)";
      for (const c of openingCells(o, map.width, map.height)) ctx.strokeRect(...cellRect(c, 1));
    }

    // Trainer sight lines.
    if (this.overlays.sight) {
      for (const e of map.entities) {
        if (e.kind !== "trainer") continue;
        const sight = trainerSight(e, map.width, map.height, map.layers.terrain.data);
        ctx.fillStyle = "rgba(208, 69, 58, 0.3)";
        for (const c of sight) ctx.fillRect(...cellRect(c));
        if (sight.length) {
          const last = sight[sight.length - 1];
          ctx.strokeStyle = "rgba(208, 69, 58, 0.9)";
          ctx.lineWidth = Math.max(1.5, scale / 8);
          ctx.beginPath();
          ctx.moveTo(offsetX + (e.x + 0.5) * scale, offsetY + (e.y + 0.5) * scale);
          ctx.lineTo(offsetX + ((last % map.width) + 0.5) * scale, offsetY + (Math.floor(last / map.width) + 0.5) * scale);
          ctx.stroke();
        }
      }
    }

    // Things on the map: a coloured tile, with its ID when zoomed in enough.
    const marker = (x: number, y: number, color: string, label: string) => {
      const sx = offsetX + x * scale;
      const sy = offsetY + y * scale;
      if (sx + scale < 0 || sy + scale < 0 || sx > this.cssWidth || sy > this.cssHeight) return;
      const pad = Math.max(1, scale * 0.08);
      ctx.fillStyle = color;
      ctx.fillRect(sx + pad, sy + pad, scale - pad * 2, scale - pad * 2);
      ctx.strokeStyle = "rgba(0,0,0,0.7)";
      ctx.lineWidth = 1;
      ctx.strokeRect(sx + pad + 0.5, sy + pad + 0.5, scale - pad * 2 - 1, scale - pad * 2 - 1);
      if (scale >= 14) {
        ctx.fillStyle = "#fff";
        ctx.font = `bold ${Math.floor(scale * 0.42)}px system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(label, sx + scale / 2, sy + scale / 2 + 1);
      }
    };
    for (const e of map.entities) marker(e.x, e.y, ENTITY_COLORS[e.kind], e.id);
    map.warps.forEach((w, k) => marker(w.x, w.y, ENTITY_COLORS.warp, `W${k}`));

    // The picked thing: a bright ring.
    const picked = this.selectedThing ? (map.entities.find((e) => e.id === this.selectedThing) ?? map.warps.find((w) => w.id === this.selectedThing)) : null;
    if (picked) {
      ctx.strokeStyle = "#ffd666";
      ctx.lineWidth = Math.max(2, scale / 6);
      ctx.strokeRect(offsetX + picked.x * scale - 1, offsetY + picked.y * scale - 1, scale + 2, scale + 2);
    }

    // An area being moved or pasted: its cells and things where they'd land.
    // An outline round an area: black under white dashes, so it shows on any colour.
    // A lasso shape is outlined along every edge between a selected and an unselected cell.
    const dashed = (a: Area) => {
      ctx.beginPath();
      if (!a.mask) {
        ctx.rect(offsetX + a.x * scale + 0.5, offsetY + a.y * scale + 0.5, a.w * scale - 1, a.h * scale - 1);
      } else {
        for (let y = a.y; y < a.y + a.h; y++)
          for (let x = a.x; x < a.x + a.w; x++) {
            if (!inArea(a, x, y)) continue;
            const sx = offsetX + x * scale;
            const sy = offsetY + y * scale;
            if (!inArea(a, x, y - 1)) (ctx.moveTo(sx, sy), ctx.lineTo(sx + scale, sy));
            if (!inArea(a, x, y + 1)) (ctx.moveTo(sx, sy + scale), ctx.lineTo(sx + scale, sy + scale));
            if (!inArea(a, x - 1, y)) (ctx.moveTo(sx, sy), ctx.lineTo(sx, sy + scale));
            if (!inArea(a, x + 1, y)) (ctx.moveTo(sx + scale, sy), ctx.lineTo(sx + scale, sy + scale));
          }
      }
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      ctx.strokeStyle = "rgba(0,0,0,0.85)";
      ctx.stroke();
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();
      ctx.setLineDash([]);
    };
    if (this.floating) {
      const { clip, x, y } = this.floating;
      ctx.globalAlpha = 0.9;
      for (let cy = 0; cy < clip.h; cy++)
        for (let cx = 0; cx < clip.w; cx++) {
          if (clip.mask && !clip.mask[cy * clip.w + cx]) continue;
          ctx.fillStyle = this.colors[clip.terrain[cy * clip.w + cx]] ?? "#ff00ff";
          ctx.fillRect(offsetX + (x + cx) * scale, offsetY + (y + cy) * scale, scale, scale);
        }
      ctx.globalAlpha = 1;
      for (const e of clip.entities) marker(x + e.x, y + e.y, ENTITY_COLORS[e.kind], e.id);
      dashed({ x, y, w: clip.w, h: clip.h, mask: clip.mask });
    } else if (this.selection) dashed(this.selection);

    // A smart stroke being drawn: a line as wide as the stroke, or an outline to fill.
    const sp = this.smartPreview;
    if (sp && sp.points.length >= 2) {
      ctx.beginPath();
      for (let k = 0; k + 1 < sp.points.length; k += 2) {
        const px = offsetX + (sp.points[k] + 0.5) * scale;
        const py = offsetY + (sp.points[k + 1] + 0.5) * scale;
        if (k === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      if (sp.closed) ctx.closePath();
      ctx.lineCap = "square";
      ctx.lineJoin = "round";
      ctx.globalAlpha = 0.75;
      ctx.lineWidth = sp.closed ? 2 : Math.max(2, sp.width * scale);
      ctx.strokeStyle = sp.color;
      ctx.stroke();
      if (sp.closed) {
        ctx.globalAlpha = 0.3;
        ctx.fillStyle = sp.color;
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.lineCap = "butt";
      ctx.lineJoin = "miter";
      if (sp.points.length === 2) ctx.fillRect(offsetX + sp.points[0] * scale, offsetY + sp.points[1] * scale, scale, scale);
    }

    // The lasso line being drawn.
    if (this.lassoPoints && this.lassoPoints.length > 1) {
      ctx.beginPath();
      this.lassoPoints.forEach(([px, py], k) => (k ? ctx.lineTo(offsetX + px * scale, offsetY + py * scale) : ctx.moveTo(offsetX + px * scale, offsetY + py * scale)));
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(0,0,0,0.85)";
      ctx.stroke();
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = "#ffd666";
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Validation markers.
    if (this.overlays.issues) {
      for (const issue of this.issues) {
        ctx.strokeStyle = issue.severity === "error" ? "rgba(255, 80, 80, 0.95)" : "rgba(255, 190, 60, 0.9)";
        ctx.lineWidth = 2;
        for (const c of issue.cells.slice(0, 400)) ctx.strokeRect(...cellRect(c, 2));
      }
    }

    // Brief highlight after clicking a problem in the list.
    if (this.flash) {
      const left = this.flash.until - performance.now();
      if (left <= 0) this.flash = null;
      else {
        ctx.fillStyle = `rgba(255, 255, 255, ${0.25 + 0.25 * Math.sin(left / 120)})`;
        for (const c of this.flash.cells) ctx.fillRect(...cellRect(c));
        this.requestFrame();
      }
    }

    // Setting the reference image's scale: the points tapped (A, B) and the line between.
    if (this.calibration.length) {
      const P = (p: [number, number]) => [offsetX + p[0] * scale, offsetY + p[1] * scale] as const;
      ctx.strokeStyle = "#e6b450";
      ctx.lineWidth = 2;
      if (this.calibration.length === 2) {
        ctx.beginPath();
        ctx.moveTo(...P(this.calibration[0]));
        ctx.lineTo(...P(this.calibration[1]));
        ctx.stroke();
      }
      ctx.font = "600 12px system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      this.calibration.forEach((p, k) => {
        const [x, y] = P(p);
        ctx.beginPath();
        ctx.moveTo(x - 10, y);
        ctx.lineTo(x + 10, y);
        ctx.moveTo(x, y - 10);
        ctx.lineTo(x, y + 10);
        ctx.stroke();
        ctx.fillStyle = "#e6b450";
        ctx.fillText(k === 0 ? "A" : "B", x + 8, y - 12);
      });
    }

    // Hovered cell, and the 15×10 GBA screen around it.
    if (this.hover) {
      const [hx, hy] = this.hover;
      if (this.overlays.screenFrame) {
        const fx = hx - PLAYER_SCREEN_X;
        const fy = hy - PLAYER_SCREEN_Y;
        ctx.strokeStyle = "rgba(255, 214, 102, 0.95)";
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.strokeRect(offsetX + fx * scale, offsetY + fy * scale, SCREEN_WIDTH_METATILES * scale, SCREEN_HEIGHT_METATILES * scale);
        ctx.setLineDash([]);
      }
      // Outline the cells the brush will paint (same footprint as brushCells in core/paint.ts).
      const start = -Math.floor((this.brush - 1) / 2);
      const bx = hx + start;
      const by = hy + start;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.strokeRect(offsetX + bx * scale + 1, offsetY + by * scale + 1, this.brush * scale - 2, this.brush * scale - 2);
    }

    if (this.overlays.rulers) this.drawRulers(map);
  }

  private drawRulers(map: MapBlueprint) {
    const ctx = this.ctx;
    const { scale, offsetX, offsetY } = this.view;
    ctx.fillStyle = "#20262b";
    ctx.fillRect(0, 0, this.cssWidth, RULER_TOP);
    ctx.fillRect(0, 0, RULER_LEFT, this.cssHeight);
    ctx.strokeStyle = "#8a959c";
    ctx.fillStyle = "#c9d1d6";
    ctx.font = "11px system-ui, sans-serif";
    ctx.lineWidth = 1;

    // Label every 10 cells, or every 5 when zoomed in.
    const labelStep = scale >= 12 ? 5 : 10;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    for (let x = 0; x <= map.width; x++) {
      const sx = Math.round(offsetX + x * scale) + 0.5;
      if (sx < RULER_LEFT || sx > this.cssWidth) continue;
      const len = x % 10 === 0 ? 10 : x % 5 === 0 ? 6 : scale >= 8 ? 3 : 0;
      if (!len) continue;
      ctx.beginPath();
      ctx.moveTo(sx, RULER_TOP - len);
      ctx.lineTo(sx, RULER_TOP);
      ctx.stroke();
      if (x % labelStep === 0 && x < map.width) ctx.fillText(String(x), sx + 2, 2);
    }
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    for (let y = 0; y <= map.height; y++) {
      const sy = Math.round(offsetY + y * scale) + 0.5;
      if (sy < RULER_TOP || sy > this.cssHeight) continue;
      const len = y % 10 === 0 ? 10 : y % 5 === 0 ? 6 : scale >= 8 ? 3 : 0;
      if (!len) continue;
      ctx.beginPath();
      ctx.moveTo(RULER_LEFT - len, sy);
      ctx.lineTo(RULER_LEFT, sy);
      ctx.stroke();
      if (y % labelStep === 0 && y < map.height) ctx.fillText(String(y), RULER_LEFT - 3, sy + 2);
    }

    // Highlight the hovered row and column on the rulers.
    if (this.hover) {
      const [hx, hy] = this.hover;
      ctx.fillStyle = "rgba(255, 214, 102, 0.35)";
      ctx.fillRect(offsetX + hx * scale, 0, scale, RULER_TOP);
      ctx.fillRect(0, offsetY + hy * scale, RULER_LEFT, scale);
    }
    ctx.fillStyle = "#20262b";
    ctx.fillRect(0, 0, RULER_LEFT, RULER_TOP);
  }
}
