// The Generate panel: seed, settings in collapsible groups, and the button.
// Every setting has a default, so Generate works without touching anything.

import { HMS } from "../../core/constants";
import type { Hm } from "../../core/constants";
import { canGenerate } from "../../core/generate";
import { DEFAULT_ROUTE_PARAMS, PARAM_RANGES, POCKET_HMS, readRouteParams, writeRouteParams } from "../../core/generators/params";
import type { RouteParams } from "../../core/generators/params";
import { BIOMES, EDGES } from "../../core/model";
import type { Biome, Edge, Opening } from "../../core/model";
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
            {label} <b>{Math.round(value * 100)}%</b>
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
        <button className="primary wide big" disabled={!supported || s.generating} onClick={() => void s.generate()} title="Generate this map from its seed and settings. Cells you painted (locked) are kept. You can undo it.">
          {s.generating ? "Generating…" : "Generate"}
        </button>
        {!supported && <p className="hint">Only routes can be generated so far. Towns, forests and caves arrive in Milestone 5.</p>}
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
          <select value={map.biome} onChange={(e) => s.setBiome(e.target.value as Biome)}>
            {BIOMES.map((b) => (
              <option key={b} value={b}>
                {BIOME_LABELS[b]}
              </option>
            ))}
          </select>
        </label>
        {num("winding", "Path winding", "0% = straight, 100% = wanders a lot.")}
        {num("pathWidthMin", "Narrowest path", "Narrowest the main path gets, in cells.")}
        {num("pathWidthMax", "Widest path", "Widest the main path gets, in cells.")}
      </details>

      <details>
        <summary title="Where the player enters and leaves the map">Entrances ({map.openings.length || "auto"})</summary>
        {map.openings.length === 0 && <p className="hint">Picked automatically on the first Generate (one at each short end). You can then move them here.</p>}
        {map.openings.map((o, k) => (
          <div key={o.id} className="opening-row">
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
              s.setOpenings([...map.openings, { id: `o${n}`, edge: "east", start: Math.max(0, Math.floor(map.height / 2) - 1), width: 3 }]);
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
        <label className="field" title="What the wall around the map is made of.">
          <span>Border style</span>
          <select value={p.borderStyle} onChange={(e) => set({ borderStyle: e.target.value })}>
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
        <label className="check" title="An open clearing beside the path.">
          <input type="checkbox" checked={p.clearing} onChange={(e) => set({ clearing: e.target.checked })} />
          Clearing
        </label>
      </details>

      <details>
        <summary title="Branches, ledges, HM-gated areas">Structure</summary>
        {num("branches", "Side branches", "Dead-end paths off the main route.")}
        {num("branchLength", "Branch length", "How far side branches reach.")}
        <label className="check" title="Put an item at the end of every dead end.">
          <input type="checkbox" checked={p.deadEndRewards} onChange={(e) => set({ deadEndRewards: e.target.checked })} />
          Items at dead ends
        </label>
        {num("ledges", "Ledge shortcuts", "One-way loops: jump a ledge to rejoin the main path further on.")}
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
