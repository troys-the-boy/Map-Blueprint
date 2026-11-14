// The land round a settlement (land and settlements, part G): fields, orchards,
// paddocks, ponds and berry patches on the open ground just outside the built-up
// part of a town, so a compact town on a big map sits in worked country instead
// of bare ground. (Giving a settlement its rural land use is something Magna
// Urbis does for its villages; this is written for this grid, not taken from it.)
//
//   • Field:        a fenced plot of tilled rows (mud and flowers), with a gate.
//   • Orchard:      trees in a regular grid, with ground to walk between them.
//   • Paddock:      a fenced enclosure with a gate; grass inside if the town
//                   has grass at its edges, bare ground if not.
//   • Pond:         a small pool of shallow water (no Surf, no encounters).
//   • Berry patch:  a row of berry trees on soft soil, with room to stand in front.
//
// Each goes on free, level ground a few cells out from the buildings, off the
// streets, and never on anything locked. Fences always have a gate, so nothing
// is shut in. Nearer the map's edge the land is left wild.

import { T, distanceField } from "../grid";
import type { GenContext } from "./context";
import { Role } from "./context";

type Kind = "field" | "orchard" | "paddock" | "pond" | "berries";

/** The order features are added in: fields are the commonest. */
const ORDER: Kind[] = ["field", "orchard", "pond", "field", "paddock", "berries", "field", "orchard", "paddock", "field"];

/**
 * Add fields and outskirts round the buildings. `amount` is 0 … 1: how much of the
 * country is worked (about one feature per 400 cells of map at 0.5). `grass` puts
 * tall grass in the paddocks.
 */
export function addOutskirts(ctx: GenContext, amount: number, grass: boolean): void {
  if (amount <= 0 || !ctx.buildings.length) return;
  const bt = ctx.params.borderThickness;
  const free = (i: number) => !ctx.locks[i] && ctx.role[i] === Role.None && ctx.terrain[i] === T.ground && ctx.edgeDist(i) >= bt + 1 && !ctx.keepClear.has(i);
  const taken = new Set<number>(ctx.entities.map((e) => ctx.idx(e.x, e.y)));
  const streets: number[] = [];
  const built: number[] = [];
  for (let i = 0; i < ctx.n; i++) {
    if (ctx.role[i] === Role.MainPath || ctx.role[i] === Role.Branch || ctx.role[i] === Role.Opening || ctx.role[i] === Role.Stairs) streets.push(i);
    if (ctx.terrain[i] === T.building) built.push(i);
  }
  const fromStreet = distanceField(ctx.width, ctx.height, streets);
  const fromTown = distanceField(ctx.width, ctx.height, built);
  const cx = built.reduce((s, i) => s + (i % ctx.width), 0) / built.length;
  const cy = built.reduce((s, i) => s + Math.floor(i / ctx.width), 0) / built.length;
  const count = Math.max(1, Math.min(ORDER.length, Math.round((amount * ctx.width * ctx.height) / 200)));
  const reach = 12 + amount * 12;
  let berries = ctx.entities.filter((e) => e.kind === "berry_tree").length;
  const flagBase = ctx.input.labelBase.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase();

  for (let k = 0; k < count; k++) {
    const kind = ORDER[k];
    const odd = (n: number) => (n % 2 ? n : n + 1);
    const [w, h] =
      kind === "field"
        ? [ctx.rng.int(6, 9), ctx.rng.int(4, 6)]
        : kind === "orchard"
          ? [odd(ctx.rng.int(5, 8)), odd(ctx.rng.int(4, 6))]
          : kind === "paddock"
            ? [ctx.rng.int(5, 7), ctx.rng.int(4, 5)]
            : kind === "pond"
              ? [ctx.rng.int(4, 5), 3]
              : [ctx.rng.int(5, 7), 2];
    // The best spot: clear, level ground with a cell to spare all round, a little way out of
    // town, off the streets.
    let best = -1;
    let bestScore = -Infinity;
    for (let y = 1; y + h + 1 < ctx.height; y++)
      for (let x = 1; x + w + 1 < ctx.width; x++) {
        const mid = ctx.idx(x + (w >> 1), y + (h >> 1));
        if (fromTown[mid] < 4 || fromTown[mid] > reach || fromStreet[mid] < 2) continue;
        const level = ctx.elevation[mid];
        let ok = true;
        for (let yy = y - 1; yy <= y + h && ok; yy++)
          for (let xx = x - 1; xx <= x + w && ok; xx++) {
            const i = ctx.idx(xx, yy);
            ok = free(i) && !taken.has(i) && ctx.elevation[i] === level && fromTown[i] >= 3 && fromStreet[i] >= 1;
          }
        if (!ok) continue;
        const score = -Math.abs(fromTown[mid] - 7) - fromStreet[mid] * 0.3 + ctx.rng.next() * 4;
        if (score > bestScore) (bestScore = score, (best = ctx.idx(x, y)));
      }
    if (best < 0) continue;
    const [x0, y0] = ctx.xy(best);
    const at = (dx: number, dy: number) => ctx.idx(x0 + dx, y0 + dy);
    const mark = (i: number, terrain: number, role: Role = Role.Clearing) => {
      ctx.set(i, terrain, role);
      taken.add(i);
    };
    // A fenced plot's gate: the middle of the side that faces the town.
    const fence = (inside: (dx: number, dy: number) => number) => {
      const dxTown = cx - (x0 + w / 2);
      const dyTown = cy - (y0 + h / 2);
      const sideways = Math.abs(dxTown) > Math.abs(dyTown);
      const gate = sideways ? at(dxTown > 0 ? w - 1 : 0, h >> 1) : at(w >> 1, dyTown > 0 ? h - 1 : 0);
      // The ground just outside the gate stays clear, so a tree never grows in the way.
      const outside = sideways ? at(dxTown > 0 ? w : -1, h >> 1) : at(w >> 1, dyTown > 0 ? h : -1);
      ctx.keepClear.add(outside);
      taken.add(outside);
      for (let dy = 0; dy < h; dy++)
        for (let dx = 0; dx < w; dx++) {
          const i = at(dx, dy);
          const rim = dx === 0 || dy === 0 || dx === w - 1 || dy === h - 1;
          if (i === gate) {
            mark(i, T.ground);
            ctx.keepClear.add(i);
          } else if (rim) mark(i, T.fence, Role.Building);
          else mark(i, inside(dx, dy));
        }
    };
    if (kind === "field") fence((_dx, dy) => (dy % 2 ? T.mud : T.flowers));
    else if (kind === "paddock") fence(() => (grass ? T.tallGrass : T.ground));
    else if (kind === "orchard") {
      for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) dx % 2 === 0 && dy % 2 === 0 ? mark(at(dx, dy), T.tree, Role.Building) : mark(at(dx, dy), T.ground);
    } else if (kind === "pond") {
      // Rounded: the four corners stay ground.
      for (let dy = 0; dy < h; dy++)
        for (let dx = 0; dx < w; dx++) {
          const corner = (dx === 0 || dx === w - 1) && (dy === 0 || dy === h - 1);
          mark(at(dx, dy), corner ? T.ground : T.waterShallow, corner ? Role.Clearing : Role.Water);
        }
    } else {
      // Berry trees every other cell along a strip of soft soil, with the row in front kept clear to stand on.
      for (let dx = 0; dx < w; dx++) {
        mark(at(dx, 0), T.mud);
        mark(at(dx, 1), T.ground);
        ctx.keepClear.add(at(dx, 1));
        if (dx % 2 === 0) continue;
        berries++;
        ctx.entities.push({
          id: `Y${berries}`,
          kind: "berry_tree",
          x: x0 + dx,
          y: y0,
          elevation: "ground",
          fields: {
            graphics_id: "OBJ_EVENT_GFX_BERRY_TREE",
            movement_type: "MOVEMENT_TYPE_BERRY_TREE_GROWTH",
            script: "BerryTreeScript",
            flag: "0",
            movement_range_x: 0,
            movement_range_y: 0,
            trainer_type: "TRAINER_TYPE_NONE",
            trainer_sight_or_berry_tree_id: `BERRY_TREE_${flagBase}_${berries}`,
          },
        });
      }
    }
  }
}
