// Revisions after Milestone 6, part A: no ledges by water, and straight routes split as one stretch.

import { describe, expect, it } from "vitest";
import { buildRegion } from "../src/core/buildRegion";
import { applyResult, generateRoute } from "../src/core/generate";
import { T, ledgeWater } from "../src/core/grid";
import { addNewMap, newRegion } from "../src/core/model";
import { parseProject, serializeProject } from "../src/core/project";
import { SKETCH_AREAS, addOutdoor, newSketch, paintAreas, placePieces } from "../src/core/sketch";
import { validateMap } from "../src/core/validate";

describe("ledges and water", () => {
  it("hills along a river or lake never get a ledge that jumps off water or into it", () => {
    const lake = SKETCH_AREAS.indexOf("lake") + 1;
    for (let seed = 1; seed <= 12; seed++) {
      const r = newRegion("r", seed);
      const s = newSketch(300, 200);
      r.sketch = s;
      addOutdoor(s, "route", { x: 0, y: 0, w: 30, h: 90 });
      addOutdoor(s, "route", { x: 30, y: 30, w: 90, h: 30 });
      s.rivers.push({ id: "r1", points: [0, 40 + seed, 120, 45], width: 3 });
      paintAreas(s, 15, 70, 3, lake);
      paintAreas(s, 80, 40, 2, lake);
      const report = buildRegion(r);
      expect(report.blocked).toEqual([]);
      for (const id of report.needsGenerate) {
        const m = r.maps.find((x) => x.id === id)!;
        m.params.elevation = 0.8; // plenty of hills, whose cliff edges become ledges
        applyResult(m, generateRoute(m, { otherMaps: r.maps }));
        const t = m.layers.terrain.data;
        const wet = [...t.keys()].filter((i) => ledgeWater(t, m.width, m.height, i) >= 0);
        expect(wet, `seed ${seed} ${m.name}`).toEqual([]);
        expect(validateMap(m, { otherMaps: r.maps }).some((i) => i.code === "ledge-water")).toBe(false);
      }
    }
  }, 300_000);

  it("the checks flag a ledge painted by hand with water below it", () => {
    const m = addNewMap(newRegion("r", 1), { name: "M", mapType: "route", width: 20, height: 20, seed: 1, biome: "meadow" });
    m.layers.terrain.data.fill(T.ground);
    m.layers.terrain.data[5 * 20 + 5] = T.ledgeS;
    expect(validateMap(m).some((i) => i.code === "ledge-water")).toBe(false);
    m.layers.terrain.data[6 * 20 + 5] = T.waterDeep;
    const issue = validateMap(m).find((i) => i.code === "ledge-water")!;
    expect(issue.severity).toBe("error");
    expect(issue.cells).toEqual([5 * 20 + 5]);
  });
});

describe("routes drawn in several straight goes", () => {
  it("join into one stretch, so they split into as few maps as one long rectangle", () => {
    const s = newSketch(400, 300);
    const route = addOutdoor(s, "route", { x: 0, y: 0, w: 30, h: 100 });
    addOutdoor(s, "route", { x: 0, y: 100, w: 30, h: 60 }, route);
    expect(route.rects).toEqual([{ x: 0, y: 0, w: 30, h: 160 }]);
    expect(placePieces(route, 90).map((p) => p.h)).toEqual([80, 80]);
    // A bend stays a separate stretch; a narrower piece doesn't join either.
    addOutdoor(s, "route", { x: 30, y: 130, w: 60, h: 30 }, route);
    addOutdoor(s, "route", { x: 90, y: 135, w: 40, h: 20 }, route);
    expect(route.rects).toHaveLength(3);
  });

  it("older projects with a straight route in pieces are joined when opened", () => {
    const r = newRegion("r", 1);
    r.sketch = newSketch(200, 200);
    const route = addOutdoor(r.sketch, "route", { x: 0, y: 0, w: 30, h: 50 });
    route.rects.push({ x: 0, y: 50, w: 30, h: 50 }, { x: 0, y: 100, w: 30, h: 40 });
    const back = parseProject(serializeProject(r, "test"));
    expect(back.sketch!.places[0].rects).toEqual([{ x: 0, y: 0, w: 30, h: 140 }]);
  });
});
