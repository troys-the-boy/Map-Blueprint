import { describe, expect, it } from "vitest";
import { addNewMap, newRegion } from "../src/core/model";
import {
  CURRENT_SCHEMA_VERSION,
  explainOpenError,
  migrate,
  parseProject,
  serializeProject,
} from "../src/core/project";
import { FileFormatError } from "../src/core/schema";
import { brushCells, emptyDiff, lineCells, paintCell, replayStroke, applyDiff } from "../src/core/paint";
import { requireTerrain } from "../src/core/terrain";
import type { MapBlueprint, StrokeEdit } from "../src/core/model";

function sampleRegion() {
  const region = newRegion("Test Region", 42);
  const map = addNewMap(region, { name: "Route 1", mapType: "route", width: 40, height: 20, seed: 7 });
  const tree = requireTerrain("tree");
  const diff = emptyDiff();
  const seen = new Map<number, number>();
  const cells: number[] = [];
  for (const [x, y] of lineCells(0, 0, 39, 19)) {
    paintCell(map, x, y, tree, 1, diff, seen);
    cells.push(x, y);
  }
  map.edits.push({ type: "stroke", tool: "pencil", terrain: "tree", brush: 1, locked: true, cells });
  map.entities.push({ id: "e1", kind: "sign", x: 3, y: 4, elevation: "ground", fields: { script: "Route1_EventScript_Sign" } });
  return { region, map };
}

const parseSample = () => JSON.parse(serializeProject(sampleRegion().region, "test"));

describe("save and open", () => {
  it("round-trips a project exactly", () => {
    const { region, map } = sampleRegion();
    const text = serializeProject(region, "test");
    const loaded = parseProject(text);
    expect(loaded.maps).toHaveLength(1);
    const m = loaded.maps[0];
    expect(Array.from(m.layers.terrain.data)).toEqual(Array.from(map.layers.terrain.data));
    expect(Array.from(m.layers.locks.data)).toEqual(Array.from(map.layers.locks.data));
    expect(m.entities).toEqual(map.entities);
    expect(m.edits).toEqual(map.edits);
    // Saving the loaded project again gives the same text.
    expect(serializeProject(loaded, "test", new Date(0))).toBe(serializeProject(region, "test", new Date(0)));
  });

  it("stores layers as a legend plus numbers, one row per line", () => {
    const text = serializeProject(sampleRegion().region, "test");
    const file = JSON.parse(text);
    const terrain = file.region.maps[0].layers.terrain;
    expect(terrain.legend).toEqual(["tree", "ground"]);
    expect(terrain.rows).toHaveLength(20);
    expect(terrain.rows[0]).toHaveLength(40);
    // A whole row on one line: "[0,0,1,1,…]"
    expect(text).toMatch(/\n\s+\[0,[01,]+\],?\n/);
  });

  it("includes a schemaVersion", () => {
    expect(parseSample().schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });
});

describe("opening untrusted files", () => {
  const expectReject = (mutate: (f: any) => void, message: RegExp) => {
    const f = parseSample();
    mutate(f);
    expect(() => parseProject(JSON.stringify(f))).toThrow(message);
  };

  it("rejects text that is not JSON", () => {
    expect(() => parseProject("hello")).toThrow(FileFormatError);
  });

  it("rejects other JSON files", () => {
    expect(() => parseProject('{"name":"x"}')).toThrow(/not a Gen 3 Map Blueprint project/);
  });

  it("rejects unknown fields", () => {
    expectReject((f) => (f.region.maps[0].surprise = 1), /unknown field "surprise"/);
  });

  it("rejects prototype tricks", () => {
    const f = parseSample();
    const text = JSON.stringify(f).replace('"fields":{', '"fields":{"__proto__":{"polluted":true},');
    expect(() => parseProject(text)).toThrow(/not allowed/);
    expect(({} as any).polluted).toBeUndefined();
  });

  it("rejects unknown terrain types", () => {
    expectReject((f) => (f.region.maps[0].layers.terrain.legend[0] = "lava"), /unknown terrain type "lava"/);
  });

  it("rejects grids of the wrong size", () => {
    expectReject((f) => f.region.maps[0].layers.terrain.rows.pop(), /expected 20 rows/);
    expectReject((f) => f.region.maps[0].layers.terrain.rows[3].pop(), /expected 40 cells/);
  });

  it("rejects legend numbers that point nowhere", () => {
    expectReject((f) => (f.region.maps[0].layers.terrain.rows[0][0] = 9), /not in the legend/);
  });

  it("rejects entities outside the map", () => {
    expectReject((f) => (f.region.maps[0].entities[0].x = 45), /outside the 40×20 map/);
  });

  it("rejects connections to maps that don't exist", () => {
    expectReject((f) => f.region.maps[0].connections.push({ direction: "up", map: "map_99", offset: 0 }), /no map with id/);
  });

  it("rejects text that is too long", () => {
    expectReject((f) => (f.region.maps[0].name = "x".repeat(5000)), /too long/);
  });

  it("rejects files from a newer version", () => {
    expectReject((f) => (f.schemaVersion = CURRENT_SCHEMA_VERSION + 1), /newer version/);
  });

  it("rejects oversized files before parsing", () => {
    expect(() => parseProject(" ".repeat(31 * 1024 * 1024))).toThrow(/too large/);
  });

  it("explains errors in plain language", () => {
    try {
      parseProject('{"format":"gen3-map-blueprint-project"}');
    } catch (err) {
      expect(explainOpenError(err)).toMatch(/can't be opened/);
    }
  });
});

describe("migrations", () => {
  it("opens a version-2 file and marks its entrances as walk entrances", () => {
    const f = parseSample();
    f.schemaVersion = 2;
    f.region.maps[0].openings = [{ id: "o1", edge: "north", start: 3, width: 2 }];
    const loaded = parseProject(JSON.stringify(f));
    expect(loaded.maps[0].openings).toEqual([{ id: "o1", edge: "north", start: 3, width: 2, kind: "walk" }]);
  });

  it("opens a version-1 file (Milestone 1) and adds empty openings", () => {
    const f = parseSample();
    f.schemaVersion = 1;
    for (const m of f.region.maps) delete m.openings;
    const loaded = parseProject(JSON.stringify(f));
    expect(loaded.maps[0].openings).toEqual([]);
    expect(loaded.maps[0].entities).toHaveLength(1);
  });

  it("upgrades step by step", () => {
    const steps = {
      1: (f: Record<string, unknown>) => ({ ...f, schemaVersion: 2, a: 1 }),
      2: (f: Record<string, unknown>) => ({ ...f, schemaVersion: 3, b: 2 }),
    };
    expect(migrate({ schemaVersion: 1 }, steps, 3)).toEqual({ schemaVersion: 3, a: 1, b: 2 });
  });

  it("refuses when a step is missing", () => {
    expect(() => migrate({ schemaVersion: 1 }, {}, 2)).toThrow(/cannot upgrade/);
  });
});

describe("painting", () => {
  const blank = (): MapBlueprint => addNewMap(newRegion("r", 1), { name: "m", mapType: "route", width: 10, height: 10, seed: 1 });

  it("lines have no gaps", () => {
    const cells = lineCells(0, 0, 7, 3);
    for (let i = 1; i < cells.length; i++) {
      expect(Math.abs(cells[i][0] - cells[i - 1][0])).toBeLessThanOrEqual(1);
      expect(Math.abs(cells[i][1] - cells[i - 1][1])).toBeLessThanOrEqual(1);
    }
    expect(cells.at(-1)).toEqual([7, 3]);
  });

  it("brush of width 3 covers 9 cells centred on the point", () => {
    expect(brushCells(5, 5, 3)).toContainEqual([4, 4]);
    expect(brushCells(5, 5, 3)).toContainEqual([6, 6]);
    expect(brushCells(5, 5, 3)).toHaveLength(9);
  });

  it("undo restores the map exactly, and replaying the edit gives the same result", () => {
    const map = blank();
    const before = Array.from(map.layers.terrain.data);
    const edit: StrokeEdit = { type: "stroke", tool: "pencil", terrain: "water_deep", brush: 1, locked: true, cells: [1, 1, 2, 2, 1, 1] };
    const diff = replayStroke(map, edit);
    const after = Array.from(map.layers.terrain.data);
    expect(diff.index).toHaveLength(2);
    applyDiff(map, diff, "before");
    expect(Array.from(map.layers.terrain.data)).toEqual(before);
    expect(Array.from(map.layers.locks.data).every((v) => v === 0)).toBe(true);
    applyDiff(map, diff, "after");
    expect(Array.from(map.layers.terrain.data)).toEqual(after);

    const other = blank();
    replayStroke(other, edit);
    expect(Array.from(other.layers.terrain.data)).toEqual(after);
  });

  it("ignores cells outside the map", () => {
    const map = blank();
    const diff = emptyDiff();
    expect(paintCell(map, -1, 3, 0, 1, diff, new Map())).toBe(false);
    expect(paintCell(map, 10, 3, 0, 1, diff, new Map())).toBe(false);
  });
});
