// The draft in-game region map (the Town Map / Fly map), worked out from the
// region sketch. Checked against pret/pokeemerald:
//
//   • The map is a grid of MAP_WIDTH × MAP_HEIGHT = 28 × 15 squares
//     (src/region_map.c).
//   • Each square names one map section (MAPSEC), or MAPSEC_NONE:
//     sRegionMap_MapSectionLayout[MAP_HEIGHT][MAP_WIDTH] in
//     src/data/region_map/region_map_layout.h. The name shown under the cursor
//     comes from this grid (GetMapSecIdAt in src/region_map.c).
//   • Each section also has an entry with x, y, width, height and a name
//     (src/data/region_map/region_map_sections.json), used to place the player's
//     marker (gRegionMapEntries[mapSecId].x + … in src/region_map.c). A route's
//     entry covers its squares (MAPSEC_ROUTE_104 is x 0, y 7, 1×3).
//   • A place reached by warp may have its own section whose entry sits on one of
//     its route's squares, while the grid square still names the route:
//     MAPSEC_PETALBURG_WOODS is x 0, y 8, inside Route 104's squares, and
//     MAPSEC_GRANITE_CAVE is x 1, y 13 on a Route 106 square.
//   • Names are at most 16 characters (MAP_NAME_LENGTH in include/region_map.h).
//
// Every route segment shares its route's one section. Sections follow the
// sketch: the outdoor places are scaled, all together, to fit the grid. A section
// moved or resized by hand keeps that rectangle (sketch.regionMap.overrides).

import type { Sketch, SketchPlace } from "./sketch";
import { isOutdoor, outdoorPlaceAt, parentOf } from "./sketch";

export const REGION_MAP_WIDTH = 28;
export const REGION_MAP_HEIGHT = 15;
export const MAPSEC_NAME_MAX = 16;

export interface GridRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * A section placed by hand: its entry rectangle, and which squares in it are the
 * section's (row by row, 1 = yes), so a moved L-shaped route keeps its shape.
 * No `cells`: every square in the rectangle.
 */
export interface SectionOverride extends GridRect {
  cells?: number[];
}

/** What's saved: the grid size, and sections placed by hand. */
export interface RegionMapPlan {
  width: number;
  height: number;
  /** Place id → its section's rectangle (and squares) on the grid, set by hand. */
  overrides: Record<string, SectionOverride>;
}

export function newRegionMapPlan(): RegionMapPlan {
  return { width: REGION_MAP_WIDTH, height: REGION_MAP_HEIGHT, overrides: {} };
}

export interface RegionMapSection {
  placeId: string;
  /** e.g. MAPSEC_ROUTE_1. */
  id: string;
  /** The name shown in game (capitals). */
  name: string;
  /** The entry rectangle (region_map_sections.json x, y, width, height). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Set by hand (an override) rather than worked out from the sketch. */
  manual: boolean;
  /** Forests and caves with their own section: their entry sits on a square of their route or town. */
  inside: boolean;
}

export interface RegionMapDraft {
  width: number;
  height: number;
  /** One per square: the index into `sections` of the section it names, or -1 for MAPSEC_NONE. */
  layout: Int16Array;
  sections: RegionMapSection[];
  /** How the sketch maps onto the grid: square (gx, gy) covers sketch metatiles from (ox + gx·size, oy + gy·size). */
  ox: number;
  oy: number;
  size: number;
  problems: string[];
}

/** "Route 1" → "MAPSEC_ROUTE_1"; "Mt. Moss" → "MAPSEC_MT_MOSS". */
export function sectionId(name: string): string {
  const core = name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return "MAPSEC_" + (core || "UNNAMED");
}

/** The in-game name: capitals, as vanilla's entries are ("ROUTE 104"). */
export function sectionName(name: string): string {
  return name.trim().toUpperCase();
}

function boundsOf(places: SketchPlace[], sketch: Sketch) {
  const rects = places.flatMap((p) => p.rects);
  if (!rects.length) return { x: 0, y: 0, w: sketch.width, h: sketch.height };
  const x0 = Math.min(...rects.map((r) => r.x));
  const y0 = Math.min(...rects.map((r) => r.y));
  const x1 = Math.max(...rects.map((r) => r.x + r.w));
  const y1 = Math.max(...rects.map((r) => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Work out the draft region map from the sketch. */
export function draftRegionMap(sketch: Sketch): RegionMapDraft {
  const plan = sketch.regionMap ?? newRegionMapPlan();
  const W = plan.width;
  const H = plan.height;
  const outdoor = sketch.places.filter((p) => isOutdoor(p.kind) && p.rects.length);
  const problems: string[] = [];

  // Scale the outdoor places, all together, to fit the grid with a square's margin, centred.
  const b = boundsOf(outdoor, sketch);
  const size = Math.max(b.w / Math.max(1, W - 2), b.h / Math.max(1, H - 2), 1e-6);
  const ox = b.x + b.w / 2 - (W * size) / 2;
  const oy = b.y + b.h / 2 - (H * size) / 2;

  const sections: RegionMapSection[] = [];
  const layout = new Int16Array(W * H).fill(-1);
  /** How much of each square each section covers (to settle squares two places share). */
  const cover = new Map<number, Float64Array>();

  const coverage = (p: SketchPlace) => {
    const c = new Float64Array(W * H);
    for (const r of p.rects) {
      const gx0 = Math.max(0, Math.floor((r.x - ox) / size));
      const gy0 = Math.max(0, Math.floor((r.y - oy) / size));
      const gx1 = Math.min(W - 1, Math.floor((r.x + r.w - ox - 1e-9) / size));
      const gy1 = Math.min(H - 1, Math.floor((r.y + r.h - oy - 1e-9) / size));
      for (let gy = gy0; gy <= gy1; gy++)
        for (let gx = gx0; gx <= gx1; gx++) {
          const sx = ox + gx * size;
          const sy = oy + gy * size;
          const w = Math.min(sx + size, r.x + r.w) - Math.max(sx, r.x);
          const h = Math.min(sy + size, r.y + r.h) - Math.max(sy, r.y);
          if (w > 0 && h > 0) c[gy * W + gx] += (w * h) / (size * size);
        }
    }
    return c;
  };

  // Outdoor places: a square goes to whichever place covers most of it (towns win ties: they're
  // the small, important squares), as long as that's at least a third of the square.
  const owner = new Int16Array(W * H).fill(-1);
  const best = new Float64Array(W * H);
  outdoor.forEach((p) => {
    const k = sections.length;
    sections.push({ placeId: p.id, id: sectionId(p.name), name: sectionName(p.name), x: 0, y: 0, w: 0, h: 0, manual: false, inside: false });
    const c = coverage(p);
    cover.set(k, c);
    for (let i = 0; i < W * H; i++) {
      const v = c[i] + (p.kind === "town" ? 0.01 : 0);
      if (c[i] >= 1 / 3 && v > best[i]) {
        best[i] = v;
        owner[i] = k;
      }
    }
  });
  // Every place gets at least one square: the one it covers most.
  sections.forEach((_, k) => {
    if (owner.includes(k)) return;
    const c = cover.get(k)!;
    let top = 0;
    for (let i = 1; i < W * H; i++) if (c[i] > c[top]) top = i;
    owner[top] = k;
  });
  // Sections placed by hand take their rectangle, over anything worked out.
  sections.forEach((sec, k) => {
    const o = plan.overrides[sec.placeId];
    if (!o) return;
    sec.manual = true;
    for (let i = 0; i < W * H; i++) if (owner[i] === k) owner[i] = -1;
    for (let gy = o.y; gy < o.y + o.h; gy++)
      for (let gx = o.x; gx < o.x + o.w; gx++) {
        const on = !o.cells || o.cells[(gy - o.y) * o.w + (gx - o.x)] === 1;
        if (on && gx >= 0 && gy >= 0 && gx < W && gy < H) owner[gy * W + gx] = k;
      }
  });
  layout.set(owner);
  // Entries: the rectangle around each section's squares.
  sections.forEach((sec, k) => {
    let x0 = W;
    let y0 = H;
    let x1 = -1;
    let y1 = -1;
    for (let i = 0; i < W * H; i++)
      if (layout[i] === k) {
        const gx = i % W;
        const gy = (i - gx) / W;
        x0 = Math.min(x0, gx);
        y0 = Math.min(y0, gy);
        x1 = Math.max(x1, gx);
        y1 = Math.max(y1, gy);
      }
    if (x1 < 0) {
      // Every square it had was taken by sections placed by hand.
      problems.push(`${sec.name} has no square left on the region map: move or resize the sections over it.`);
      Object.assign(sec, { x: 0, y: 0, w: 0, h: 0 });
    } else Object.assign(sec, { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 });
  });

  // Forests and caves with their own section: an entry on the square under their first entrance.
  for (const p of sketch.places) {
    if (isOutdoor(p.kind) || !p.ownSection) continue;
    const pin = p.pins[0];
    const sec: RegionMapSection = { placeId: p.id, id: sectionId(p.name), name: sectionName(p.name), x: 0, y: 0, w: 1, h: 1, manual: false, inside: true };
    const o = plan.overrides[p.id];
    if (o) Object.assign(sec, { x: o.x, y: o.y, w: o.w, h: o.h, manual: true });
    else if (pin) {
      sec.x = Math.max(0, Math.min(W - 1, Math.floor((pin.x - ox) / size)));
      sec.y = Math.max(0, Math.min(H - 1, Math.floor((pin.y - oy) / size)));
      // Keep it on its own route's or town's squares, if the pin's square went to a neighbour.
      const parent = parentOf(sketch, p);
      const pk = sections.findIndex((s) => s.placeId === parent?.id);
      if (pk >= 0 && layout[sec.y * W + sec.x] !== pk) {
        let bestD = Infinity;
        for (let i = 0; i < W * H; i++)
          if (layout[i] === pk) {
            const d = Math.abs((i % W) - sec.x) + Math.abs(Math.floor(i / W) - sec.y);
            if (d < bestD) {
              bestD = d;
              sec.x = i % W;
              sec.y = Math.floor(i / W);
            }
          }
      }
    }
    sections.push(sec);
  }

  // Names: one section per name, and short enough for the game.
  const ids = new Map<string, string>();
  for (const sec of sections) {
    if (ids.has(sec.id)) problems.push(`${ids.get(sec.id)} and ${sec.name} would both be ${sec.id}. Rename one.`);
    else ids.set(sec.id, sec.name);
    if (sec.name.length > MAPSEC_NAME_MAX) problems.push(`"${sec.name}" is ${sec.name.length} letters; region map names fit ${MAPSEC_NAME_MAX}.`);
  }
  return { width: W, height: H, layout, sections, ox, oy, size, problems };
}

/** A section's squares within its entry rectangle, row by row (1 = the section's). */
export function sectionCells(draft: RegionMapDraft, sec: RegionMapSection): number[] {
  const out: number[] = [];
  for (let gy = sec.y; gy < sec.y + sec.h; gy++) for (let gx = sec.x; gx < sec.x + sec.w; gx++) out.push(sectionAt(draft, gx, gy) === sec ? 1 : 0);
  return out;
}

/** The section a grid square shows, or null for MAPSEC_NONE. */
export function sectionAt(draft: RegionMapDraft, gx: number, gy: number): RegionMapSection | null {
  if (gx < 0 || gy < 0 || gx >= draft.width || gy >= draft.height) return null;
  const k = draft.layout[gy * draft.width + gx];
  return k >= 0 ? draft.sections[k] : null;
}

/** The outdoor place a grid square came from, for picking a place by tapping the map. */
export function placeAtSquare(sketch: Sketch, draft: RegionMapDraft, gx: number, gy: number): SketchPlace | null {
  const sec = sectionAt(draft, gx, gy);
  if (sec) return sketch.places.find((p) => p.id === sec.placeId) ?? null;
  return outdoorPlaceAt(sketch, draft.ox + (gx + 0.5) * draft.size, draft.oy + (gy + 0.5) * draft.size);
}

/** region_map_sections.json, as pokeemerald writes it, for the sections in the draft. */
export function sectionsJson(draft: RegionMapDraft): string {
  const map_sections = draft.sections.map((s) => ({ id: s.id, name: s.name, x: s.x, y: s.y, width: s.w, height: s.h }));
  return JSON.stringify({ map_sections }, null, 2) + "\n";
}

/** sRegionMap_MapSectionLayout, as in pokeemerald's src/data/region_map/region_map_layout.h. */
export function layoutHeader(draft: RegionMapDraft): string {
  const rows: string[] = [];
  for (let gy = 0; gy < draft.height; gy++) {
    const row: string[] = [];
    for (let gx = 0; gx < draft.width; gx++) row.push(sectionAt(draft, gx, gy)?.id ?? "MAPSEC_NONE");
    rows.push(`    {${row.join(", ")}},`);
  }
  return `static const mapsec_u8_t sRegionMap_MapSectionLayout[MAP_HEIGHT][MAP_WIDTH] = {\n${rows.join("\n")}\n};\n`;
}
