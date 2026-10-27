import { describe, expect, it } from "vitest";
import { SIZE_PRESETS, checkMapSize, maxHeight } from "../src/core/sizeRule";
import { MAP_TYPES } from "../src/core/model";

describe("map size rule: (width + 15) × (height + 14) ≤ 10,240", () => {
  // The table from the spec.
  const table: Array<[number, number]> = [
    [15, 327],
    [20, 278],
    [25, 242],
    [30, 213],
    [40, 172],
    [50, 143],
    [60, 122],
  ];
  it.each(table)("width %i allows height up to %i", (w, h) => {
    expect(maxHeight(w)).toBe(h);
    expect(checkMapSize(w, h).ok).toBe(true);
    expect(checkMapSize(w, h + 1).ok).toBe(false);
  });

  it("allows an 86×86 square but not 87×87", () => {
    expect(checkMapSize(86, 86).ok).toBe(true);
    expect(checkMapSize(87, 87).ok).toBe(false);
  });

  it("reports the remaining budget", () => {
    const c = checkMapSize(40, 20);
    expect(c.used).toBe(55 * 34);
    expect(c.remaining).toBe(10240 - 55 * 34);
  });

  it("uses custom engine limits when a hack raises them", () => {
    const limits = { maxMapDataSize: 20480, mapOffsetW: 15, mapOffsetH: 14, objectEventTemplates: 64 };
    expect(checkMapSize(40, 300, limits).ok).toBe(true);
  });

  it("every preset fits", () => {
    for (const t of MAP_TYPES) for (const p of SIZE_PRESETS[t]) expect(checkMapSize(p.width, p.height).ok).toBe(true);
  });
});
