// Route generator settings: names, defaults and allowed ranges.
//
// Settings are saved in each map's `params` (simple text/number/true-false
// values), so a project file reproduces the same map from the same seed.
// Every setting has a default, so "Generate" works with zero setup.

import type { Hm } from "../constants";
import { HMS } from "../constants";
import type { Biome } from "../model";

export type BorderStyle = "forest" | "cliff";
/** The overall shape of a route. "auto" = coastal for the coastal biome, land otherwise. */
export type LayoutSetting = "auto" | "land" | "coastal" | "river" | "water";
export type Layout = Exclude<LayoutSetting, "auto">;
export const LAYOUTS: readonly LayoutSetting[] = ["auto", "land", "coastal", "river", "water"];
export type StreamMode = "auto" | "yes" | "no";
export type PocketHm = "cut" | "rock_smash" | "surf";
export const POCKET_HMS: readonly PocketHm[] = ["cut", "rock_smash", "surf"];

export interface RouteParams {
  /** Land, coastal (sea along one side), river (a river along the route) or open water (surfing). */
  layout: LayoutSetting;
  /** How hilly: 0 = flat, 1 = several raised plateaus with cliffs, stairs and ledges. */
  elevation: number;
  /** A shorter second way through that's mostly tall grass, so players choose trainers or wild Pokémon. */
  grassShortcut: boolean;
  /** How much grass crosses the main path itself (grass you can't avoid on the path), 0 … 1. */
  pathGrass: number;
  /** Coastal and river routes: add entrances on the water that need Surf. */
  surfEntrances: boolean;
  /** Narrowest and widest the main path can be, in cells. */
  pathWidthMin: number;
  pathWidthMax: number;
  /** 0 = straight, 1 = very winding. */
  winding: number;
  /** Number of side branches (dead ends). */
  branches: number;
  /** 0 = short branches, 1 = long branches. */
  branchLength: number;
  /** Put an item at the end of each dead end. */
  deadEndRewards: boolean;
  /** Ledge shortcuts (one-way loops back to the main path). */
  ledges: number;
  /** Share of open ground that becomes grass, 0 … 1. */
  grass: number;
  /** Amount of water (ponds and streams), 0 … 1. */
  water: number;
  /** How much of the map is tree cover, 0 … 1. */
  treeDensity: number;
  /** Thickness of the wall around the map edge, in cells. */
  borderThickness: number;
  borderStyle: BorderStyle;
  /** A stream crossing the route (with a bridge where it meets the path). */
  stream: StreamMode;
  /** An open clearing beside the path. */
  clearing: boolean;
  /** Optional areas sealed behind an HM. */
  hmPockets: number;
  /** Which HMs can seal pockets. */
  hmPocketTypes: PocketHm[];
  /** HMs the player has when they reach this map (used by validation). */
  availableHms: Hm[];
  trainers: number;
  /** Minimum distance between trainers, in cells. */
  trainerSpacing: number;
  items: number;
  hiddenItems: number;
  /** How many times to retry with a related seed if validation fails. */
  retries: number;
}

export const DEFAULT_ROUTE_PARAMS: RouteParams = {
  layout: "auto",
  elevation: 0.35,
  grassShortcut: true,
  pathGrass: 0.5,
  surfEntrances: true,
  pathWidthMin: 2,
  pathWidthMax: 3,
  winding: 0.5,
  branches: 2,
  branchLength: 0.5,
  deadEndRewards: true,
  ledges: 1,
  grass: 0.65,
  water: 0.25,
  treeDensity: 0.55,
  borderThickness: 2,
  borderStyle: "forest",
  stream: "auto",
  clearing: true,
  hmPockets: 1,
  hmPocketTypes: ["cut", "rock_smash", "surf"],
  availableHms: [],
  trainers: 3,
  trainerSpacing: 8,
  items: 2,
  hiddenItems: 2,
  retries: 8,
};

/** Allowed range for each number setting: [min, max, whole numbers only]. */
export const PARAM_RANGES: Record<string, [number, number, boolean]> = {
  elevation: [0, 1, false],
  pathGrass: [0, 1, false],
  pathWidthMin: [1, 4, true],
  pathWidthMax: [1, 5, true],
  winding: [0, 1, false],
  branches: [0, 6, true],
  branchLength: [0, 1, false],
  ledges: [0, 4, true],
  grass: [0, 1, false],
  water: [0, 1, false],
  treeDensity: [0, 1, false],
  borderThickness: [1, 4, true],
  hmPockets: [0, 3, true],
  trainers: [0, 10, true],
  trainerSpacing: [3, 20, true],
  items: [0, 10, true],
  hiddenItems: [0, 10, true],
  retries: [0, 20, true],
};

function clampNumber(key: string, v: unknown, fallback: number): number {
  const [min, max, whole] = PARAM_RANGES[key];
  if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
  const c = Math.min(max, Math.max(min, v));
  return whole ? Math.round(c) : c;
}

function parseList<T extends string>(v: unknown, allowed: readonly T[], fallback: T[]): T[] {
  if (typeof v !== "string") return fallback;
  if (v.trim() === "") return [];
  return v
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is T => (allowed as readonly string[]).includes(s));
}

/** Read route settings from a map's saved params, filling gaps with defaults and clamping to range. */
export function readRouteParams(params: Record<string, string | number | boolean>): RouteParams {
  const d = DEFAULT_ROUTE_PARAMS;
  const p: RouteParams = { ...d };
  for (const key of Object.keys(PARAM_RANGES)) {
    (p as unknown as Record<string, number>)[key] = clampNumber(key, params[key], (d as unknown as Record<string, number>)[key]);
  }
  if (p.pathWidthMax < p.pathWidthMin) p.pathWidthMax = p.pathWidthMin;
  p.deadEndRewards = typeof params.deadEndRewards === "boolean" ? params.deadEndRewards : d.deadEndRewards;
  p.grassShortcut = typeof params.grassShortcut === "boolean" ? params.grassShortcut : d.grassShortcut;
  p.surfEntrances = typeof params.surfEntrances === "boolean" ? params.surfEntrances : d.surfEntrances;
  p.layout = (LAYOUTS as readonly unknown[]).includes(params.layout) ? (params.layout as LayoutSetting) : d.layout;
  p.clearing = typeof params.clearing === "boolean" ? params.clearing : d.clearing;
  p.borderStyle = params.borderStyle === "cliff" ? "cliff" : "forest";
  p.stream = params.stream === "yes" || params.stream === "no" ? params.stream : "auto";
  p.hmPocketTypes = parseList(params.hmPocketTypes, POCKET_HMS, d.hmPocketTypes);
  p.availableHms = parseList(params.availableHms, HMS, d.availableHms);
  return p;
}

/** Turn settings back into saveable params. */
export function writeRouteParams(p: RouteParams): Record<string, string | number | boolean> {
  return {
    ...Object.fromEntries(Object.keys(PARAM_RANGES).map((k) => [k, (p as unknown as Record<string, number>)[k]])),
    deadEndRewards: p.deadEndRewards,
    grassShortcut: p.grassShortcut,
    surfEntrances: p.surfEntrances,
    layout: p.layout,
    clearing: p.clearing,
    borderStyle: p.borderStyle,
    stream: p.stream,
    hmPocketTypes: p.hmPocketTypes.join(","),
    availableHms: p.availableHms.join(","),
  };
}

/** The layout actually used: "auto" means coastal for the coastal biome, land otherwise. */
export function resolveLayout(p: RouteParams, biome: Biome): Layout {
  if (p.layout !== "auto") return p.layout;
  return biome === "coastal" ? "coastal" : "land";
}

/** HMs the player has here. Open-water routes always assume Surf (you can't cross them without it). */
export function hmsFor(p: RouteParams, biome: Biome): Hm[] {
  const hms = [...p.availableHms];
  if (resolveLayout(p, biome) === "water" && !hms.includes("surf")) hms.push("surf");
  return hms;
}
