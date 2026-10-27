// Milestone 3, part A: selections (copy, move, paste, delete), the Things tool,
// the lock brush, and regenerating part of a map or all of it.

import { describe, expect, it } from "vitest";
import { applyAreaResult, applyResult, areaInput, generateRoute, wholeMapInput } from "../src/core/generate";
import { T } from "../src/core/grid";
import type { Edit } from "../src/core/model";
import { addNewMap, newRegion } from "../src/core/model";
import { emptyDiff, paintLock, replayStroke } from "../src/core/paint";
import { CURRENT_SCHEMA_VERSION, parseProject, serializeProject } from "../src/core/project";
import { clearArea, copyArea, moveArea, pasteClip, rectFromCorners } from "../src/core/selection";
import { entityAt, facingOf, newThing, nextEntityId, setSight, sightOf, turnClockwise } from "../src/core/things";
import { trainerSight } from "../src/core/entities";

function blank(w = 12, h = 12) {
  const region = newRegion("r", 1);
  return { region, map: addNewMap(region, { name: "Route 9", mapType: "route", width: w, height: h, seed: 5 }) };
}

describe("selections", () => {
  it("rectangles work from any two corners", () => {
    expect(rectFromCorners(5, 2, 1, 4)).toEqual({ x: 1, y: 2, w: 5, h: 3 });
  });

  it("copy + paste duplicates cells and things with new IDs, locked", () => {
    const { map } = blank();
    map.layers.terrain.data[1 * 12 + 1] = T.waterDeep;
    map.entities.push(newThing(map, "trainer", 2, 1));
    const clip = copyArea(map, { x: 1, y: 1, w: 3, h: 2 });
    const area = pasteClip(map, clip, 6, 6, true);
    expect(area).toEqual({ x: 6, y: 6, w: 3, h: 2 });
    expect(map.layers.terrain.data[6 * 12 + 6]).toBe(T.waterDeep);
    expect(map.layers.locks.data[6 * 12 + 6]).toBe(1);
    const copy = entityAt(map, 7, 6)!;
    expect(copy.kind).toBe("trainer");
    expect(copy.id).toBe("T2");
    expect(entityAt(map, 2, 1)!.id).toBe("T1");
  });

  it("move leaves plain locked ground behind and keeps IDs", () => {
    const { map } = blank();
    map.layers.terrain.data[0] = T.tree;
    map.entities.push(newThing(map, "item_ball", 1, 0));
    moveArea(map, { x: 0, y: 0, w: 2, h: 1 }, 5, 5);
    expect(map.layers.terrain.data[0]).toBe(T.ground);
    expect(map.layers.locks.data[0]).toBe(1);
    expect(map.layers.terrain.data[5 * 12 + 5]).toBe(T.tree);
    expect(map.entities).toHaveLength(1);
    expect(map.entities[0]).toMatchObject({ id: "I1", x: 6, y: 5 });
  });

  it("a paste hanging off the edge keeps only the part on the map", () => {
    const { map } = blank();
    const clip = copyArea(map, { x: 0, y: 0, w: 4, h: 4 });
    expect(pasteClip(map, clip, 10, 10, true)).toEqual({ x: 10, y: 10, w: 2, h: 2 });
  });

  it("delete clears to ground and removes the things", () => {
    const { map } = blank();
    map.layers.terrain.data[3 * 12 + 3] = T.rockWall;
    map.entities.push(newThing(map, "sign", 3, 3));
    clearArea(map, { x: 2, y: 2, w: 3, h: 3 });
    expect(map.layers.terrain.data[3 * 12 + 3]).toBe(T.ground);
    expect(map.entities).toHaveLength(0);
  });
});

describe("Things tool", () => {
  it("numbers new things after the highest ID of their kind", () => {
    const { map } = blank();
    map.entities.push({ ...newThing(map, "trainer", 0, 0), id: "T4" });
    expect(nextEntityId(map, "trainer")).toBe("T5");
    expect(nextEntityId(map, "item_ball")).toBe("I1");
  });

  it("new trainers face down with a short sight line; turning goes clockwise and the sight line follows", () => {
    const { map } = blank();
    const t = newThing(map, "trainer", 5, 5);
    expect(t.locked).toBe(true);
    expect(facingOf(t)).toBe("s");
    expect(trainerSight(t, map.width, map.height, map.layers.terrain.data)).toEqual([6 * 12 + 5, 7 * 12 + 5, 8 * 12 + 5]);
    turnClockwise(t);
    expect(facingOf(t)).toBe("w");
    expect(trainerSight(t, map.width, map.height, map.layers.terrain.data)[0]).toBe(5 * 12 + 4);
    turnClockwise(t);
    turnClockwise(t);
    expect(facingOf(t)).toBe("e");
    setSight(t, 20);
    expect(sightOf(t)).toBe(9);
    setSight(t, 0);
    expect(sightOf(t)).toBe(1);
  });

  it("uses vanilla pokeemerald names for HM obstacles", () => {
    const { map } = blank();
    expect(newThing(map, "strength_boulder", 0, 0).fields).toMatchObject({ graphics_id: "OBJ_EVENT_GFX_PUSHABLE_BOULDER", script: "EventScript_StrengthBoulder" });
    expect(newThing(map, "cut_tree", 0, 0).fields.script).toBe("EventScript_CutTree");
  });
});

describe("lock brush", () => {
  it("locks and unlocks without touching terrain, and replays from its edit", () => {
    const { map } = blank();
    map.layers.terrain.data[0] = T.waterDeep;
    const diff = emptyDiff();
    paintLock(map, 0, 0, 1, diff, new Map());
    expect(map.layers.locks.data[0]).toBe(1);
    expect(map.layers.terrain.data[0]).toBe(T.waterDeep);
    const other = blank().map;
    replayStroke(other, { type: "lock", locked: true, brush: 1, cells: [0, 0, 1, 0] });
    expect(Array.from(other.layers.locks.data.slice(0, 3))).toEqual([1, 1, 0]);
  });
});

describe("regenerating", () => {
  it("keeps things placed by hand, and generated IDs never clash with them", () => {
    const { map } = blank(30, 60);
    const first = generateRoute(map);
    applyResult(map, first);
    // Hand-place a trainer called T1 on an open cell.
    const open = Array.from(map.layers.terrain.data).findIndex((t, i) => t === T.ground && !map.entities.some((e) => e.y * 30 + e.x === i));
    const mine = newThing({ ...map, entities: [] }, "trainer", open % 30, Math.floor(open / 30));
    map.layers.locks.data[open] = 1;
    map.entities = [mine];
    const r = generateRoute(map);
    const kept = r.entities.find((e) => e.locked);
    expect(kept).toMatchObject({ id: "T1", x: mine.x, y: mine.y });
    const ids = r.entities.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("regenerating an area changes nothing outside it", () => {
    const { map } = blank(30, 60);
    applyResult(map, generateRoute(map));
    const before = map.layers.terrain.data.slice();
    const outsideThings = map.entities.filter((e) => e.y < 20 || e.y >= 40).map((e) => ({ ...e }));
    const area = { x: 0, y: 20, w: 30, h: 20 };
    const result = generateRoute(areaInput(map, area, 999));
    applyAreaResult(map, area, result);
    let changedInside = 0;
    for (let i = 0; i < before.length; i++) {
      const y = Math.floor(i / 30);
      if (y < 20 || y >= 40) expect(map.layers.terrain.data[i]).toBe(before[i]);
      else if (map.layers.terrain.data[i] !== before[i]) changedInside++;
    }
    expect(changedInside).toBeGreaterThan(0);
    for (const e of outsideThings) expect(map.entities.find((k) => k.id === e.id)).toMatchObject({ x: e.x, y: e.y });
    const ids = map.entities.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("whole-map input ignores every lock", () => {
    const { map } = blank();
    map.layers.locks.data.fill(1);
    map.entities.push(newThing(map, "trainer", 1, 1));
    const input = wholeMapInput(map);
    expect(input.layers.locks.data.every((v) => v === 0)).toBe(true);
    expect(input.entities[0].locked).toBe(false);
    expect(map.layers.locks.data[0]).toBe(1);
  });
});

describe("file format v5", () => {
  it("saves and opens hand-placed things and the new edit records", () => {
    const { region, map } = blank();
    map.entities.push(newThing(map, "trainer", 3, 3));
    const edits: Edit[] = [
      { type: "lock", locked: true, brush: 1, cells: [0, 0] },
      { type: "area", action: "move", area: { x: 0, y: 0, w: 2, h: 2 }, toX: 4, toY: 4 },
      { type: "area", action: "delete", area: { x: 0, y: 0, w: 2, h: 2 }, toX: null, toY: null },
      { type: "entity", action: "turn", id: "T1", kind: "trainer", x: 3, y: 3 },
    ];
    map.edits.push(...edits);
    const loaded = parseProject(serializeProject(region, "test"));
    expect(CURRENT_SCHEMA_VERSION).toBe(5);
    expect(loaded.maps[0].entities[0].locked).toBe(true);
    expect(loaded.maps[0].edits).toEqual(edits);
  });

  it("rejects an area that runs off the map", () => {
    const { region, map } = blank();
    map.edits.push({ type: "area", action: "delete", area: { x: 10, y: 0, w: 5, h: 1 }, toX: null, toY: null });
    expect(() => parseProject(serializeProject(region, "test"))).toThrow(/past the edge/);
  });

  it("opens version-4 files", () => {
    const { region } = blank();
    const v4 = serializeProject(region, "test").replace('"schemaVersion": 5', '"schemaVersion": 4');
    expect(parseProject(v4).maps).toHaveLength(1);
  });
});
