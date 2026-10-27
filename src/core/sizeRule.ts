// The map size rule and map size presets.
//
// pokeemerald copies each map into a fixed RAM buffer with a margin around it
// (see constants.ts). A map fits when
//     (width + MAP_OFFSET_W) × (height + MAP_OFFSET_H) ≤ MAX_MAP_DATA_SIZE
// which in vanilla Emerald is (width + 15) × (height + 14) ≤ 10,240.

import type { EngineLimits, MapType } from "./model";
import { DEFAULT_ENGINE_LIMITS } from "./model";

export interface SizeCheck {
  ok: boolean;
  /** Buffer cells this map needs, margin included. */
  used: number;
  /** Buffer cells available. */
  limit: number;
  /** limit - used (negative when over). */
  remaining: number;
  /** The tallest map allowed at this width. */
  maxHeightForWidth: number;
  /** The widest map allowed at this height. */
  maxWidthForHeight: number;
}

export function checkMapSize(width: number, height: number, limits: EngineLimits = DEFAULT_ENGINE_LIMITS): SizeCheck {
  const used = (width + limits.mapOffsetW) * (height + limits.mapOffsetH);
  const limit = limits.maxMapDataSize;
  return {
    ok: width >= 1 && height >= 1 && used <= limit,
    used,
    limit,
    remaining: limit - used,
    maxHeightForWidth: maxHeight(width, limits),
    maxWidthForHeight: Math.max(0, Math.floor(limit / (height + limits.mapOffsetH)) - limits.mapOffsetW),
  };
}

export function maxHeight(width: number, limits: EngineLimits = DEFAULT_ENGINE_LIMITS): number {
  return Math.max(0, Math.floor(limits.maxMapDataSize / (width + limits.mapOffsetW)) - limits.mapOffsetH);
}

/** Plain-language explanation for the UI. */
export function describeSizeCheck(c: SizeCheck): string {
  if (c.ok) return `Fits: uses ${c.used.toLocaleString("en-US")} of ${c.limit.toLocaleString("en-US")} (${c.remaining.toLocaleString("en-US")} left).`;
  return `Too big for the game: needs ${c.used.toLocaleString("en-US")} of ${c.limit.toLocaleString("en-US")}. At this width the map can be at most ${c.maxHeightForWidth} tall.`;
}

export interface SizePreset {
  label: string;
  width: number;
  height: number;
}

/**
 * Size presets per map type. Route presets are from the spec (vertical; swap
 * width and height for a horizontal route). Forest, cave floor and interior
 * presets are placeholders until confirmed by the user.
 */
export const SIZE_PRESETS: Record<MapType, SizePreset[]> = {
  route: [
    { label: "S (vertical)", width: 20, height: 40 },
    { label: "M (vertical)", width: 30, height: 60 },
    { label: "L (vertical)", width: 40, height: 80 },
    { label: "S (horizontal)", width: 40, height: 20 },
    { label: "M (horizontal)", width: 60, height: 30 },
    { label: "L (horizontal)", width: 80, height: 40 },
  ],
  town: [
    { label: "S", width: 20, height: 20 },
    { label: "M", width: 30, height: 30 },
    { label: "L", width: 40, height: 40 },
  ],
  forest: [
    { label: "S", width: 40, height: 40 },
    { label: "M", width: 50, height: 50 },
    { label: "L", width: 60, height: 60 },
  ],
  cave: [
    { label: "S", width: 30, height: 30 },
    { label: "M", width: 40, height: 40 },
    { label: "L", width: 50, height: 50 },
  ],
  interior_stub: [{ label: "Small room", width: 15, height: 10 }],
};
