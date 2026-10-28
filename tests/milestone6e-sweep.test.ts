// Milestone 6, part E: the region goal over several region seeds (each map's seed comes from the region's).

import { describe, expect, it } from "vitest";
import { buildRegion, pairRegionWarps } from "../src/core/buildRegion";
import { applyResult, generateRoute } from "../src/core/generate";
import { newRegion } from "../src/core/model";
import { addInside, addOutdoor, newSketch } from "../src/core/sketch";
import { validateMap } from "../src/core/validate";

describe("building a region over many seeds", () => {
  it("every map passes its checks", () => {
    for (let seed = 1; seed <= 8; seed++) {
      const r = newRegion("Sweep", seed * 7919);
      const s = newSketch(400, 260);
      r.sketch = s;
      const fir = addOutdoor(s, "town", { x: 100, y: 0, w: 30, h: 30 });
      const r1 = addOutdoor(s, "route", { x: 100, y: 30, w: 30, h: 120 });
      const birch = addOutdoor(s, "town", { x: 95, y: 150, w: 40, h: 30 });
      const r2 = addOutdoor(s, "route", { x: 135, y: 150, w: 150, h: 30 });
      const cedar = addOutdoor(s, "town", { x: 285, y: 140, w: 40, h: 40 });
      const r3 = addOutdoor(s, "route", { x: 290, y: 30, w: 30, h: 110 });
      const r4 = addOutdoor(s, "route", { x: 130, y: 0, w: 170, h: 30 });
      addInside(s, "cave", { x: 112, y: 80 });
      s.rivers.push({ id: "r1", points: [195, 140, 225, 195], width: 3 });
      s.journey.stops = [fir.id, r1.id, birch.id, r2.id, cedar.id, r3.id, r4.id, fir.id];
      const report = buildRegion(r);
      for (const id of report.needsGenerate) {
        const m = r.maps.find((x) => x.id === id)!;
        applyResult(m, generateRoute(m, { otherMaps: r.maps }));
      }
      pairRegionWarps(r);
      for (const m of r.maps) {
        const errors = validateMap(m, { otherMaps: r.maps }).filter((i) => i.severity === "error");
        expect(errors.map((e) => `seed ${seed} ${m.name}: ${e.code} ${e.message}`)).toEqual([]);
      }
    }
  }, 600_000);
});
