// The working state shared by every generation stage.
//
// Stages read and write `terrain` only through set(), which never touches a
// locked cell. `role` records why the generator put something somewhere, so
// later stages (cleanup, placement) know what they must not disturb.

import type { Rng } from "../rng";
import { ValueNoise } from "../noise";
import type { Biome, Entity, MapType, Opening, Warp, Zone } from "../model";
import type { TownParams } from "./townParams";
import type { TownBuilding } from "./town";
import { BIOMES } from "../model";
import type { Layout, RouteParams } from "./params";
import type { Travel } from "./travel";
import { travelOf, travelVertical } from "./travel";
import { IS_WALKABLE, IS_WALL, T } from "../grid";
import { ELEVATION_LEVELS } from "../terrain";

/** Why the generator placed a cell. */
export const Role = {
  None: 0,
  Border: 1,
  MainPath: 2,
  Branch: 3,
  Corridor: 4, // a ledge row: the ledges, and the trees and rocks in line with them
  Pocket: 5, // HM-gated area (and the wall ring around it)
  Opening: 6, // the gap through the border at an entrance
  Bridge: 7,
  Water: 8, // ponds and streams
  Clearing: 9,
  Sea: 10, // layout water: the sea, a river, open water
  Beach: 11, // sand along a shore
  Cliff: 12, // the rim of a plateau (cliff faces and ledges)
  Stairs: 13, // stairs up a plateau, and the cells in front of and behind them
  GrassRoute: 14, // the grass shortcut ("two ways through")
  Keep: 15, // a zone's keep-clear or open ground: stays walkable ground
  Building: 16, // a town building, its fences and signs
} as const;
export type Role = (typeof Role)[keyof typeof Role];

/** Elevation level indices (into ELEVATION_LEVELS). */
export const LEVEL = {
  water: ELEVATION_LEVELS.indexOf("water"),
  ground: ELEVATION_LEVELS.indexOf("ground"),
  raised1: ELEVATION_LEVELS.indexOf("raised1"),
  raised2: ELEVATION_LEVELS.indexOf("raised2"),
  raised3: ELEVATION_LEVELS.indexOf("raised3"),
  raised4: ELEVATION_LEVELS.indexOf("raised4"),
  bridge: ELEVATION_LEVELS.indexOf("bridge"),
};

/** Plateau levels from the lowest up: RAISED[0] is raised1. */
export const RAISED = [LEVEL.raised1, LEVEL.raised2, LEVEL.raised3, LEVEL.raised4];

export interface GenInput {
  width: number;
  height: number;
  /** The map's current terrain and elevation; only locked cells are kept. */
  terrain: Uint8Array;
  elevation: Uint8Array;
  locks: Uint8Array;
  openings: Opening[];
  /** Warps placed by hand (doors, cave mouths…): the path must lead to each one. */
  warps: Warp[];
  /** What kind of map this is (routes and towns have their own generators). */
  mapType?: MapType;
  /** The map's MAP_* constant, for naming interiors behind generated doors. */
  mapConstant?: string;
  /** Town settings (towns only). */
  town?: TownParams;
  biome: Biome;
  /** The user's zones (not the generator's own). */
  zones: Zone[];
  layout: Layout;
  params: RouteParams;
  /** Used for suggested script labels and flags (e.g. "Route1"). */
  labelBase: string;
  /** Seed for layout geometry (shoreline, river line). Fixed across retries so entrances stay put. */
  layoutSeed: number;
}

export class GenContext {
  readonly width: number;
  readonly height: number;
  readonly n: number;
  readonly terrain: Uint8Array;
  /** Elevation level per cell (index into ELEVATION_LEVELS). */
  readonly elevation: Uint8Array;
  readonly locks: Uint8Array;
  readonly role: Uint8Array;
  readonly noise: ValueNoise;
  readonly entities: Entity[] = [];
  readonly zones: Zone[] = [];
  /** Biome of each cell (index into BIOMES): the map's biome, or a biome zone's. */
  readonly biomeIndex: Uint8Array;
  /** Water cells the path may cross on a bridge (rivers). */
  readonly crossable: Uint8Array;
  /** Which cells each of the user's zones covers this time (see generators/zones.ts). */
  zoneCells: Array<{ zone: Zone; cells: Uint8Array }> = [];
  /** Centre-line cells of the main path, entrance to exit (the surfing lane on open water). */
  mainLine: number[] = [];
  /** Cell just inside each walk entrance, where the path starts. */
  openingEnds: number[] = [];
  /** Tips of side branches (dead ends). */
  deadEnds: number[] = [];
  /** Centre cell of each HM pocket, and the HM sealing it. */
  pockets: Array<{ center: number; hm: string; zoneId: string }> = [];
  /** Every flight of stairs: the stairs cell, the cell at its foot and the cell at its top. */
  stairs: Array<{ cell: number; front: number; back: number }> = [];
  /** The stretch of main path (indices into mainLine) that the grass shortcut bypasses. */
  shortcut: { from: number; to: number } | null = null;
  /** True when the route runs top-to-bottom. */
  readonly vertical: boolean;
  /** Which way the player first travels the route, or null for no direction (see travel.ts). */
  readonly travel: Travel | null;
  /** Cells of the ways round ledge rows that jump back toward the start: the forward path, where trainers wait. */
  ledgeDetours = new Set<number>();
  /** Ledge pockets: the cell for their item (reached by jumping in, on the way back). */
  ledgePockets: number[] = [];
  /** Cells nothing may be placed on (where the player jumps into and out of a ledge pocket, or a door's front step). */
  keepClear = new Set<number>();
  /** Warps the generator made (town doors). */
  warps: Warp[] = [];
  /** Town buildings, with their door cells. */
  buildings: TownBuilding[] = [];

  constructor(
    readonly input: GenInput,
    readonly rng: Rng,
  ) {
    this.width = input.width;
    this.height = input.height;
    this.n = this.width * this.height;
    this.locks = input.locks;
    this.role = new Uint8Array(this.n);
    this.biomeIndex = new Uint8Array(this.n).fill(Math.max(0, BIOMES.indexOf(input.biome)));
    this.crossable = new Uint8Array(this.n);
    this.noise = new ValueNoise(rng.fork("noise"));
    // Locked cells keep the user's terrain and elevation. Everything else starts as trees on the ground.
    this.terrain = new Uint8Array(this.n);
    this.elevation = new Uint8Array(this.n).fill(LEVEL.ground);
    for (let i = 0; i < this.n; i++) {
      if (input.locks[i]) {
        this.terrain[i] = input.terrain[i];
        this.elevation[i] = input.elevation[i];
      } else this.terrain[i] = T.tree;
    }
    const o = input.openings;
    const ns = o.filter((x) => x.edge === "north" || x.edge === "south").length;
    const ew = o.length - ns;
    this.vertical = ns === ew ? this.height >= this.width : ns > ew;
    const travel = travelOf(input.params.travel);
    // A direction only counts if it runs the same way as the route, with an entrance at each end.
    const ends = travel && o.some((x) => x.edge === travel.from) && o.some((x) => x.edge === travel.to);
    this.travel = travel && ends && travelVertical(travel) === this.vertical ? travel : null;
  }

  /** The biome of a cell. */
  biomeAt(i: number): Biome {
    return BIOMES[this.biomeIndex[i]];
  }

  get params() {
    return this.input.params;
  }
  get layout() {
    return this.input.layout;
  }

  idx(x: number, y: number) {
    return y * this.width + x;
  }
  xy(i: number): [number, number] {
    const x = i % this.width;
    return [x, (i - x) / this.width];
  }
  inside(x: number, y: number) {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }
  /** Distance from a cell to the nearest map edge. */
  edgeDist(i: number) {
    const [x, y] = this.xy(i);
    return Math.min(x, y, this.width - 1 - x, this.height - 1 - y);
  }

  /** Change a cell's terrain unless it's locked. Returns true if it changed. */
  set(i: number, terrain: number, role?: Role): boolean {
    if (this.locks[i]) return false;
    this.terrain[i] = terrain;
    if (role !== undefined) this.role[i] = role;
    return true;
  }

  isWalkable(i: number) {
    return IS_WALKABLE[this.terrain[i]];
  }
  isWall(i: number) {
    return IS_WALL[this.terrain[i]];
  }
  /** Cells that later stages must leave alone. */
  isProtected(i: number) {
    const r = this.role[i];
    return this.locks[i] === 1 || (r !== Role.None && r !== Role.Clearing && r !== Role.Water);
  }

  /** Paint a square brush (same footprint as the pencil) centred on a cell. */
  stamp(i: number, size: number, terrain: number, role: Role, canOverwrite: (j: number) => boolean = () => true) {
    const [cx, cy] = this.xy(i);
    const start = -Math.floor((size - 1) / 2);
    for (let dy = 0; dy < size; dy++)
      for (let dx = 0; dx < size; dx++) {
        const x = cx + start + dx;
        const y = cy + start + dy;
        if (!this.inside(x, y)) continue;
        const j = this.idx(x, y);
        if (canOverwrite(j)) this.set(j, terrain, role);
      }
  }
}
