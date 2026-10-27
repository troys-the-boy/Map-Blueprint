// The Generate panel: seed, settings in collapsible groups, and the button.
// Every setting has a default, so Generate works without touching anything.

import { useState } from "react";
import { HMS } from "../../core/constants";
import type { Hm } from "../../core/constants";
import { canGenerate } from "../../core/generate";
import { DEFAULT_ROUTE_PARAMS, PARAM_RANGES, POCKET_HMS, readRouteParams, resolveBorder, resolveLayout, writeRouteParams } from "../../core/generators/params";
import type { Layout, LayoutSetting } from "../../core/generators/params";
import type { RouteParams } from "../../core/generators/params";
import { TRAVEL_LABELS, TRAVEL_SETTINGS, travelOf, travelVertical } from "../../core/generators/travel";
import { BUILDING_TYPES, TOWN_LAYOUTS, TOWN_LAYOUT_LABELS, TOWN_RANGES, buildingList, readTownParams } from "../../core/generators/townParams";
import type { TownLayout } from "../../core/generators/townParams";
import { FOREST_RANGES, readForestParams } from "../../core/generators/forestParams";
import type { TravelSetting } from "../../core/generators/travel";
import { BIOMES, EDGES } from "../../core/model";
import type { Biome, Edge, Opening, OpeningKind } from "../../core/model";
import { MAX_SEED } from "../../core/rng";
import { useStore } from "../store";
import { NumberField } from "./NumberField";
import { EncountersDialog } from "./EncountersDialog";
import { TABLES } from "../../core/encounters";
import { Icon } from "./icons";

const BIOME_LABELS: Record<Biome, string> = {
  temperate_rainforest: "Temperate rainforest",
  coastal: "Coastal",
  wetland: "Wetland",
  alpine: "Alpine",
  meadow: "Meadow",
  urban_edge: "Urban edge",
};

const LAYOUT_LABELS: Record<Layout, string> = { land: "Land", coastal: "Coastal", river: "River", water: "Open water" };

/** Forest settings: how twisty the maze is, clearings, hidden items (see generators/forest.ts). */
function ForestSettings() {
  const s = useStore();
  const map = s.currentMap!;
  const f = readForestParams(map.params);
  const p = readRouteParams(map.params);
  const set = (patch: Record<string, string | number | boolean>) => s.setParams(patch);
  return (
    <details open>
      <summary title="The maze, clearings and hidden items">Forest</summary>
      <label className="slider" title="0 = open woods with loops and short side paths; 100 = one long winding way with long dead ends.">
        <span>
          Maze density <b>{Math.round(f.mazeDensity * 100)}</b>
        </span>
        <input type="range" min={0} max={1} step={0.05} value={f.mazeDensity} onChange={(e) => set({ mazeDensity: Number(e.target.value) })} />
      </label>
      <label className="field inline" title="Open clearings where three or more paths meet. In wetland forests they hold a little pool and mud.">
        <span>Clearings</span>
        <NumberField min={FOREST_RANGES.clearings[0]} max={FOREST_RANGES.clearings[1]} value={f.clearings} onChange={(v) => set({ clearings: v })} />
      </label>
      <label className="field inline" title="Hidden items always placed, at quiet dead ends first, then in corners.">
        <span>Guaranteed hidden items</span>
        <NumberField min={FOREST_RANGES.guaranteedHidden[0]} max={FOREST_RANGES.guaranteedHidden[1]} value={f.guaranteedHidden} onChange={(v) => set({ guaranteedHidden: v })} />
      </label>
      <label className="field inline" title="How wide the paths are, in cells (1–3).">
        <span>Path width</span>
        <NumberField min={1} max={3} value={Math.min(3, p.pathWidthMin)} onChange={(v) => set({ pathWidthMin: v, pathWidthMax: Math.max(v, p.pathWidthMax) })} />
      </label>
      <p className="hint">The biome sets the look: long grass in rainforest and wetland woods (with pools in wetland clearings), tall grass in meadow woods, rock in alpine ones.</p>
    </details>
  );
}

/** Town settings: street layout, buildings, people, edge grass (see generators/townParams.ts). */
function TownSettings() {
  const s = useStore();
  const map = s.currentMap!;
  const t = readTownParams(map.params);
  const set = (patch: Record<string, string | number | boolean>) => s.setParams(patch);
  const count = (key: keyof typeof TOWN_RANGES, label: string, tip: string) => {
    const [min, max] = TOWN_RANGES[key];
    return (
      <label className="field inline" title={tip}>
        <span>{label}</span>
        <NumberField min={min} max={max} value={t[key]} onChange={(v) => set({ [key]: v })} />
      </label>
    );
  };
  const check = (key: "center" | "mart" | "gym" | "landmark", tip: string) => {
    const b = BUILDING_TYPES[key];
    return (
      <label className="check" title={tip}>
        <input type="checkbox" checked={t[key]} onChange={(e) => set({ [key]: e.target.checked })} />
        {b.label} ({b.width}×{b.height})
      </label>
    );
  };
  return (
    <details open>
      <summary title="Streets and buildings">Town</summary>
      <label className="field" title="How the streets are laid out.">
        <span>Streets</span>
        <select value={t.townLayout} onChange={(e) => set({ townLayout: e.target.value as TownLayout })}>
          {TOWN_LAYOUTS.map((l) => (
            <option key={l} value={l}>
              {TOWN_LAYOUT_LABELS[l]}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="checks" title="Buildings to place. Each gets a door on its front (south) side and a warp to its interior.">
        <legend>Buildings</legend>
        {check("center", "A Pokémon Center, near an entrance, with its heal location in front of the door.")}
        {check("mart", "A Poké Mart, near an entrance.")}
        {check("gym", "A Gym, further in, with a sign beside the door.")}
        {check("landmark", "A bigger building of note (a museum, a lab…).")}
      </fieldset>
      {count("houses", "Houses", "Small houses (4×3).")}
      {count("largeHouses", "Of which large", "How many of the houses are larger (5×4).")}
      {count("people", "People", "People wandering beside the streets.")}
      <label className="slider" title="Small patches of tall grass near the edges. They're never in the way: every exit and door can be reached without stepping in grass.">
        <span>
          Grass at the edges <b>{Math.round(t.edgeGrass * 100)}</b>
        </span>
        <input type="range" min={0} max={1} step={0.05} value={t.edgeGrass} onChange={(e) => set({ edgeGrass: Number(e.target.value) })} />
      </label>
      <p className="hint">
        {buildingList(t).length} buildings. Doors lead to MAP_…_POKEMON_CENTER_1F, _MART, _GYM, _HOUSE1…: make those interiors in Porymap. Buildings that don't fit are left out (Generate says so): make the map bigger or ask
        for fewer.
      </p>
    </details>
  );
}

const HM_LABELS: Record<string, string> = { cut: "Cut", flash: "Flash", rock_smash: "Rock Smash", strength: "Strength", surf: "Surf", dive: "Dive", waterfall: "Waterfall" };

export function GeneratePanel() {
  const s = useStore();
  const [encountersOpen, setEncountersOpen] = useState(false);
  const map = s.currentMap;
  if (!map) return null;
  const p = readRouteParams(map.params);
  const layout = resolveLayout(p, map.biome);
  /** Change layout or biome. Entrances belong to a layout, so they go back to automatic when it changes. */
  const changeLayout = (setting: LayoutSetting, biome: Biome) => {
    const next = resolveLayout({ ...p, layout: setting }, biome);
    if (setting !== p.layout) set({ layout: setting });
    if (biome !== map.biome) s.setBiome(biome);
    if (next !== layout && map.openings.length) s.setOpenings([]);
  };
  const set = (patch: Partial<Record<keyof RouteParams, string | number | boolean>>) => s.setParams(patch as Record<string, string | number | boolean>);
  /** Change the travel direction. Entrances go back to automatic if the route now runs the other way. */
  const changeTravel = (setting: TravelSetting) => {
    const next = travelOf(setting);
    set({ travel: setting });
    if (next && map.openings.length && !map.openings.some((o) => o.edge === next.from || o.edge === next.to)) s.setOpenings([]);
  };
  const travel = travelOf(p.travel);
  const walkEdges = new Set(map.openings.map((o) => o.edge));
  const travelHint = !travel
    ? null
    : map.openings.length && (!walkEdges.has(travel.from) || !walkEdges.has(travel.to))
      ? `There's no entrance on the ${!walkEdges.has(travel.from) ? travel.from : travel.to} edge, so the direction is ignored. Add one under Entrances, or remove all entrances to have them placed automatically.`
      : travel.from === "north"
        ? "Gen 3 has no ledges you can jump north, so going north to south the ledges jump forward instead: fewer ledge rows, and the ledge pocket is a reward on the way forward."
        : !map.openings.length && travelVertical(travel) !== map.height >= map.width
          ? `The route will run ${travelVertical(travel) ? "north–south, across the map's short side" : "west–east, across the map's short side"}.`
          : null;
  const supported = canGenerate(map);
  const town = map.mapType === "town";
  const forest = map.mapType === "forest";
  const route = map.mapType === "route";
  const last = s.lastGenerate?.mapId === map.id ? s.lastGenerate : null;
  const errors = s.issues.filter((i) => i.severity === "error").length;
  const warnings = s.issues.length - errors;

  const num = (key: keyof RouteParams, label: string, tip: string) => {
    const [min, max, whole] = PARAM_RANGES[key];
    const value = p[key] as number;
    if (!whole)
      return (
        <label className="slider" title={tip}>
          <span>
            {label} <b>{Math.round(value * 100)}</b>
          </span>
          <input type="range" min={min} max={max} step={0.05} value={value} onChange={(e) => set({ [key]: Number(e.target.value) })} />
        </label>
      );
    return (
      <label className="field inline" title={tip}>
        <span>{label}</span>
        <NumberField min={min} max={max} value={value} onChange={(v) => set({ [key]: v })} />
      </label>
    );
  };

  const toggleList = (key: "hmPocketTypes" | "availableHms", value: string, on: boolean) => {
    const list = new Set<string>(p[key]);
    if (on) list.add(value);
    else list.delete(value);
    const order: readonly string[] = key === "availableHms" ? HMS : POCKET_HMS;
    set({ [key]: order.filter((h) => list.has(h)).join(",") });
  };

  const setOpening = (k: number, patch: Partial<Opening>) => s.setOpenings(map.openings.map((o, i) => (i === k ? { ...o, ...patch } : o)));
  const edgeLength = (edge: Edge) => (edge === "north" || edge === "south" ? map.width : map.height);

  return (
    <div className="generate-panel">
      <div className="generate-top">
        <button className="primary wide big" disabled={!supported || s.generating} onClick={() => void s.generate()} title="Generate this map from its seed and settings. By default, locked cells and things you placed are kept (see Generate changes, below). You can undo it.">
          {s.generating ? "Generating…" : "Generate"}
        </button>
        {!supported && <p className="hint">Routes, towns and forests can be generated so far. Caves arrive in the next parts of Milestone 5.</p>}
        {last?.notes?.map((n) => (
          <p key={n} className="hint">
            {n}
          </p>
        ))}
        <label className="field" title="What Generate changes. Locked cells are the ones you painted, moved or locked with the lock brush (yellow corner).">
          <span>Generate changes</span>
          <select value={s.generateMode} onChange={(e) => s.setGenerateMode(e.target.value as "keep" | "whole")}>
            <option value="keep">Everything except locked cells and placed things</option>
            <option value="whole">The whole map (clears every lock)</option>
          </select>
        </label>
        <button
          className="secondary wide"
          title="Make only the selected area again (Select tool, V). Everything outside it stays exactly as it is; each try looks different."
          disabled={!supported || s.generating || !s.selection}
          onClick={() => s.regenerateSelection()}
        >
          Regenerate selected area
        </button>
        {!s.selection && <p className="hint">To regenerate just part of the map, select it first with the Select tool (V).</p>}
        <div className="field-row">
          <label className="field grow" title={s.seedPinned ? "The seed is pinned: unpin it to change it." : "The seed decides every random choice. Same seed + same settings = the same map."}>
            <span>Seed</span>
            <NumberField min={0} max={MAX_SEED} value={map.seed} disabled={s.seedPinned} onChange={(v) => s.setSeed(v)} />
          </label>
          <button
            className={`icon-button pin ${s.seedPinned ? "active" : ""}`}
            title={s.seedPinned ? "Unpin the seed" : "Pin the seed, so New seed and Variations can't change it by accident"}
            aria-label={s.seedPinned ? "Unpin the seed" : "Pin the seed"}
            aria-pressed={s.seedPinned}
            onClick={() => s.togglePinSeed()}
          >
            <Icon name={s.seedPinned ? "lock" : "unlock"} size={18} />
          </button>
          <button className="secondary" title="Pick a new random seed and generate" disabled={!supported || s.generating || s.seedPinned} onClick={() => void s.rerollSeed()}>
            New seed
          </button>
        </div>
        <button
          className="secondary wide"
          title="Generate this map with 6 new seeds side by side, and pick the one you like. Your locked cells, placed things and zones are kept in all of them."
          disabled={!supported || s.generating || s.variationsBusy || s.seedPinned}
          onClick={() => void s.makeVariations()}
        >
          {s.variationsBusy ? "Making variations…" : "Variations: compare 6 seeds"}
        </button>
        {s.recentSeeds.length > 1 && (
          <div className="recent-seeds" title="Seeds you generated this session. Tap one to go back to it.">
            <span className="hint">Recent:</span>
            {s.recentSeeds.map((seed) => (
              <button
                key={seed}
                className={`chip ${seed === map.seed ? "active" : ""}`}
                disabled={s.generating || s.seedPinned || seed === map.seed}
                onClick={() => {
                  s.setSeed(seed);
                  void s.generate();
                }}
              >
                {seed}
              </button>
            ))}
          </div>
        )}
        {last && (
          <p className={`hint ${last.ok ? "" : "bad"}`}>
            {last.ok ? "Generated" : "Generated, but some checks failed"}
            {last.attempts > 1 ? ` (took ${last.attempts} tries)` : ""}. Now: {errors} error{errors === 1 ? "" : "s"}, {warnings} warning{warnings === 1 ? "" : "s"} (see Check).
          </p>
        )}
      </div>

      {town && <TownSettings />}
      {forest && <ForestSettings />}

      <details open={route}>
        <summary title={route ? "Biome, path shape" : "Biome"}>Basic</summary>
        <label className="field" title="The look of the map: changes the mix of trees, grass, water and ground.">
          <span>Biome</span>
          <select value={map.biome} onChange={(e) => changeLayout(p.layout, e.target.value as Biome)}>
            {BIOMES.map((b) => (
              <option key={b} value={b}>
                {BIOME_LABELS[b]}
              </option>
            ))}
          </select>
        </label>
        {route && (
          <>
            <label className="field" title="The overall shape of the route. Auto = Coastal for the coastal biome, Land otherwise.">
              <span>Layout</span>
              <select value={p.layout} onChange={(e) => changeLayout(e.target.value as LayoutSetting, map.biome)}>
                <option value="auto">Auto ({LAYOUT_LABELS[layout]})</option>
                <option value="land">Land</option>
                <option value="coastal">Coastal: sea along one side</option>
                <option value="river">River: a river along the route</option>
                <option value="water">Open water: sea or lake, surfing</option>
              </select>
            </label>
            {layout === "water" && <p className="hint">Open-water routes are crossed by surfing, so the checks assume the player has Surf.</p>}
            <label
              className="field"
              title="Which way the player first walks this route. Ledges then jump back toward the start (the winding path is the way forward), trainers face the player coming from the start, the hills rise toward the end, the sign stands at the start, and a ledge pocket holds an item you reach on the way back."
            >
              <span>Travel direction</span>
              <select value={p.travel} onChange={(e) => changeTravel(e.target.value as TravelSetting)}>
                {TRAVEL_SETTINGS.map((t) => (
                  <option key={t} value={t}>
                    {TRAVEL_LABELS[t]}
                  </option>
                ))}
              </select>
            </label>
            {travelHint && <p className="hint">{travelHint}</p>}
            {num("elevation", "Elevation", "How hilly the route is. Hillsides rise along the sides of the route, with cliffs, stairs up and ledges down: higher values give more of them and more levels (up to 3, or 4 on alpine routes). Also adds ledge rows. 0 = flat.")}
            {num("snow", "Snow", "How much of the route is under snow, highest ground first. 0 = none, 100 = snowed in. Grass becomes snowy grass, ponds freeze into slippery ice, some trees become snowdrifts.")}
            {num("winding", "Path winding", "0 = straight, 100 = wanders a lot.")}
            {num("pathWidthMin", "Narrowest path", "Narrowest the main path gets, in cells.")}
            {num("pathWidthMax", "Widest path", "Widest the main path gets, in cells.")}
          </>
        )}
      </details>

      <details>
        <summary title="Where the player enters and leaves the map">Entrances ({map.openings.length || "auto"})</summary>
        {map.openings.length === 0 && <p className="hint">Picked automatically on the first Generate (at each short end, plus surf entrances on the water for coastal and river layouts). You can then move them here.</p>}
        {map.openings.some((o) => o.kind === "surf") && !p.availableHms.includes("surf") && layout !== "water" && (
          <p className="hint">Surf entrances aren't checked until Surf is ticked under Gameplay → Player has.</p>
        )}
        {map.openings.map((o, k) => (
          <div key={o.id} className="opening-row">
            <select value={o.kind} title="Walk = on land. Surf = on water, needs Surf." onChange={(e) => setOpening(k, { kind: e.target.value as OpeningKind })}>
              <option value="walk">Walk</option>
              <option value="surf">Surf</option>
            </select>
            <select value={o.edge} title="Which edge of the map" onChange={(e) => setOpening(k, { edge: e.target.value as Edge, start: Math.min(o.start, Math.max(0, edgeLength(e.target.value as Edge) - o.width)) })}>
              {EDGES.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
            <label title={`First cell along the edge (${o.edge === "north" || o.edge === "south" ? "x" : "y"})`}>
              at
              <NumberField min={0} max={edgeLength(o.edge) - o.width} value={o.start} onChange={(v) => setOpening(k, { start: v })} />
            </label>
            <label title="How many cells wide">
              wide
              <NumberField min={1} max={Math.min(8, edgeLength(o.edge) - o.start)} value={o.width} onChange={(v) => setOpening(k, { width: v })} />
            </label>
            <button className="icon-button" title="Remove this entrance" aria-label="Remove entrance" onClick={() => s.setOpenings(map.openings.filter((_, i) => i !== k))}>
              ✕
            </button>
          </div>
        ))}
        <div className="field-row">
          <button
            className="secondary"
            title="Add another entrance"
            onClick={() => {
              const used = new Set(map.openings.map((o) => o.id));
              let n = map.openings.length + 1;
              while (used.has(`o${n}`)) n++;
              s.setOpenings([...map.openings, { id: `o${n}`, edge: "east", start: Math.max(0, Math.floor(map.height / 2) - 1), width: 3, kind: "walk" }]);
            }}
          >
            Add entrance
          </button>
          {map.openings.length > 0 && (
            <button className="secondary" title="Forget these entrances and let Generate pick them" onClick={() => s.setOpenings([])}>
              Automatic
            </button>
          )}
        </div>
      </details>

      <details>
        <summary title="Grass, water, trees, border">Terrain</summary>
        {!town && num("grass", "Grass", forest ? "How much long grass grows along the paths (wild encounters)." : "Share of open ground that becomes grass (wild encounters).")}
        {route && num("water", "Water", "Ponds and streams.")}
        {!forest && num("treeDensity", "Tree cover", town ? "How many trees dot the town." : "How much of the map is trees rather than open ground.")}
        {num("borderThickness", "Border thickness", "Cells of wall around the map edge.")}
        <label className="field" title="What the wall around the map is made of. Auto = cliffs on alpine routes, dense forest otherwise.">
          <span>Border style</span>
          <select value={p.borderStyle} onChange={(e) => set({ borderStyle: e.target.value })}>
            <option value="auto">Auto ({resolveBorder(p, map.biome) === "cliff" ? "cliffs" : "dense forest"})</option>
            <option value="forest">Dense forest</option>
            <option value="cliff">Cliffs</option>
          </select>
        </label>
        {route && (
          <>
            <label className="field" title="A stream crossing the route, with a bridge where it meets the path.">
              <span>Stream</span>
              <select value={p.stream} onChange={(e) => set({ stream: e.target.value })}>
                <option value="auto">Sometimes</option>
                <option value="yes">Always</option>
                <option value="no">Never</option>
              </select>
            </label>
            {(layout === "coastal" || layout === "river") && (
              <label className="check" title="Add entrances on the water at each end, which need Surf. Applies when entrances are picked automatically.">
                <input type="checkbox" checked={p.surfEntrances} onChange={(e) => set({ surfEntrances: e.target.checked })} />
                Surf entrances on the water
              </label>
          )}
          <label className="check" title="An open clearing beside the path.">
            <input type="checkbox" checked={p.clearing} onChange={(e) => set({ clearing: e.target.checked })} />
            Clearing
          </label>
          </>
        )}
      </details>

      {route && (
        <details>
          <summary title="Branches, ledges, HM-gated areas">Structure</summary>
          <label className="check" title="A shorter second way through that's mostly tall grass. Taking the path means trainer battles; taking the grass means wild Pokémon.">
            <input type="checkbox" checked={p.grassShortcut} onChange={(e) => set({ grassShortcut: e.target.checked })} />
            Grass shortcut (two ways through)
          </label>
          {num("pathGrass", "Grass across the path", "Stretches of grass on the main path itself, so the path still has some wild encounters.")}
          {num("branches", "Side branches", "Dead-end paths off the main route.")}
          {num("branchLength", "Branch length", "How far side branches reach.")}
          <label className="check" title="Put an item at the end of every dead end.">
            <input type="checkbox" checked={p.deadEndRewards} onChange={(e) => set({ deadEndRewards: e.target.checked })} />
            Items at dead ends
          </label>
          {num("ledges", "Ledge rows", "Ledges across the route on flat ground. Going one way, the path winds round the end of the ledge; coming back, you jump down as a shortcut. Elevation adds more.")}
          {num("hmPockets", "HM-gated areas", "Small optional areas with an item, sealed behind an HM.")}
          <fieldset className="checks" title="Which HMs can seal those areas.">
            <legend>Sealed by</legend>
            {POCKET_HMS.map((h) => (
              <label key={h} className="check">
                <input type="checkbox" checked={p.hmPocketTypes.includes(h)} onChange={(e) => toggleList("hmPocketTypes", h, e.target.checked)} />
                {HM_LABELS[h]}
              </label>
            ))}
          </fieldset>
        </details>
      )}

      <details>
        <summary title="Trainers, items, HMs the player has">Gameplay</summary>
        {!town && num("trainers", "Trainers", "How many trainers to place. Each faces the path and can be walked around.")}
        {!town && num("trainerSpacing", "Trainer spacing", "Minimum distance between trainers, in cells.")}
        {!town && num("items", "Extra items", forest ? "Item balls at the deepest dead ends (two more than this number)." : "Item balls besides the ones at dead ends and in HM areas.")}
        {num("hiddenItems", "Hidden items", "Hidden items in corners. Quiet dead ends also get one automatically.")}
        {num("levelMin", "Lowest wild level", "The lowest level of wild Pokémon here, for the encounter draft.")}
        {num("levelMax", "Highest wild level", "The highest level of wild Pokémon here, for the encounter draft.")}
        <button className="secondary wide" title="The species list for the region, and this map's draft wild encounter tables" onClick={() => setEncountersOpen(true)}>
          Encounters{map.encounterPlan ? `: ${TABLES.filter((k) => map.encounterPlan?.[k]).length} table${TABLES.filter((k) => map.encounterPlan?.[k]).length === 1 ? "" : "s"}` : ""}
          {map.encounterPlan?.locked ? " (kept)" : ""}…
        </button>
        {encountersOpen && <EncountersDialog onClose={() => setEncountersOpen(false)} />}
        <fieldset className="checks" title="HMs the player has when they reach this map. Validation uses these to check every entrance can be reached.">
          <legend>Player has</legend>
          {HMS.map((h: Hm) => (
            <label key={h} className="check">
              <input type="checkbox" checked={p.availableHms.includes(h)} onChange={(e) => toggleList("availableHms", h, e.target.checked)} />
              {HM_LABELS[h]}
            </label>
          ))}
        </fieldset>
      </details>

      <details>
        <summary title="Retries and resetting settings">Advanced</summary>
        {num("retries", "Retries", "If a map fails a check, try again with a related seed up to this many times.")}
        <button
          className="secondary"
          title="Put every setting back to its default (the seed and entrances are kept)"
          onClick={() => s.setParams(writeRouteParams(DEFAULT_ROUTE_PARAMS))}
        >
          Reset settings
        </button>
      </details>
    </div>
  );
}
