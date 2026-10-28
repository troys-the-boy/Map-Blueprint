// Colours for drawing zones over the map (and in the Zones tab).

import type { Zone } from "../core/model";

export const BIOME_COLORS: Record<string, string> = {
  temperate_rainforest: "#3f9a55",
  coastal: "#e2c97a",
  wetland: "#55a08c",
  alpine: "#b7c2c9",
  meadow: "#d4cc5c",
  urban_edge: "#c08a6e",
};

const WATER_COLORS: Record<string, string> = { lake: "#3f86e0", pond: "#5a9be6", river: "#3fa6e0", ocean: "#2f6fd0", marsh: "#6fb39a" };

const EDGE_COLORS: Record<string, string> = { coast: "#2f6fd0", riverbank: "#3fa6e0", cliff: "#9aa0a8", forest: "#2a6b3a", open: "#f0e3a0" };

export function zoneColor(z: Zone): string {
  if (z.kind === "biome") return BIOME_COLORS[String(z.data.biome)] ?? "#cccccc";
  if (z.kind === "water") return WATER_COLORS[String(z.data.water)] ?? "#3f86e0";
  if (z.kind === "edge") return EDGE_COLORS[String(z.data.boundary)] ?? "#cccccc";
  if (z.kind === "keep_clear") return "#f4f4f4";
  return "#cccccc";
}

/** A colour for the k-th region map section: well spread round the colour wheel. */
export function sectionColor(k: number): string {
  return `hsl(${Math.round((k * 137.5) % 360)}, 55%, 58%)`;
}

/** Colours for the region sketch's painted areas. */
export const SKETCH_AREA_COLORS: Record<string, string> = { ...BIOME_COLORS, lake: "#3f86e0", sea: "#2f6fd0" };
