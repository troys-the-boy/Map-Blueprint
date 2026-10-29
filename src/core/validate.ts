// Validation: checks a map against Gen 3 rules and good design.
//
// Errors block export (and make the generator retry); warnings don't.
// Every message is written for the person building the map, and lists the
// cells involved so the editor can highlight them.

import { OBJECT_EVENTS_COUNT, SCREEN_HEIGHT_METATILES, SCREEN_WIDTH_METATILES } from "./constants";
import type { Hm } from "./constants";
import { PORYMAP_GROUP, trainerSight } from "./entities";
import { DIRS, IS_GRASS, IS_WALKABLE, IS_WALL, IS_WATER, T, components, distanceField, ledgeWater } from "./grid";
import type { EngineLimits, MapBlueprint, Opening } from "./model";
import { DEFAULT_ENGINE_LIMITS } from "./model";
import { MOVEMENT_HMS, MoveGraph, openingCells, openingNeeds } from "./reach";
import type { MapView } from "./reach";
import { checkMapSize, describeSizeCheck } from "./sizeRule";
import { TERRAIN_TYPES } from "./terrain";
import { TABLE_LABELS, neededTables } from "./encounters";

export type Severity = "error" | "warning";

export interface Issue {
  severity: Severity;
  /** Stable short code, e.g. "unreachable-exit". */
  code: string;
  message: string;
  /** Cells involved (index y * width + x). The first one is where to jump to. */
  cells: number[];
  /** The thing the issue is about, if any (so it can be marked OK). */
  entityId?: string;
}

export interface ValidateOptions {
  limits?: EngineLimits;
  /** HMs the player has at this point of the game. */
  availableHms?: readonly Hm[];
  /** Dead-end side areas deeper than this many steps should hold a reward. */
  deadEndDepth?: number;
  /** The project's other maps, to check that warps between maps point at each other. */
  otherMaps?: readonly MapBlueprint[];
}

const HM_NAMES: Record<string, string> = { cut: "Cut", rock_smash: "Rock Smash", strength: "Strength", surf: "Surf", waterfall: "Waterfall", dive: "Dive", flash: "Flash" };

export function describeOpening(o: Opening): string {
  const axis = o.edge === "north" || o.edge === "south" ? "x" : "y";
  const range = o.width > 1 ? `${o.start}–${o.start + o.width - 1}` : `${o.start}`;
  return `${o.edge} entrance (${axis} ${range})`;
}

function hmList(hms: readonly Hm[]): string {
  const moving = hms.filter((h) => MOVEMENT_HMS.includes(h));
  return moving.length ? `with ${moving.map((h) => HM_NAMES[h]).join(", ")}` : "without any HMs";
}

/** Split a list of cells into groups of touching cells. */
function groups(cells: number[], width: number, height: number): number[][] {
  const set = new Set(cells);
  const comp = components(width, height, (i) => set.has(i));
  const out: number[][] = comp.sizes.map(() => []);
  for (const c of cells) out[comp.ids[c]].push(c);
  return out.filter((g) => g.length);
}

export function validateMap(map: MapBlueprint, opts: ValidateOptions = {}): Issue[] {
  const limits = opts.limits ?? DEFAULT_ENGINE_LIMITS;
  const hms = opts.availableHms ?? [];
  const { width, height } = map;
  const terrain = map.layers.terrain.data;
  const issues: Issue[] = [];
  const err = (code: string, message: string, cells: number[] = []) => issues.push({ severity: "error", code, message, cells });
  const warn = (code: string, message: string, cells: number[] = []) => issues.push({ severity: "warning", code, message, cells });
  const xy = (i: number) => `(${i % width}, ${Math.floor(i / width)})`;

  // --- Size and object limits --------------------------------------------------
  const size = checkMapSize(width, height, limits);
  if (!size.ok) err("map-too-big", `The map is too big for the game. ${describeSizeCheck(size)}`);

  const objects = map.entities.filter((e) => PORYMAP_GROUP[e.kind] === "object");
  if (objects.length > limits.objectEventTemplates)
    err("too-many-objects", `This map has ${objects.length} objects (trainers, items, NPCs…); the game allows at most ${limits.objectEventTemplates}.`);
  // Roughly OBJECT_EVENTS_COUNT objects can be active at once, so warn about crowded screens.
  for (let y = 0; y < height; y += 5)
    for (let x = 0; x < width; x += 5) {
      const inView = objects.filter((e) => e.x >= x && e.x < x + SCREEN_WIDTH_METATILES && e.y >= y && e.y < y + SCREEN_HEIGHT_METATILES);
      if (inView.length > OBJECT_EVENTS_COUNT) {
        warn("crowded-screen", `${inView.length} objects fit on one screen near (${x}, ${y}); the game shows about ${OBJECT_EVENTS_COUNT} at once.`, inView.map((e) => e.y * width + e.x));
        y = height; // one warning is enough
        break;
      }
    }

  // --- Entrances and reachability ----------------------------------------------
  const view: MapView = { width, height, terrain, entities: map.entities, elevation: map.layers.elevation.data };
  const graph = new MoveGraph(view, new Set(hms));
  const everyHm = new MoveGraph(view, new Set(MOVEMENT_HMS));
  // A cave's ways in and out are its warps (cave mouths, ladders), not openings in the edge.
  const caveExits = map.mapType === "cave" ? map.warps : [];
  if (map.openings.length === 0 && !caveExits.length) warn("no-entrances", "This map has no entrances yet. Generate it, or add entrances in the Generate panel.");
  // Surf entrances only count once the player has Surf.
  const canUse = (o: Opening) => openingNeeds(o).every((h) => hms.includes(h));
  const openings = map.openings.filter(canUse).map((o) => ({ o, cells: openingCells(o, width, height).filter((c) => graph.canStand[c]) }));
  for (const o of map.openings) {
    const cells = openingCells(o, width, height);
    const ok = o.kind === "surf" ? cells.some((c) => IS_WATER[terrain[c]] && everyHm.canStand[c]) : cells.some((c) => everyHm.canStand[c] && !IS_WATER[terrain[c]]);
    if (!ok)
      err(
        "blocked-entrance",
        o.kind === "surf"
          ? `The ${describeOpening(o)} is a surf entrance, but there's no water on the map edge there.`
          : `The ${describeOpening(o)} is blocked: no walkable cell on the map edge there.`,
        cells,
      );
  }
  if (map.openings.length && !openings.length)
    err("no-usable-entrance", `This map can only be entered by surfing, but the player doesn't have Surf here. Tick Surf under "Player has" if they do.`);
  const usable: Array<{ label: string; cells: number[] }> = openings.filter((x) => x.cells.length).map((x) => ({ label: describeOpening(x.o), cells: x.cells }));
  // A cave exit counts as a way in from the cells around it (the player steps out of it onto the floor).
  caveExits.forEach((w, k) => {
    const cells = [[0, 0], ...DIRS.map((d) => [d.dx, d.dy])]
      .map(([dx, dy]) => [w.x + dx, w.y + dy])
      .filter(([x, y]) => x >= 0 && y >= 0 && x < width && y < height)
      .map(([x, y]) => y * width + x)
      .filter((c) => graph.canStand[c]);
    if (cells.length) usable.push({ label: `exit W${k}`, cells });
  });
  for (const a of usable) {
    const reach = graph.forward(a.cells);
    for (const b of usable) {
      if (a === b) continue;
      if (!b.cells.some((c) => reach[c])) err("unreachable-exit", `You can't get from the ${a.label} to the ${b.label} ${hmList(hms)}.`, b.cells);
    }
  }

  // --- Soft-locks: places you can get into but not out of ----------------------
  const allStarts = usable.flatMap((x) => x.cells);
  if (allStarts.length) {
    const forward = graph.forward(allStarts);
    const back = graph.backward(allStarts);
    const trapped: number[] = [];
    for (let i = 0; i < width * height; i++) if (forward[i] && !back[i]) trapped.push(i);
    for (const g of groups(trapped, width, height))
      err("soft-lock", `Trap near ${xy(g[0])}: once the player gets here (e.g. by jumping a ledge) they can't get back to any entrance.`, g);
  }

  // --- Items that can't be reached at all --------------------------------------
  if (allStarts.length) {
    const allHms = new MoveGraph(view, new Set(MOVEMENT_HMS)).forward(allStarts);
    const canTouch = (x: number, y: number) =>
      [[0, 0], ...DIRS.map((d) => [d.dx, d.dy])].some(([dx, dy]) => {
        const xx = x + dx;
        const yy = y + dy;
        return xx >= 0 && yy >= 0 && xx < width && yy < height && allHms[yy * width + xx] === 1;
      });
    for (const e of map.entities) {
      if ((e.kind === "item_ball" || e.kind === "hidden_item") && !canTouch(e.x, e.y))
        warn("unreachable-item", `Item ${e.id} at (${e.x}, ${e.y}) can't be reached, even with every HM.`, [e.y * width + e.x]);
    }
  }

  // --- Warps ---------------------------------------------------------------------
  // The player must be able to walk onto each warp, or up to it (a door is stepped
  // into from the cell in front), with the HMs they have here.
  if (allStarts.length && map.warps.length) {
    const reach = graph.forward(allStarts);
    const near = (x: number, y: number) =>
      [[0, 0], ...DIRS.map((d) => [d.dx, d.dy])].some(([dx, dy]) => {
        const xx = x + dx;
        const yy = y + dy;
        return xx >= 0 && yy >= 0 && xx < width && yy < height && reach[yy * width + xx] === 1;
      });
    map.warps.forEach((w, k) => {
      if (!near(w.x, w.y)) err("unreachable-warp", `Warp W${k} at (${w.x}, ${w.y}) can't be reached ${hmList(hms)}.`, [w.y * width + w.x]);
    });
  }
  // Doors: on a building's bottom edge with walkable ground in front. Gen 3 tilesets draw
  // buildings from the front, so every door faces south.
  map.warps.forEach((w, k) => {
    if (w.kind !== "door") return;
    const i = w.y * width + w.x;
    const below = w.y + 1 < height ? terrain[i + width] : -1;
    if (terrain[i] !== T.building) err("door-placement", `Door W${k} at (${w.x}, ${w.y}) isn't on a building. Paint the building (or a Building lot stroke), or make the warp another kind.`, [i]);
    else if (below < 0 || !IS_WALKABLE[below] || below === T.building)
      err("door-placement", `Door W${k} at (${w.x}, ${w.y}) has no walkable ground in front of it (south): doors are on a building's bottom edge.`, [i]);
  });
  // --- Strength boulders ----------------------------------------------------------
  // No push may leave a boulder stuck where it blocks the way between the entrances.
  // A boulder moves one cell per push, away from the player, into a cell with no
  // collision (TryPushBoulder in pokeemerald's src/field_player_avatar.c); the
  // others stay put. Blocking for a while is fine if a further push clears it; a
  // position is a problem when it blocks and no push from there ever clears it.
  const boulders = map.entities.filter((e) => e.kind === "strength_boulder");
  if (boulders.length && usable.length >= 2) {
    const withoutStrength = new Set(hms.filter((h) => h !== "strength"));
    for (const b of boulders) {
      const startPos = b.y * width + b.x;
      const next = new Map<number, number[]>();
      const blocks = new Map<number, boolean>();
      const queue = [startPos];
      next.set(startPos, []);
      while (queue.length && next.size < 300) {
        const pos = queue.shift()!;
        const x = pos % width;
        const y = (pos - x) / width;
        const entities = map.entities.map((e) => (e === b ? { ...e, x, y } : e));
        const g = new MoveGraph({ ...view, entities }, withoutStrength);
        const from0 = g.forward(usable[0].cells);
        blocks.set(pos, !usable.slice(1).every((u) => u.cells.some((c) => from0[c])));
        const reach = g.forward(usable.flatMap((u) => u.cells));
        for (const d of DIRS) {
          const fx = x - d.dx;
          const fy = y - d.dy;
          const tx = x + d.dx;
          const ty = y + d.dy;
          if (fx < 0 || fy < 0 || fx >= width || fy >= height || tx < 0 || ty < 0 || tx >= width || ty >= height) continue;
          const to = ty * width + tx;
          if (!reach[fy * width + fx] || !IS_WALKABLE[terrain[to]] || entities.some((e) => e.x === tx && e.y === ty)) continue;
          next.get(pos)!.push(to);
          if (!next.has(to)) {
            next.set(to, []);
            queue.push(to);
          }
        }
      }
      // Positions from which some push sequence reaches a position that doesn't block.
      const clears = new Set([...blocks].filter(([, bl]) => !bl).map(([p]) => p));
      for (let changed = true; changed; ) {
        changed = false;
        for (const [p, list] of next) if (!clears.has(p) && list.some((q) => clears.has(q))) (clears.add(p), (changed = true));
      }
      const stuck = [...blocks].find(([p, bl]) => bl && !clears.has(p) && p !== startPos);
      if (stuck)
        err(
          "boulder-can-block",
          `Strength boulder ${b.id} at (${b.x}, ${b.y}) can be pushed to (${stuck[0] % width}, ${Math.floor(stuck[0] / width)}), where it blocks the way through for good.`,
          [startPos, stuck[0]],
        );
    }
  }

  const others = opts.otherMaps ?? [];
  const isThis = (dest: string) => dest === map.id || dest === map.header.id;
  map.warps.forEach((w, k) => {
    const cell = [w.y * width + w.x];
    if (!w.destMap) {
      warn("warp-no-destination", `Warp W${k} at (${w.x}, ${w.y}) doesn't lead anywhere yet: set where it goes in the Details tab.`, cell);
      return;
    }
    // Only warps to another map in this project can be checked both ways.
    const dest = others.find((m) => m.id !== map.id && (m.id === w.destMap || m.header.id === w.destMap));
    if (!dest) return;
    const back = w.destWarpId === null ? undefined : dest.warps[w.destWarpId];
    if (!back) err("warp-pair", `Warp W${k} leads to warp ${w.destWarpId ?? "?"} on ${dest.name}, which has no such warp.`, cell);
    else if (!isThis(back.destMap) || back.destWarpId !== k)
      err("warp-pair", `Warp W${k} leads to W${w.destWarpId} on ${dest.name}, but that warp doesn't lead back here to W${k}.`, cell);
  });

  // --- Trainers the player can't avoid --------------------------------------------
  // (Only meaningful when the entrances connect at all.)
  const connected = !issues.some((i) => i.code === "unreachable-exit");
  if (usable.length >= 2 && connected) {
    for (const e of map.entities) {
      if (e.kind !== "trainer") continue;
      const sight = trainerSight(e, width, height, terrain);
      if (!sight.length) continue;
      const blocked = terrain.slice();
      for (const c of sight) blocked[c] = T.tree;
      const g = new MoveGraph({ ...view, terrain: blocked }, new Set(hms));
      const reach = g.forward(usable[0].cells);
      // Marked OK in the Details tab: the battle is meant to be unavoidable.
      if ((e.accepted ?? []).includes("unavoidable-trainer")) continue;
      if (!usable.slice(1).every((b) => b.cells.some((c) => reach[c])))
        issues.push({
          severity: "warning",
          code: "unavoidable-trainer",
          message: `Trainer ${e.id} watches the only way through, so the battle can't be avoided. If that's on purpose, pick the trainer and tick "on purpose" in the Details tab.`,
          cells: [e.y * width + e.x, ...sight],
          entityId: e.id,
        });
    }
  }

  // --- Encounters ----------------------------------------------------------------
  // Grass, deep water and Rock Smash rocks each need a table. Before any draft, one
  // reminder is enough.
  const needed = neededTables(map);
  if (needed.length && !map.encounterPlan)
    warn("no-encounters", "No wild encounter draft yet. Paste a species list in Generate → Gameplay → Encounters, then Generate or Redraft.");
  else if (map.encounterPlan)
    for (const kind of needed)
      if (!map.encounterPlan[kind])
        warn(
          "missing-encounter-table",
          `The map has ${kind === "land" ? "grass" : kind === "rock" ? "Rock Smash rocks" : "deep water"} but no ${TABLE_LABELS[kind]} table. Add one in Encounters, or add species that live there.`,
        );

  // --- Terrain quality -------------------------------------------------------------
  const grass = components(width, height, (i) => IS_GRASS[terrain[i]]);
  const smallGrass: number[] = [];
  for (let i = 0; i < width * height; i++) if (grass.ids[i] >= 0 && grass.sizes[grass.ids[i]] < 6) smallGrass.push(i);
  for (const g of groups(smallGrass, width, height))
    warn("small-grass", `Grass patch at ${xy(g[0])} is only ${g.length} cell${g.length === 1 ? "" : "s"}; patches under 6 cells feel accidental.`, g);

  const narrow: number[] = [];
  const gated = new Uint8Array(width * height);
  for (const z of map.layers.zones) if (z.kind === "hm_gate") z.mask.data.forEach((v, i) => v && (gated[i] = 1));
  // Ledges count as open here: they can be crossed (one way).
  const nextToStairs = (x: number, y: number) => {
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < width && yy < height && terrain[yy * width + xx] === T.stairs) return true;
      }
    return false;
  };
  const blocks = (x: number, y: number) =>
    x < 0 || y < 0 || x >= width || y >= height || (!IS_WALKABLE[terrain[y * width + x]] && TERRAIN_TYPES[terrain[y * width + x]].passability !== "one_way");
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      // Paths onto stairs are naturally one cell wide, like the stairs.
      if (terrain[i] !== T.path || gated[i] || nextToStairs(x, y)) continue;
      if ((blocks(x - 1, y) && blocks(x + 1, y)) || (blocks(x, y - 1) && blocks(x, y + 1))) narrow.push(i);
    }
  // Towns have one-cell walks up to their doors, on purpose.
  if (map.mapType !== "town")
    for (const g of groups(narrow, width, height)) warn("narrow-path", `Path near ${xy(g[0])} is only 1 cell wide.`, g);

  const islands: number[] = [];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const t = terrain[i];
      if (!(IS_GRASS[t] || IS_WATER[t] || t === T.sand || t === T.mud || t === T.flowers)) continue;
      const alone = DIRS.every(({ dx, dy }) => {
        const xx = x + dx;
        const yy = y + dy;
        return xx < 0 || yy < 0 || xx >= width || yy >= height || terrain[yy * width + xx] !== t;
      });
      if (alone) islands.push(i);
    }
  if (islands.length)
    warn("terrain-island", `${islands.length} single-cell patch${islands.length === 1 ? "" : "es"} of terrain (first at ${xy(islands[0])}). These are hard to draw with a tileset.`, islands);

  // Ledges need dry ground at both ends of the jump: vanilla maps never put water there.
  const wetLedges: number[] = [];
  for (let i = 0; i < width * height; i++) if (ledgeWater(terrain, width, height, i) >= 0) wetLedges.push(i);
  if (wetLedges.length)
    err("ledge-water", `${wetLedges.length} ledge${wetLedges.length === 1 ? "" : "s"} with water where the player jumps off or lands (first at ${xy(wetLedges[0])}). Put dry ground both sides of a ledge, or make it cliff.`, wetLedges);

  const diagonal: number[] = [];
  for (let y = 0; y + 1 < height; y++)
    for (let x = 0; x + 1 < width; x++) {
      const a = IS_WALL[terrain[y * width + x]];
      const b = IS_WALL[terrain[y * width + x + 1]];
      const c = IS_WALL[terrain[(y + 1) * width + x]];
      const d = IS_WALL[terrain[(y + 1) * width + x + 1]];
      if (a === d && b === c && a !== b) diagonal.push(y * width + x);
    }
  if (diagonal.length)
    warn("diagonal-trees", `${diagonal.length} spot${diagonal.length === 1 ? "" : "s"} where trees touch only at a corner (first at ${xy(diagonal[0])}). Tilesets can't draw this cleanly.`, diagonal);

  // --- Pacing: deep side areas with nothing in them ----------------------------------
  if (usable.length >= 2) {
    const depth = opts.deadEndDepth ?? 8;
    const reach = graph.forward(allStarts);
    // The "main corridor": cells on shortest walks between the first entrance and the others.
    const fromFirst = distanceField(width, height, usable[0].cells, (i) => reach[i] === 1 || TERRAIN_TYPES[terrain[i]].passability === "one_way");
    const corridor = new Set<number>();
    for (const b of usable.slice(1)) {
      let cur = b.cells.reduce((best, c) => (fromFirst[c] < fromFirst[best] ? c : best), b.cells[0]);
      if (fromFirst[cur] === Infinity) continue;
      while (fromFirst[cur] > 0) {
        corridor.add(cur);
        const x = cur % width;
        const y = (cur - x) / width;
        let next = cur;
        for (const { dx, dy } of DIRS) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
          const j = yy * width + xx;
          if (fromFirst[j] < fromFirst[next]) next = j;
        }
        if (next === cur) break;
        cur = next;
      }
      for (const c of usable[0].cells) corridor.add(c);
    }
    // Ledge cells count as connections here, so the far end of a ledge loop isn't mistaken for a dead end.
    const pacingCell = (i: number) => reach[i] === 1 || TERRAIN_TYPES[terrain[i]].passability === "one_way";
    const fromCorridor = distanceField(width, height, corridor, pacingCell);
    // A warp at the end counts too: the side path leads somewhere.
    const rewardAt = new Set([...map.entities.filter((e) => e.kind !== "sign").map((e) => e.y * width + e.x), ...map.warps.map((w) => w.y * width + w.x)]);
    const side = components(width, height, (i) => pacingCell(i) && fromCorridor[i] > 2);
    const deepest = new Map<number, number>();
    const hasReward = new Set<number>();
    for (let i = 0; i < width * height; i++) {
      const id = side.ids[i];
      if (id < 0) continue;
      if (!deepest.has(id) || fromCorridor[i] > fromCorridor[deepest.get(id)!]) deepest.set(id, i);
      if (rewardAt.has(i) || DIRS.some(({ dx, dy }) => rewardAt.has(i + dy * width + dx))) hasReward.add(id);
    }
    // A real dead end joins the route at one narrow mouth. Areas that touch the
    // route along a long stretch (ledge loops, open ground beside the path) don't count.
    const touchSpan = new Map<number, [number, number]>();
    for (let i = 0; i < width * height; i++) {
      if (!(pacingCell(i) && fromCorridor[i] <= 2) || fromFirst[i] === Infinity) continue;
      const x = i % width;
      const y = (i - x) / width;
      for (const { dx, dy } of DIRS) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
        const id = side.ids[yy * width + xx];
        if (id < 0) continue;
        const span = touchSpan.get(id) ?? [Infinity, -Infinity];
        touchSpan.set(id, [Math.min(span[0], fromFirst[i]), Math.max(span[1], fromFirst[i])]);
      }
    }
    const isDeadEnd = (id: number) => {
      const span = touchSpan.get(id);
      return !!span && span[1] - span[0] <= 6;
    };
    for (const [id, cell] of deepest) {
      if (fromCorridor[cell] >= depth && !hasReward.has(id) && isDeadEnd(id))
        warn("empty-dead-end", `The side area reaching ${xy(cell)} is ${fromCorridor[cell]} steps off the main route with no item or trainer. Consider a reward.`, [cell]);
    }
  }

  return issues;
}

export function countBySeverity(issues: Issue[]) {
  return {
    errors: issues.filter((i) => i.severity === "error").length,
    warnings: issues.filter((i) => i.severity === "warning").length,
  };
}
