// Blueprint images: the map drawn at 16 px per cell (the same as a Gen 3
// metatile), with a coordinate ruler, grid, numbered entities, trainer sight
// lines, entrances and a colour legend.

import { METATILE_PIXELS } from "../constants";
import { trainerSight } from "../entities";
import type { EntityKind, MapBlueprint } from "../model";
import { openingCells } from "../reach";
import { TERRAIN_TYPES, getPalette } from "../terrain";
import type { RGBA } from "./raster";
import { Raster, hexToRgba, textWidth } from "./raster";

const C = METATILE_PIXELS;
const RULER_TOP = 18;
const RULER_LEFT = 28;

const INK: RGBA = [30, 34, 38, 255];
const PAPER: RGBA = [246, 246, 242, 255];
const MUTED: RGBA = [110, 118, 124, 255];

/** Colour of each entity kind's marker. */
export const ENTITY_COLORS: Record<EntityKind | "warp", string> = {
  trainer: "#d0453a",
  npc: "#3a7bd0",
  item_ball: "#e3b23c",
  hidden_item: "#b38a2a",
  cut_tree: "#3f9d4a",
  smash_rock: "#8a6a4a",
  strength_boulder: "#6a6a6a",
  berry_tree: "#b04a9a",
  trigger: "#7a4ad0",
  sign: "#c08040",
  secret_base: "#4a9a9a",
  heal_location: "#e06090",
  warp: "#8040c0",
};

export interface BlueprintOptions {
  paletteId: string;
  /** Draw only this part of the map (in cells). Default: the whole map. */
  area?: { x: number; y: number; width: number; height: number };
  title?: string;
  subtitle?: string;
  legend?: boolean;
  /** Label the ruler every N cells. */
  labelEvery?: number;
}

export function renderBlueprint(map: MapBlueprint, opts: BlueprintOptions): Raster {
  const area = opts.area ?? { x: 0, y: 0, width: map.width, height: map.height };
  const labelEvery = opts.labelEvery ?? 10;
  const palette = getPalette(opts.paletteId);
  const colors = TERRAIN_TYPES.map((t) => hexToRgba(palette.colors[t.id]));
  const terrain = map.layers.terrain.data;

  const titleH = opts.title ? (opts.subtitle ? 34 : 22) : 0;
  const used = [...new Set(Array.from(terrain))].sort((a, b) => a - b);
  const kinds = [...new Set(map.entities.map((e) => e.kind))];
  const legendW = opts.legend ? 190 : 0;
  const legendRows = used.length + kinds.length + (map.warps.length ? 1 : 0) + 4;
  const mapW = area.width * C;
  const mapH = area.height * C;
  const width = RULER_LEFT + mapW + 8 + legendW;
  const height = Math.max(titleH + RULER_TOP + mapH + 8, opts.legend ? titleH + 8 + legendRows * 14 : 0);
  const img = new Raster(width, height, PAPER);
  const ox = RULER_LEFT;
  const oy = titleH + RULER_TOP;
  const inArea = (x: number, y: number) => x >= area.x && y >= area.y && x < area.x + area.width && y < area.y + area.height;
  const px = (x: number) => ox + (x - area.x) * C;
  const py = (y: number) => oy + (y - area.y) * C;

  if (opts.title) {
    img.text(4, 4, opts.title, INK, 2);
    if (opts.subtitle) img.text(4, 23, opts.subtitle, MUTED);
  }

  // Terrain and glyphs.
  for (let y = area.y; y < area.y + area.height; y++)
    for (let x = area.x; x < area.x + area.width; x++) {
      const t = terrain[y * map.width + x];
      img.fillRect(px(x), py(y), C, C, colors[t]);
      const glyph = TERRAIN_TYPES[t].glyph;
      if (glyph) img.text(px(x) + 5, py(y) + 4, glyph, [255, 255, 255, 220]);
    }

  // Grid: faint every cell, stronger every 5, strongest every 10.
  const gridLine = (v: number): RGBA => (v % 10 === 0 ? [255, 255, 255, 150] : v % 5 === 0 ? [255, 255, 255, 80] : [0, 0, 0, 40]);
  for (let x = area.x; x <= area.x + area.width; x++) img.fillRect(px(x), oy, 1, mapH, gridLine(x));
  for (let y = area.y; y <= area.y + area.height; y++) img.fillRect(ox, py(y), mapW, 1, gridLine(y));

  // Rulers.
  for (let x = area.x; x <= area.x + area.width; x++) {
    const len = x % 10 === 0 ? 8 : x % 5 === 0 ? 5 : 2;
    img.fillRect(px(x), oy - len, 1, len, INK);
    if (x % labelEvery === 0 && x < area.x + area.width) img.text(px(x) + 2, titleH + 1, String(x), INK);
  }
  for (let y = area.y; y <= area.y + area.height; y++) {
    const len = y % 10 === 0 ? 8 : y % 5 === 0 ? 5 : 2;
    img.fillRect(ox - len, py(y), len, 1, INK);
    if (y % labelEvery === 0 && y < area.y + area.height) img.text(ox - 2 - textWidth(String(y)), py(y) + 2, String(y), INK);
  }
  img.strokeRect(ox - 1, oy - 1, mapW + 2, mapH + 2, INK);

  // Entrances: yellow outline for walk entrances, light blue for surf entrances.
  for (const o of map.openings)
    for (const c of openingCells(o, map.width, map.height)) {
      const x = c % map.width;
      const y = Math.floor(c / map.width);
      if (inArea(x, y)) img.strokeRect(px(x), py(y), C, C, o.kind === "surf" ? [120, 220, 255, 255] : [255, 214, 60, 255], 2);
    }

  // Trainer sight lines: tinted cells plus a line from the trainer.
  for (const e of map.entities) {
    if (e.kind !== "trainer") continue;
    const sight = trainerSight(e, map.width, map.height, terrain);
    for (const c of sight) {
      const x = c % map.width;
      const y = Math.floor(c / map.width);
      if (inArea(x, y)) img.fillRect(px(x), py(y), C, C, [208, 69, 58, 70]);
    }
    if (sight.length && inArea(e.x, e.y)) {
      const last = sight[sight.length - 1];
      const lx = Math.max(area.x, Math.min(area.x + area.width - 1, last % map.width));
      const ly = Math.max(area.y, Math.min(area.y + area.height - 1, Math.floor(last / map.width)));
      img.line(px(e.x) + C / 2, py(e.y) + C / 2, px(lx) + C / 2, py(ly) + C / 2, [208, 69, 58, 220], 2);
    }
  }

  // Entities: a coloured tile with the ID (T1, I2…).
  const marker = (x: number, y: number, color: string, label: string) => {
    if (!inArea(x, y)) return;
    img.fillRect(px(x) + 1, py(y) + 1, C - 1, C - 1, hexToRgba(color));
    img.strokeRect(px(x) + 1, py(y) + 1, C - 1, C - 1, INK);
    const w = textWidth(label);
    if (w <= C) img.text(px(x) + Math.floor((C - w) / 2) + 1, py(y) + 5, label, [255, 255, 255, 255]);
    else img.text(px(x) + 2, py(y) + 5, label.slice(0, 2), [255, 255, 255, 255]);
  };
  for (const e of map.entities) marker(e.x, e.y, ENTITY_COLORS[e.kind], e.id);
  map.warps.forEach((w, k) => marker(w.x, w.y, ENTITY_COLORS.warp, `W${k}`));

  // Legend.
  if (opts.legend) {
    let ly = titleH + 4;
    const lx = ox + mapW + 12;
    img.text(lx, ly, "TERRAIN", INK);
    ly += 12;
    for (const t of used) {
      img.fillRect(lx, ly, 10, 10, colors[t]);
      img.strokeRect(lx, ly, 10, 10, INK);
      img.text(lx + 14, ly + 2, TERRAIN_TYPES[t].label, INK);
      ly += 14;
    }
    if (kinds.length || map.warps.length) {
      ly += 6;
      img.text(lx, ly, "THINGS", INK);
      ly += 12;
      for (const k of kinds) {
        img.fillRect(lx, ly, 10, 10, hexToRgba(ENTITY_COLORS[k]));
        img.text(lx + 14, ly + 2, k.replace(/_/g, " "), INK);
        ly += 14;
      }
      if (map.warps.length) {
        img.fillRect(lx, ly, 10, 10, hexToRgba(ENTITY_COLORS.warp));
        img.text(lx + 14, ly + 2, "warp", INK);
      }
    }
  }
  return img;
}

/** Spreadsheet-style label for a 15×10 screen: A1, B1… (column letters, row numbers). */
export function screenName(col: number, row: number): string {
  let letters = "";
  let c = col;
  do {
    letters = String.fromCharCode(65 + (c % 26)) + letters;
    c = Math.floor(c / 26) - 1;
  } while (c >= 0);
  return `${letters}${row + 1}`;
}
