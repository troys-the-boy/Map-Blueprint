// Draws a map on an HTML canvas.
//
// The map is cut into chunks of 32×32 cells. Each chunk is pre-drawn once into
// its own off-screen bitmap (16 px per cell), and only cells that change are
// redrawn into it. Each frame just stretches the visible chunk bitmaps onto the
// screen and draws the overlays (grid, rulers, screen frame) on top. This keeps
// large maps (e.g. 40×170) smooth on an iPad.

import { SCREEN_HEIGHT_METATILES, SCREEN_WIDTH_METATILES, PLAYER_SCREEN_X, PLAYER_SCREEN_Y } from "../core/constants";
import type { MapBlueprint } from "../core/model";
import { TERRAIN_TYPES, getPalette } from "../core/terrain";
import type { Overlays } from "./prefs";

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
  let col = Math.floor(x / SCREEN_WIDTH_METATILES);
  let letters = "";
  do {
    letters = String.fromCharCode(65 + (col % 26)) + letters;
    col = Math.floor(col / 26) - 1;
  } while (col >= 0);
  return `${letters}${Math.floor(y / SCREEN_HEIGHT_METATILES) + 1}`;
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
  overlays: Overlays = { grid: true, rulers: true, screenFrame: true, locks: false };
  /** Cell under the pointer, or null. */
  hover: [number, number] | null = null;
  /** Width of the outline drawn around the hovered cell: the brush size when painting, else 1. */
  brush = 1;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser can't draw on a canvas.");
    this.ctx = ctx;
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

    // Terrain: stretch each visible chunk bitmap onto the screen, without blurring.
    ctx.imageSmoothingEnabled = false;
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

    // Visible cell range, for the grid lines.
    const x0 = Math.max(0, Math.floor(-offsetX / scale));
    const y0 = Math.max(0, Math.floor(-offsetY / scale));
    const x1 = Math.min(map.width, Math.ceil((this.cssWidth - offsetX) / scale));
    const y1 = Math.min(map.height, Math.ceil((this.cssHeight - offsetY) / scale));

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
