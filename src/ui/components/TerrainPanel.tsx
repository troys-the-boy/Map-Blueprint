// The Paint tab: terrain picker, elevation brush, legend for things on the map,
// and overlay toggles (right-hand panel).

import { useStore } from "../store";
import { ELEVATION_LEVELS, TERRAIN_TYPES, getPalette } from "../../core/terrain";
import { ELEVATION_VALUES, LEVEL_VALUE, PORYMAP_ELEVATION_COLORS, hexDigit } from "../../core/porymap";
import { ENTITY_PREFIX } from "../../core/entities";
import { ENTITY_COLORS } from "../../core/exporters/blueprint";
import type { EntityKind } from "../../core/model";
import type { Overlays } from "../prefs";
import { HEAT_COLORS } from "../renderer";

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

/** Plain names for the elevation levels, shown beside their Porymap numbers. */
const LEVEL_LABELS: Record<string, string> = {
  water: "Water (Surf)",
  ground: "Ground",
  raised1: "Raised",
  raised2: "Raised ×2",
  raised3: "Raised ×3",
  raised4: "Raised ×4",
  bridge: "Bridge",
};

/** Things on the map and what their markers mean. Painting them comes in Milestone 3. */
const LEGEND: Array<{ kind: EntityKind | "warp"; label: string }> = [
  { kind: "trainer", label: "Trainer" },
  { kind: "npc", label: "Person (NPC)" },
  { kind: "item_ball", label: "Item ball" },
  { kind: "hidden_item", label: "Hidden item" },
  { kind: "cut_tree", label: "Cut tree (needs Cut)" },
  { kind: "smash_rock", label: "Rock (needs Rock Smash)" },
  { kind: "strength_boulder", label: "Boulder (needs Strength)" },
  { kind: "sign", label: "Sign" },
  { kind: "berry_tree", label: "Berry tree" },
  { kind: "trigger", label: "Trigger (script tile)" },
  { kind: "secret_base", label: "Secret base" },
  { kind: "heal_location", label: "Heal location" },
  { kind: "warp", label: "Warp (door, cave)" },
];

const OVERLAYS: Array<{ key: keyof Overlays; label: string; tip: string }> = [
  { key: "grid", label: "Grid", tip: "Cell grid. Lighter lines every 5 cells, brighter every 10." },
  { key: "rulers", label: "Rulers", tip: "Coordinate rulers along the top and left edges." },
  { key: "screenFrame", label: "Screen frame", tip: "The 15×10 area one GBA screen shows, around the cell under the pointer." },
  { key: "locks", label: "Locked cells", tip: "Mark cells you painted. Generate never changes locked cells." },
  { key: "sight", label: "Trainer sight lines", tip: "The cells each trainer can see, up to the first tree or wall." },
  { key: "issues", label: "Problems", tip: "Outline cells with errors (red) and warnings (amber) from the Check tab." },
  { key: "reach", label: "Reachability (HMs needed)", tip: "Colour each cell by which HM you need to reach it from an entrance. Red = can't be reached at all." },
  {
    key: "elevation",
    label: "Elevation (as in Porymap)",
    tip: "Show each cell's elevation number the way Porymap's collision tab does: same colours, white number = walkable, red = blocked.",
  },
];

const HEAT_KEY: Array<[number, string]> = [
  [1, "Cut"],
  [2, "Rock Smash"],
  [4, "Surf"],
  [5, "Waterfall"],
  [7, "Several HMs"],
  [-1, "Can't reach"],
];

export function TerrainPanel({ onPicked }: { onPicked?: () => void }) {
  const s = useStore();
  const palette = getPalette(s.prefs.paletteId);
  const categories = [...new Set(TERRAIN_TYPES.map((t) => t.category))];

  return (
    <div aria-label="Terrain, elevation and overlays">
      {categories.map((cat) => (
        <section key={cat} className="terrain-group">
          <h3>{CATEGORY_LABELS[cat] ?? cat}</h3>
          <div className="terrain-grid">
            {TERRAIN_TYPES.map((t, i) =>
              t.category !== cat ? null : (
                <button
                  key={t.id}
                  className={`terrain-item ${s.tool !== "elevation" && s.terrain === i ? "active" : ""}`}
                  title={`${t.label} (${PASSABILITY_TEXT[t.passability]}). ${t.note}`}
                  aria-pressed={s.tool !== "elevation" && s.terrain === i}
                  onClick={() => {
                    s.setTerrain(i);
                    onPicked?.();
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

      <section className="terrain-group">
        <h3>Elevation brush</h3>
        <p className="hint">
          Paints the elevation number you'll set in Porymap's collision tab, without changing the terrain. Stairs always show{" "}
          {hexDigit(ELEVATION_VALUES.transition)} (Porymap's "transition"): paint them with the Stairs terrain.
        </p>
        <div className="terrain-grid">
          {ELEVATION_LEVELS.map((level, i) => {
            const v = LEVEL_VALUE[i];
            const active = s.tool === "elevation" && s.elevationLevel === i;
            return (
              <button
                key={level}
                className={`terrain-item ${active ? "active" : ""}`}
                title={`Elevation ${hexDigit(v)}: ${LEVEL_LABELS[level]}`}
                aria-pressed={active}
                onClick={() => {
                  s.setElevationLevel(i);
                  onPicked?.();
                }}
              >
                <span className="swatch elevation-swatch" style={{ background: PORYMAP_ELEVATION_COLORS[v] }}>
                  {hexDigit(v)}
                </span>
                <span className="terrain-label">{LEVEL_LABELS[level]}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="terrain-group">
        <h3>On the map</h3>
        <p className="hint">What the markers mean. Placing, moving and erasing them by hand comes in Milestone 3.</p>
        <ul className="heat-key legend" aria-label="Map markers">
          {LEGEND.map((l) => (
            <li key={l.kind}>
              <span className="swatch marker" style={{ background: ENTITY_COLORS[l.kind] }}>
                {l.kind === "warp" ? "W" : ENTITY_PREFIX[l.kind]}
              </span>
              {l.label}
            </li>
          ))}
          <li>
            <span className="swatch marker" style={{ background: "rgba(208, 69, 58, 0.45)" }} />
            Trainer can see
          </li>
          <li>
            <span className="swatch marker outline" style={{ borderColor: "rgba(255, 214, 60, 0.95)" }} />
            Entrance (walk)
          </li>
          <li>
            <span className="swatch marker outline" style={{ borderColor: "rgba(120, 220, 255, 0.95)" }} />
            Entrance (Surf)
          </li>
        </ul>
      </section>

      <section className="overlay-group">
        <h3>Show</h3>
        {OVERLAYS.map((o) => (
          <label key={o.key} className="check" title={o.tip}>
            <input type="checkbox" checked={s.prefs.overlays[o.key]} onChange={(e) => s.setOverlay(o.key, e.target.checked)} />
            {o.label}
          </label>
        ))}
        {s.prefs.overlays.elevation && (
          <label className="slider" title="How strongly the elevation colours cover the map, like Porymap's opacity slider.">
            <span>
              Elevation opacity <b>{Math.round(s.prefs.elevationOpacity * 100)}</b>
            </span>
            <input
              type="range"
              min={15}
              max={100}
              step={5}
              value={Math.round(s.prefs.elevationOpacity * 100)}
              onChange={(e) => s.updatePrefs({ elevationOpacity: Number(e.target.value) / 100 })}
            />
          </label>
        )}
        <label className="check" title="When on, every cell you paint is locked, so Generate builds around it.">
          <input type="checkbox" checked={s.prefs.lockWhenPainting} onChange={(e) => s.updatePrefs({ lockWhenPainting: e.target.checked })} />
          Lock what I paint
        </label>
        {s.prefs.overlays.reach && (
          <ul className="heat-key" aria-label="Reachability colours">
            {HEAT_KEY.map(([v, label]) => (
              <li key={v}>
                <span className="swatch small" style={{ background: HEAT_COLORS[v] }} />
                {label}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
