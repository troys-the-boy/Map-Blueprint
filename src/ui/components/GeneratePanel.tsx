// The Generate panel: seed, settings in collapsible groups, and the button.
// Every setting has a default, so Generate works without touching anything.

import { HMS } from "../../core/constants";
import type { Hm } from "../../core/constants";
import { canGenerate } from "../../core/generate";
import { DEFAULT_ROUTE_PARAMS, PARAM_RANGES, POCKET_HMS, readRouteParams, resolveBorder, resolveLayout, writeRouteParams } from "../../core/generators/params";
import type { Layout, LayoutSetting } from "../../core/generators/params";
import type { RouteParams } from "../../core/generators/params";
import { BIOMES, EDGES } from "../../core/model";
import type { Biome, Edge, Opening, OpeningKind } from "../../core/model";
import { MAX_SEED } from "../../core/rng";
import { useStore } from "../store";
import { NumberField } from "./NumberField";

const BIOME_LABELS: Record<Biome, string> = {
  temperate_rainforest: "Temperate rainforest",
  coastal: "Coastal",
  wetland: "Wetland",
  alpine: "Alpine",
  meadow: "Meadow",
  urban_edge: "Urban edge",
};

const LAYOUT_LABELS: Record<Layout, string> = { land: "Land", coastal: "Coastal", river: "River", water: "Open water" };

const HM_LABELS: Record<string, string> = { cut: "Cut", flash: "Flash", rock_smash: "Rock Smash", strength: "Strength", surf: "Surf", dive: "Dive", waterfall: "Waterfall" };

function randomSeed() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0];
}

export function GeneratePanel() {
  const s = useStore();
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
  const supported = canGenerate(map);
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
        {!supported && <p className="hint">Only routes can be generated so far. Towns, forests and caves arrive in Milestone 5.</p>}
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
          <label className="field grow" title="The seed decides every random choice. Same seed + same settings = the same map.">
            <span>Seed</span>
            <NumberField min={0} max={MAX_SEED} value={map.seed} onChange={(v) => s.setSeed(v)} />
          </label>
          <button
            className="secondary"
            title="Pick a new random seed and generate"
            disabled={!supported || s.generating}
            onClick={() => {
              s.setSeed(randomSeed());
              void s.generate();
            }}
          >
            New seed
          </button>
        </div>
        {last && (
          <p className={`hint ${last.ok ? "" : "bad"}`}>
            {last.ok ? "Generated" : "Generated, but some checks failed"}
            {last.attempts > 1 ? ` (took ${last.attempts} tries)` : ""}. Now: {errors} error{errors === 1 ? "" : "s"}, {warnings} warning{warnings === 1 ? "" : "s"} (see Check).
          </p>
        )}
      </div>

      <details open>
        <summary title="Biome, path shape">Basic</summary>
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
        {num("elevation", "Elevation", "How hilly the route is. Hillsides rise along the sides of the route, with cliffs, stairs up and ledges down: higher values give more of them and more levels (up to 3, or 4 on alpine routes). Also adds ledge rows. 0 = flat.")}
        {num("snow", "Snow", "How much of the route is under snow, highest ground first. 0 = none, 100 = snowed in. Grass becomes snowy grass, ponds freeze into slippery ice, some trees become snowdrifts.")}
        {num("winding", "Path winding", "0 = straight, 100 = wanders a lot.")}
        {num("pathWidthMin", "Narrowest path", "Narrowest the main path gets, in cells.")}
        {num("pathWidthMax", "Widest path", "Widest the main path gets, in cells.")}
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
        {num("grass", "Grass", "Share of open ground that becomes grass (wild encounters).")}
        {num("water", "Water", "Ponds and streams.")}
        {num("treeDensity", "Tree cover", "How much of the map is trees rather than open ground.")}
        {num("borderThickness", "Border thickness", "Cells of wall around the map edge.")}
        <label className="field" title="What the wall around the map is made of. Auto = cliffs on alpine routes, dense forest otherwise.">
          <span>Border style</span>
          <select value={p.borderStyle} onChange={(e) => set({ borderStyle: e.target.value })}>
            <option value="auto">Auto ({resolveBorder(p, map.biome) === "cliff" ? "cliffs" : "dense forest"})</option>
            <option value="forest">Dense forest</option>
            <option value="cliff">Cliffs</option>
          </select>
        </label>
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
      </details>

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

      <details>
        <summary title="Trainers, items, HMs the player has">Gameplay</summary>
        {num("trainers", "Trainers", "How many trainers to place. Each faces the path and can be walked around.")}
        {num("trainerSpacing", "Trainer spacing", "Minimum distance between trainers, in cells.")}
        {num("items", "Extra items", "Item balls besides the ones at dead ends and in HM areas.")}
        {num("hiddenItems", "Hidden items", "Hidden items in corners. Quiet dead ends also get one automatically.")}
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
