import { describe, expect, it } from "vitest";
import { PALETTES, TERRAIN_TYPES, terrainIndex } from "../src/core/terrain";

describe("terrain vocabulary", () => {
  it("contains every type from the spec", () => {
    const expected = [
      "path", "road", "ground", "tall_grass", "long_grass", "sand", "mud", "flowers", "tree", "dense_forest",
      "rock_wall", "cave_floor", "ledge_s", "ledge_e", "ledge_w", "water_shallow", "water_deep",
      "water_current_n", "water_current_s", "water_current_e", "water_current_w", "waterfall", "dive_spot",
      "bridge", "stairs", "fence", "building", "cave_entrance", "sign_tile", "void",
    ];
    for (const id of expected) expect(terrainIndex(id), id).toBeGreaterThanOrEqual(0);
  });

  it("has no north-facing ledge", () => {
    expect(terrainIndex("ledge_n")).toBe(-1);
    expect(TERRAIN_TYPES.some((t) => t.passability === "one_way" && t.direction === "n")).toBe(false);
  });

  it("fits in one byte per cell", () => {
    expect(TERRAIN_TYPES.length).toBeLessThanOrEqual(256);
  });

  it("every palette has a color for every type", () => {
    for (const p of PALETTES) for (const t of TERRAIN_TYPES) expect(p.colors[t.id], `${p.id}/${t.id}`).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
