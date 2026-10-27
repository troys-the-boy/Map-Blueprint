// "New map" dialog: name, type, size (with the live size budget), biome and seed.

import { useState } from "react";
import { BIOMES, MAP_TYPES } from "../../core/model";
import type { Biome, MapType } from "../../core/model";
import { MAX_SEED } from "../../core/rng";
import { SIZE_PRESETS, checkMapSize, describeSizeCheck } from "../../core/sizeRule";
import { useStore } from "../store";

const TYPE_LABELS: Record<MapType, string> = {
  route: "Route",
  town: "Town",
  forest: "Forest",
  cave: "Cave floor",
  interior_stub: "Interior (stub)",
};

const BIOME_LABELS: Record<Biome, string> = {
  temperate_rainforest: "Temperate rainforest",
  coastal: "Coastal",
  wetland: "Wetland",
  alpine: "Alpine",
  meadow: "Meadow",
  urban_edge: "Urban edge",
};

function randomSeed() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0];
}

export function NewMapDialog({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const [name, setName] = useState(`Map ${s.region.maps.length + 1}`);
  const [mapType, setMapType] = useState<MapType>("route");
  const [width, setWidth] = useState(20);
  const [height, setHeight] = useState(40);
  const [biome, setBiome] = useState<Biome>(s.region.settings.defaultBiome);
  const [seed, setSeed] = useState(randomSeed);

  const size = checkMapSize(width, height, s.region.settings.engineLimits);
  const usedPct = Math.min(100, (size.used / size.limit) * 100);
  const valid = size.ok && name.trim().length > 0 && Number.isInteger(width) && Number.isInteger(height);

  const choosePreset = (label: string) => {
    const p = SIZE_PRESETS[mapType].find((x) => x.label === label);
    if (p) {
      setWidth(p.width);
      setHeight(p.height);
    }
  };

  const create = () => {
    if (!valid) return;
    s.createMap({ name: name.trim(), mapType, width, height, seed, biome });
    onClose();
  };

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="newmap-title">
        <h2 id="newmap-title">New map</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            create();
          }}
        >
          <label className="field" title="The map's display name. Used to suggest the MAP_* constant.">
            <span>Name</span>
            <input value={name} maxLength={100} onChange={(e) => setName(e.target.value)} autoFocus />
          </label>
          <label className="field" title="What kind of map this is. Generators for each type arrive in later milestones.">
            <span>Type</span>
            <select
              value={mapType}
              onChange={(e) => {
                const t = e.target.value as MapType;
                setMapType(t);
                const p = SIZE_PRESETS[t][0];
                setWidth(p.width);
                setHeight(p.height);
              }}
            >
              {MAP_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </label>
          <label className="field" title="Common sizes for this map type. Pick one, or type an exact size below.">
            <span>Size preset</span>
            <select value={SIZE_PRESETS[mapType].find((p) => p.width === width && p.height === height)?.label ?? ""} onChange={(e) => choosePreset(e.target.value)}>
              <option value="">Custom</option>
              {SIZE_PRESETS[mapType].map((p) => (
                <option key={p.label} value={p.label}>
                  {p.label}: {p.width}×{p.height}
                </option>
              ))}
            </select>
          </label>
          <div className="field-row">
            <label className="field" title="Width in metatiles (16×16 px cells).">
              <span>Width</span>
              <input type="number" inputMode="numeric" min={1} max={512} value={width} onChange={(e) => setWidth(Math.floor(Number(e.target.value) || 0))} />
            </label>
            <span className="times">×</span>
            <label className="field" title="Height in metatiles (16×16 px cells).">
              <span>Height</span>
              <input type="number" inputMode="numeric" min={1} max={512} value={height} onChange={(e) => setHeight(Math.floor(Number(e.target.value) || 0))} />
            </label>
          </div>
          <div className={`budget ${size.ok ? "" : "over"}`} title="pokeemerald needs (width + 15) × (height + 14) to be at most 10,240 for a map to load.">
            <div className="budget-bar">
              <div style={{ width: `${usedPct}%` }} />
            </div>
            <p>{describeSizeCheck(size)}</p>
            <p className="hint">
              At width {width}, the tallest allowed map is {size.maxHeightForWidth}.
            </p>
          </div>
          <label className="field" title="The default biome for this map. Later you can split a map into several biome zones.">
            <span>Biome</span>
            <select value={biome} onChange={(e) => setBiome(e.target.value as Biome)}>
              {BIOMES.map((b) => (
                <option key={b} value={b}>
                  {BIOME_LABELS[b]}
                </option>
              ))}
            </select>
          </label>
          <div className="field-row">
            <label className="field grow" title="The seed decides every random choice. The same seed always gives the same map.">
              <span>Seed</span>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={MAX_SEED}
                value={seed}
                onChange={(e) => setSeed(Math.max(0, Math.min(MAX_SEED, Math.floor(Number(e.target.value) || 0))))}
              />
            </label>
            <button type="button" className="secondary" title="Pick a new random seed" onClick={() => setSeed(randomSeed())}>
              Reroll
            </button>
          </div>
          <div className="modal-actions">
            <button type="button" className="secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primary" disabled={!valid} title={valid ? "Create the map" : "Fix the size or name first"}>
              Create map
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
