// Building the region: turning the sketch into maps (Milestone 6, part E).
//
// Every town is one map, every route segment one map, and every forest and cave
// one map (a cave's lower floors are made when its first floor is generated).
// Building again updates the maps it made: it keeps everything drawn or
// generated on them, and only resets what comes from the sketch:
//
//   • name, size (the map grows or shrinks on the side the sketch did), region
//     map section, route, progression step, level band and HMs (from the journey);
//   • connections and the edge entrances between neighbouring maps, with the
//     Start and Finish from the journey;
//   • the warps between a route or town and the forests and caves on it;
//   • zones for painted lakes, sea, biomes and rivers (data.fromSketch = true);
//     the user's own zones are kept.
//
// Maps it made whose place has gone from the sketch are not deleted, only
// reported. Connections follow pokeemerald (src/fieldmap.c, FillSouthConnection
// and friends): the neighbour is placed `offset` metatiles along the shared edge,
// so the offset is the neighbour's position minus this map's, and the two
// sides' offsets are opposite (Route 103 → Route 110 "right, -60"; Route 110 →
// Route 103 "left, 60" in data/maps/*/map.json).

import type { Biome, Connection, ConnectionDirection, Edge, MapBlueprint, MapType, Opening, Region, Warp, Zone } from "./model";
import { BIOMES, addNewMap, makeGrid, mapConstantFromName } from "./model";
import type { PlaceJourney } from "./journey";
import { facingSide, planJourney } from "./journey";
import { draftRegionMap } from "./regionMap";
import type { Anchor } from "./resize";
import { resizeMap } from "./resize";
import { deriveSeed } from "./rng";
import type { Sketch, SketchPlace, SketchRect } from "./sketch";
import { SKETCH_CELL, areaAt, inRect, isOutdoor, parentOf, placePieces, sketchIssues } from "./sketch";
import { DEFAULT_FUZZINESS } from "./zones";

export interface BuildReport {
  /** Errors in the sketch that stop the build. */
  blocked: string[];
  created: string[];
  updated: string[];
  /** Maps to generate (new, or their size or entrances changed). */
  needsGenerate: string[];
  /** Maps made from the sketch whose place is no longer in it. */
  orphans: string[];
}

/** One map to make: a town, a route segment, or a forest or cave. */
interface Unit {
  place: SketchPlace;
  /** Which piece of the place (route segments), 0 otherwise. */
  index: number;
  name: string;
  mapType: MapType;
  /** Where it is on the sketch (towns and routes), else null. */
  rect: SketchRect | null;
  w: number;
  h: number;
  map: MapBlueprint | null;
}

const DIRECTION: Record<Edge, ConnectionDirection> = { north: "up", south: "down", west: "left", east: "right" };
/** Entrance width, and how far it keeps from the ends of a shared edge. */
const GAP = 3;
const MARGIN = 3;

function units(sketch: Sketch, target: number): Unit[] {
  const out: Unit[] = [];
  for (const p of sketch.places) {
    if (isOutdoor(p.kind)) {
      const pieces = placePieces(p, target);
      pieces.forEach((piece, k) =>
        out.push({ place: p, index: k, name: pieces.length > 1 ? `${p.name} (${k + 1})` : p.name, mapType: p.kind, rect: { x: piece.x, y: piece.y, w: piece.w, h: piece.h }, w: piece.w, h: piece.h, map: null }),
      );
    } else out.push({ place: p, index: 0, name: p.name, mapType: p.kind, rect: null, w: p.size?.w ?? 40, h: p.size?.h ?? 40, map: null });
  }
  return out;
}

/** The biome painted over most of a rectangle, if any. */
function mainBiome(sketch: Sketch, r: SketchRect): Biome | null {
  const counts = new Map<string, number>();
  for (let y = r.y; y < r.y + r.h; y += SKETCH_CELL)
    for (let x = r.x; x < r.x + r.w; x += SKETCH_CELL) {
      const a = areaAt(sketch, x, y);
      if (a && (BIOMES as readonly string[]).includes(a)) counts.set(a, (counts.get(a) ?? 0) + 1);
    }
  let best: string | null = null;
  for (const [a, n] of counts) if (!best || n > counts.get(best)!) best = a;
  return best as Biome | null;
}

/** Which way to grow or shrink a map so its contents stay where they were on the sketch. */
function anchorFor(oldX: number, newX: number, oldW: number, newW: number): 0 | 1 | 2 {
  const dx = oldX - newX;
  for (const a of [0, 2, 1] as const) if (Math.trunc(((newW - oldW) * a) / 2) === dx) return a;
  return 0;
}

const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);

/** Build (or update) the region's maps from its sketch. */
export function buildRegion(region: Region): BuildReport {
  const report: BuildReport = { blocked: [], created: [], updated: [], needsGenerate: [], orphans: [] };
  const sketch = region.sketch;
  if (!sketch) {
    report.blocked.push("There's no sketch yet.");
    return report;
  }
  const target = region.settings.targetSegmentLength;
  const errors = sketchIssues(sketch, target, region.settings.engineLimits).filter((i) => i.severity === "error");
  if (errors.length) {
    report.blocked.push(...errors.map((e) => e.message));
    return report;
  }
  const plan = planJourney(sketch, region);
  const draft = draftRegionMap(sketch);
  const list = units(sketch, target);
  const byId = new Map(region.maps.map((m) => [m.id, m]));
  const changed = new Set<string>();

  // --- 1. Find or make each map, and set what comes from the sketch -----------------------
  for (const u of list) {
    const existing = byId.get(u.place.mapIds[u.index] ?? "");
    const pj = plan.places.get(u.place.id);
    if (!existing) {
      const biome = (u.rect && mainBiome(sketch, u.rect)) ?? (!isOutdoor(u.place.kind) ? (parentBiome(sketch, u.place) ?? region.settings.defaultBiome) : region.settings.defaultBiome);
      u.map = addNewMap(region, { name: u.name, mapType: u.mapType, width: u.w, height: u.h, seed: deriveSeed(region.seed, `${u.place.id}:${u.index}`), biome });
      byId.set(u.map.id, u.map);
      report.created.push(u.map.id);
      changed.add(u.map.id);
    } else {
      u.map = existing;
      if (existing.width !== u.w || existing.height !== u.h) {
        const ox = num(existing.params.sketchX, u.rect?.x ?? 0);
        const oy = num(existing.params.sketchY, u.rect?.y ?? 0);
        const anchor: Anchor = { x: anchorFor(ox, u.rect?.x ?? ox, existing.width, u.w), y: anchorFor(oy, u.rect?.y ?? oy, existing.height, u.h) };
        resizeMap(existing, u.w, u.h, anchor);
        changed.add(existing.id);
      }
      report.updated.push(existing.id);
    }
    const m = u.map;
    if (m.name !== u.name) {
      m.name = u.name;
      m.header.id = mapConstantFromName(u.name);
      m.header.name = u.name.replace(/[^A-Za-z0-9]+/g, "") || "Unnamed";
    }
    m.params = {
      ...m.params,
      sketchPlace: u.place.id,
      sketchPiece: u.index,
      ...(u.rect ? { sketchX: u.rect.x, sketchY: u.rect.y } : {}),
      ...journeyParams(pj, region),
    };
    if (m.mapType === "cave") m.params.exits = Math.max(1, Math.min(4, u.place.pins.length));
    m.progressionStep = pj?.stepId ?? null;
    // The region map section: its own, or (forests and caves without one) its route's or town's.
    const own = draft.sections.find((s) => s.placeId === u.place.id);
    const parent = isOutdoor(u.place.kind) ? null : parentOf(sketch, u.place);
    const sec = own ?? draft.sections.find((s) => s.placeId === parent?.id);
    if (sec) m.header.region_map_section = sec.id;
  }
  for (const p of sketch.places) p.mapIds = list.filter((u) => u.place === p).map((u) => u.map!.id);

  // --- 2. Routes (one record per route, listing its segments) ------------------------------
  const routeIds = new Set<string>();
  for (const p of sketch.places.filter((x) => x.kind === "route")) {
    const id = `route_${p.id}`;
    routeIds.add(id);
    const maps = p.mapIds.map((mid) => byId.get(mid)!);
    const sec = draft.sections.find((s) => s.placeId === p.id);
    const old = region.routes.find((r) => r.id === id);
    const record = { id, name: p.name, segmentMapIds: [...p.mapIds], primaryTileset: old?.primaryTileset ?? "", secondaryTileset: old?.secondaryTileset ?? "", regionMapSection: sec?.id ?? "", progressionStep: plan.places.get(p.id)?.stepId ?? null, biome: maps[0]?.biome ?? region.settings.defaultBiome };
    if (old) Object.assign(old, record);
    else region.routes.push(record);
    for (const m of maps) m.routeId = id;
  }
  region.routes = region.routes.filter((r) => !r.id.startsWith("route_p") || routeIds.has(r.id));

  // --- 3. Connections and entrances between neighbouring towns and route segments ----------
  const outdoor = list.filter((u) => u.rect);
  const partner = new Map<string, Map<string, string>>(); // map id → opening id → neighbour map id
  for (const a of outdoor) {
    const m = a.map!;
    const before = JSON.stringify([m.openings, m.connections]);
    const connections: Connection[] = [];
    const openings: Opening[] = [];
    const partners = new Map<string, string>();
    for (const b of outdoor) {
      if (a === b) continue;
      const side = facingSide(a.rect!, b.rect!);
      if (!side) continue;
      const alongX = side === "north" || side === "south";
      connections.push({ direction: DIRECTION[side], map: b.map!.id, offset: alongX ? b.rect!.x - a.rect!.x : b.rect!.y - a.rect!.y });
      // The entrance: in the middle of the shared stretch of edge, the same on both maps.
      const lo = alongX ? Math.max(a.rect!.x, b.rect!.x) : Math.max(a.rect!.y, b.rect!.y);
      const hi = alongX ? Math.min(a.rect!.x + a.rect!.w, b.rect!.x + b.rect!.w) : Math.min(a.rect!.y + a.rect!.h, b.rect!.y + b.rect!.h);
      const width = Math.min(GAP, hi - lo);
      const margin = Math.max(0, Math.min(MARGIN, Math.floor((hi - lo - width) / 2)));
      const start = Math.max(lo + margin, Math.min(hi - margin - width, Math.floor((lo + hi) / 2) - Math.floor(width / 2)));
      const id = `o${openings.length + 1}`;
      openings.push({ id, edge: side, start: start - (alongX ? a.rect!.x : a.rect!.y), width, kind: "walk" });
      partners.set(id, b.map!.id);
    }
    m.connections = connections;
    m.openings = openings;
    partner.set(m.id, partners);
    if (JSON.stringify([m.openings, m.connections]) !== before) changed.add(m.id);
  }

  // Start and Finish (routes): the entrance on the side the player comes in by, and goes out by.
  for (const u of outdoor.filter((x) => x.place.kind === "route")) {
    const pj = plan.places.get(u.place.id);
    const piece = pj?.pieces.find((q) => q.x === u.rect!.x && q.y === u.rect!.y && q.w === u.rect!.w && q.h === u.rect!.h);
    const m = u.map!;
    if (!piece) continue;
    const k = pj!.pieces.indexOf(piece);
    const prev = k > 0 ? pj!.pieces[k - 1] : null;
    const next = k + 1 < pj!.pieces.length ? pj!.pieces[k + 1] : null;
    const pick = (edge: Edge | null, toward: SketchRect | null) => {
      if (!edge) return null;
      const on = m.openings.filter((o) => o.edge === edge);
      const neighbour = toward ? outdoor.find((x) => x.rect!.x === toward.x && x.rect!.y === toward.y && x.rect!.w === toward.w && x.rect!.h === toward.h)?.map?.id : null;
      return on.find((o) => partner.get(m.id)?.get(o.id) === neighbour) ?? on[0] ?? null;
    };
    const start = pick(piece.from, prev);
    const finish = pick(piece.to, next);
    if (start && finish && start !== finish) {
      start.role = "start";
      finish.role = "finish";
    }
  }

  // --- 4. Forests and caves: warps from the routes and towns they're on ---------------------
  const insideMaps = new Set<string>();
  for (const u of list.filter((x) => !x.rect)) {
    const inner = u.map!;
    insideMaps.add(inner.header.id);
    // On the outdoor maps: a warp (locked, kept by Generate) where each entrance pin is.
    const want = new Map<string, Array<{ x: number; y: number }>>();
    for (const pin of u.place.pins) {
      const host = outdoor.find((o) => inRect(o.rect!, pin.x, pin.y));
      if (!host) continue;
      const at = { x: pin.x - host.rect!.x, y: pin.y - host.rect!.y };
      (want.get(host.map!.id) ?? want.set(host.map!.id, []).get(host.map!.id)!).push(at);
    }
    for (const o of outdoor) {
      const m = o.map!;
      const wanted = want.get(m.id) ?? [];
      // Drop warps to this place that are no longer where a pin is.
      const keep = m.warps.filter((w) => !(w.locked && w.destMap === inner.header.id && !wanted.some((p) => p.x === w.x && p.y === w.y)));
      if (keep.length !== m.warps.length) {
        m.warps = keep;
        changed.add(m.id);
      }
      for (const p of wanted)
        if (!m.warps.some((w) => w.x === p.x && w.y === p.y)) {
          m.warps.push(sketchWarp(m, p.x, p.y, inner.mapType === "cave" ? "cave_mouth" : "other", inner.header.id));
          changed.add(m.id);
        }
    }
    // A forest: an entrance on its edge for each pin, with a warp on it (in pin order).
    if (inner.mapType === "forest") {
      const pj = plan.places.get(u.place.id);
      const before = JSON.stringify([inner.openings, inner.warps]);
      const order = forestEdges(u.place.pins.length, pj ?? null);
      inner.openings = order.map((edge, k) => {
        const along = edge === "north" || edge === "south" ? inner.width : inner.height;
        const role = pj && pj.entryPin !== pj.exitPin ? (k === pj.entryPin ? "start" : k === pj.exitPin ? "finish" : undefined) : undefined;
        return { id: `o${k + 1}`, edge, start: Math.floor(along / 2) - 1, width: GAP, kind: "walk", ...(role ? { role } : {}) } as Opening;
      });
      const others = inner.warps.filter((w) => !(w.locked && w.kind === "other"));
      const gates = inner.openings.map((o) => {
        const mid = o.start + 1;
        const [x, y] = o.edge === "north" ? [mid, 0] : o.edge === "south" ? [mid, inner.height - 1] : o.edge === "west" ? [0, mid] : [inner.width - 1, mid];
        return sketchWarp(inner, x, y, "other", "");
      });
      inner.warps = [...gates, ...others];
      if (JSON.stringify([inner.openings, inner.warps]) !== before) changed.add(inner.id);
    }
  }

  // --- 5. Painted areas and rivers become zones ----------------------------------------------
  for (const u of outdoor) {
    const m = u.map!;
    const before = JSON.stringify(m.layers.zones.filter((z) => z.data.fromSketch === true).map((z) => [z.kind, z.data, Array.from(z.mask.data)]));
    m.layers.zones = [...m.layers.zones.filter((z) => z.data.fromSketch !== true), ...sketchZones(sketch, m, u.rect!)];
    const after = JSON.stringify(m.layers.zones.filter((z) => z.data.fromSketch === true).map((z) => [z.kind, z.data, Array.from(z.mask.data)]));
    if (after !== before) changed.add(m.id);
  }

  pairRegionWarps(region);

  // --- 6. Report ------------------------------------------------------------------------------
  const made = new Set(sketch.places.flatMap((p) => p.mapIds));
  report.orphans = region.maps.filter((m) => typeof m.params.sketchPlace === "string" && !made.has(m.id)).map((m) => m.id);
  report.needsGenerate = [...changed].filter((id) => made.has(id));
  return report;
}

/** The journey's level band, step HMs (for the checks) as map settings. */
function journeyParams(pj: PlaceJourney | undefined, region: Region): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  if (pj?.levels) {
    out.levelMin = pj.levels.min;
    out.levelMax = pj.levels.max;
  }
  const step = region.progression.find((s) => s.id === pj?.stepId);
  if (step) out.availableHms = step.hms.join(",");
  return out;
}

function parentBiome(sketch: Sketch, place: SketchPlace): Biome | null {
  const parent = parentOf(sketch, place);
  return parent?.rects[0] ? mainBiome(sketch, parent.rects[0]) : null;
}

/** A forest's entrances: the way in at the south, the way out at the north, any others east and west. */
function forestEdges(pins: number, pj: PlaceJourney | null): Edge[] {
  const out: Edge[] = [];
  const spare: Edge[] = ["east", "west"];
  for (let k = 0; k < Math.min(pins, 4); k++) {
    if (pj && k === pj.entryPin) out.push("south");
    else if (pj && k === pj.exitPin && pj.exitPin !== pj.entryPin) out.push("north");
    else out.push(spare.shift() ?? (out.includes("south") ? "north" : "south"));
  }
  // With no journey: the first pin at the south, the second at the north.
  if (!pj && pins >= 2) {
    out[0] = "south";
    out[1] = "north";
  }
  return out;
}

function sketchWarp(map: MapBlueprint, x: number, y: number, kind: Warp["kind"], destMap: string): Warp {
  let n = map.warps.length + 1;
  while (map.warps.some((w) => w.id === `w${n}`)) n++;
  return { id: `w${n}`, kind, x, y, elevation: "ground", destMap, destWarpId: null, locked: true };
}

/**
 * Point each forest and cave entrance at the warp on the route or town where its pin
 * is, and back. Run after building, and after generating any of these maps (Generate
 * renumbers warps). A cave's entrances are the cave mouths its first floor generates.
 */
export function pairRegionWarps(region: Region): void {
  const sketch = region.sketch;
  if (!sketch) return;
  const byId = new Map(region.maps.map((m) => [m.id, m]));
  for (const place of sketch.places) {
    if (isOutdoor(place.kind)) continue;
    const inner = byId.get(place.mapIds[0] ?? "");
    if (!inner) continue;
    const entrances = inner.warps.map((w, i) => ({ w, i })).filter(({ w }) => (inner.mapType === "cave" ? w.kind === "cave_mouth" : w.locked && w.kind === "other"));
    place.pins.forEach((pin, k) => {
      const hostPlace = sketch.places.find((p) => isOutdoor(p.kind) && p.rects.some((r) => inRect(r, pin.x, pin.y)));
      const host = hostPlace?.mapIds.map((id) => byId.get(id)).find((m) => m && inRect({ x: num(m.params.sketchX, 0), y: num(m.params.sketchY, 0), w: m.width, h: m.height }, pin.x, pin.y));
      if (!host) return;
      const x = pin.x - num(host.params.sketchX, 0);
      const y = pin.y - num(host.params.sketchY, 0);
      const i = host.warps.findIndex((w) => w.x === x && w.y === y);
      if (i < 0) return;
      const e = entrances[k];
      host.warps[i].destMap = inner.header.id;
      host.warps[i].destWarpId = e ? e.i : null;
      if (e) {
        e.w.destMap = host.header.id;
        e.w.destWarpId = i;
      }
    });
  }
}

/** Zones for the painted lakes, sea, biomes and rivers over one map. */
function sketchZones(sketch: Sketch, m: MapBlueprint, r: SketchRect): Zone[] {
  const zones: Zone[] = [];
  const at = (x: number, y: number) => areaAt(sketch, r.x + x, r.y + y);
  const make = (kind: "water" | "biome", data: Record<string, string>, test: (x: number, y: number) => boolean, hard: boolean) => {
    const mask = makeGrid(m.width, m.height);
    let any = false;
    for (let y = 0; y < m.height; y++)
      for (let x = 0; x < m.width; x++)
        if (test(x, y)) {
          mask.data[y * m.width + x] = 1;
          any = true;
        }
    if (!any) return;
    const label = kind === "water" ? `${data.water === "ocean" ? "Sea" : data.water === "river" ? "River" : "Lake"} (sketch)` : `${data.biome} (sketch)`;
    zones.push({ id: `sketch_${kind}_${zones.length + 1}`, name: label, kind, hard, fuzziness: hard ? 0 : DEFAULT_FUZZINESS, mask, data: { ...data, fromSketch: true } });
  };
  // Lakes and sea follow the painted squares loosely; rivers exactly, so they meet at map edges.
  make("water", { water: "lake", depth: "deep" }, (x, y) => at(x, y) === "lake", false);
  make("water", { water: "ocean", depth: "deep" }, (x, y) => at(x, y) === "sea", false);
  for (const b of BIOMES) if (b !== m.biome) make("biome", { biome: b }, (x, y) => at(x, y) === b, false);
  for (const river of sketch.rivers) {
    const half = river.width / 2;
    make("water", { water: "river", depth: "deep" }, (x, y) => distanceToLine(river.points, r.x + x + 0.5, r.y + y + 0.5) <= half, true);
  }
  return zones;
}

function distanceToLine(pts: number[], px: number, py: number): number {
  let best = Infinity;
  for (let k = 0; k + 3 < pts.length; k += 2) {
    const [ax, ay, bx, by] = [pts[k], pts[k + 1], pts[k + 2], pts[k + 3]];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
    best = Math.min(best, Math.hypot(px - (ax + t * dx), py - (ay + t * dy)));
  }
  return best;
}
