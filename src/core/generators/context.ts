// The working state shared by every generation stage.
//
// Stages read and write `terrain` only through set(), which never touches a
// locked cell. `role` records why the generator put something somewhere, so
// later stages (cleanup, placement) know what they must not disturb.

import type { Rng } from "../rng";
import { ValueNoise } from "../noise";
import type { Biome, Entity, Opening, Zone } from "../model";
import type { RouteParams } from "./params";
import { IS_WALKABLE, IS_WALL, T } from "../grid";

/** Why the generator placed a cell. */
export const Role = {
  None: 0,
  Border: 1,
  MainPath: 2,
  Branch: 3,
  Corridor: 4, // ledge shortcut
  Pocket: 5, // HM-gated area (and the wall ring around it)
  Opening: 6, // the gap through the border at an entrance
  Bridge: 7,
  Water: 8,
  Clearing: 9,
} as const;
export type Role = (typeof Role)[keyof typeof Role];

export interface GenInput {
  width: number;
  height: number;
  /** The map's current terrain; only locked cells are kept. */
  terrain: Uint8Array;
  locks: Uint8Array;
  openings: Opening[];
  biome: Biome;
  params: RouteParams;
  /** Used for suggested script labels and flags (e.g. "Route1"). */
  labelBase: string;
}

export class GenContext {
  readonly width: number;
  readonly height: number;
  readonly n: number;
  readonly terrain: Uint8Array;
  readonly locks: Uint8Array;
  readonly role: Uint8Array;
  readonly noise: ValueNoise;
  readonly entities: Entity[] = [];
  readonly zones: Zone[] = [];
  /** Centre-line cells of the main path, entrance to exit. */
  mainLine: number[] = [];
  /** Cell just inside each opening, where the path starts. */
  openingEnds: number[] = [];
  /** Tips of side branches (dead ends). */
  deadEnds: number[] = [];
  /** Centre cell of each HM pocket, and the HM sealing it. */
  pockets: Array<{ center: number; hm: string; zoneId: string }> = [];
  /** True when the route runs top-to-bottom. */
  readonly vertical: boolean;

  constructor(
    readonly input: GenInput,
    readonly rng: Rng,
  ) {
    this.width = input.width;
    this.height = input.height;
    this.n = this.width * this.height;
    this.locks = input.locks;
    this.role = new Uint8Array(this.n);
    this.noise = new ValueNoise(rng.fork("noise"));
    // Locked cells keep the user's terrain. Everything else starts as trees.
    this.terrain = new Uint8Array(this.n);
    for (let i = 0; i < this.n; i++) this.terrain[i] = input.locks[i] ? input.terrain[i] : T.tree;
    const o = input.openings;
    const ns = o.filter((x) => x.edge === "north" || x.edge === "south").length;
    const ew = o.length - ns;
    this.vertical = ns === ew ? this.height >= this.width : ns > ew;
  }

  get params() {
    return this.input.params;
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
