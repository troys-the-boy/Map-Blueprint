// Terrain picker and overlay toggles (right-hand panel).

import { useStore } from "../store";
import { TERRAIN_TYPES, getPalette } from "../../core/terrain";
import type { Overlays } from "../prefs";
import { Icon } from "./icons";

const CATEGORY_LABELS: Record<string, string> = {
  ground: "Ground",
  grass: "Grass & flowers",
  blocking: "Trees & walls",
  ledge: "Ledges (one-way)",
  water: "Water",
  structure: "Structures",
  other: "Other",
};

const PASSABILITY_TEXT: Record<string, string> = {
  walk: "walkable",
  blocked: "blocks movement",
  one_way: "one-way",
  surf: "needs Surf",
  hm: "needs an HM",
  warp: "warp",
};

const OVERLAYS: Array<{ key: keyof Overlays; label: string; tip: string }> = [
  { key: "grid", label: "Grid", tip: "Cell grid. Lighter lines every 5 cells, brighter every 10." },
  { key: "rulers", label: "Rulers", tip: "Coordinate rulers along the top and left edges." },
  { key: "screenFrame", label: "Screen frame", tip: "The 15×10 area one GBA screen shows, around the cell under the pointer." },
  { key: "locks", label: "Locked cells", tip: "Mark cells you painted. Generators (from Milestone 2) never change locked cells." },
];

export function TerrainPanel({ onClose }: { onClose?: () => void }) {
  const s = useStore();
  const palette = getPalette(s.prefs.paletteId);
  const categories = [...new Set(TERRAIN_TYPES.map((t) => t.category))];

  return (
    <aside className="side-panel" aria-label="Terrain and overlays">
      <div className="panel-head">
        <h2>Terrain</h2>
        {onClose && (
          <button className="icon-button" aria-label="Close terrain panel" title="Close" onClick={onClose}>
            <Icon name="close" />
          </button>
        )}
      </div>
      {categories.map((cat) => (
        <section key={cat} className="terrain-group">
          <h3>{CATEGORY_LABELS[cat] ?? cat}</h3>
          <div className="terrain-grid">
            {TERRAIN_TYPES.map((t, i) =>
              t.category !== cat ? null : (
                <button
                  key={t.id}
                  className={`terrain-item ${s.terrain === i ? "active" : ""}`}
                  title={`${t.label} (${PASSABILITY_TEXT[t.passability]}). ${t.note}`}
                  aria-pressed={s.terrain === i}
                  onClick={() => {
                    s.setTerrain(i);
                    onClose?.();
                  }}
                >
                  <span className="swatch" style={{ background: palette.colors[t.id] }}>
                    {t.glyph ?? ""}
                  </span>
                  <span className="terrain-label">{t.label}</span>
                </button>
              ),
            )}
          </div>
        </section>
      ))}
      <section className="overlay-group">
        <h3>Show</h3>
        {OVERLAYS.map((o) => (
          <label key={o.key} className="check" title={o.tip}>
            <input type="checkbox" checked={s.prefs.overlays[o.key]} onChange={(e) => s.setOverlay(o.key, e.target.checked)} />
            {o.label}
          </label>
        ))}
        <label className="check" title="When on, every cell you paint is locked, so generators (from Milestone 2) build around it.">
          <input type="checkbox" checked={s.prefs.lockWhenPainting} onChange={(e) => s.updatePrefs({ lockWhenPainting: e.target.checked })} />
          Lock what I paint
        </label>
      </section>
    </aside>
  );
}
