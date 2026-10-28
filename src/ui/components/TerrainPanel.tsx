// The Paint tab: terrain picker, elevation brush, things to place, lock brush,
// and overlay toggles (right-hand panel).

import { useStore } from "../store";
import { ELEVATION_LEVELS, TERRAIN_TYPES, getPalette } from "../../core/terrain";
import { ELEVATION_VALUES, LEVEL_VALUE, PORYMAP_ELEVATION_COLORS, hexDigit } from "../../core/porymap";
import { ENTITY_COLORS } from "../../core/exporters/blueprint";
import type { Overlays } from "../prefs";
import { HEAT_COLORS } from "../renderer";
import { PLACEABLE_KINDS, THING_LABELS, placePrefix } from "../../core/things";
import type { PlaceKind } from "../../core/things";
import { SMART_KINDS, SMART_LABELS, SMART_TERRAIN } from "../../core/strokes";
import type { SmartKind } from "../../core/strokes";
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

/** Plain names for the elevation levels, shown beside their Porymap numbers. */
export const LEVEL_LABELS: Record<string, string> = {
  water: "Water (Surf)",
  ground: "Ground",
  raised1: "Raised",
  raised2: "Raised ×2",
  raised3: "Raised ×3",
  raised4: "Raised ×4",
  bridge: "Bridge",
};

/** Tooltips for the things the Things tool can place. */
const THING_TIPS: Record<PlaceKind, string> = {
  trainer: "Trainer: faces down with a sight line of 3. Tap it again (or use the bar at the top) to turn it.",
  item_ball: "Item ball (a Poké Ball you pick up).",
  hidden_item: "Hidden item (found with the Itemfinder, or by pressing A).",
  npc: "Person who wanders and talks.",
  sign: "Sign: stand it on a sign tile or the cell in front of one.",
  cut_tree: "Cut tree: blocks the way until the player uses Cut.",
  smash_rock: "Rock: blocks the way until the player uses Rock Smash.",
  strength_boulder: "Boulder: pushed with Strength.",
  berry_tree: "Berry tree: a patch of soft soil where berries grow.",
  warp: "Warp: a door, cave mouth, ladder or stairs leading to another map. Set where it goes in the Details tab. Generate leads a path to it.",
  trigger: "Trigger: an invisible tile that runs a script (or changes the weather) when the player steps on it.",
  secret_base: "Secret base spot: a tree, bush or cave wall where the player can make a Secret Base.",
  heal_location: "Heal location: where the player wakes up after a whiteout and lands after Fly (towns with a Pokémon Center).",
};

const OVERLAYS: Array<{ key: keyof Overlays; label: string; tip: string }> = [
  { key: "grid", label: "Grid", tip: "Cell grid. Lighter lines every 5 cells, brighter every 10." },
  { key: "rulers", label: "Rulers", tip: "Coordinate rulers along the top and left edges." },
  { key: "neighbours", label: "Connected maps", tip: "The maps connected to this one, faded, beyond its edges, lined up as the game joins them. Tap a name at the edge of the screen to open one." },
  { key: "screenFrame", label: "Screen frame", tip: "The 15×10 area one GBA screen shows, around the cell under the pointer." },
  { key: "zones", label: "Zones", tip: "Your zones (Zones tab): biome areas, water, edges and keep-clear ground. A dashed outline is a soft zone, solid is hard." },
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

const SMART_TIPS: Record<SmartKind, string> = {
  path: "Path: draw a line. It's widened to at least the narrowest-path setting (or the brush size), and becomes a bridge where it crosses water.",
  stream: "Stream: draw a line. Deep water at least 2 wide, with open banks where it runs through trees, and a bridge where it crosses a path.",
  tree_wall: "Tree wall: draw a line. Trees at least 2 thick (or the brush size).",
  grass: "Grass patch: draw round an area. It fills with tall grass; paths and water stay as they are.",
  water: "Water body: draw round an area. It fills with deep water, with a tidy shoreline; paths across it become bridges.",
  ledge: "Ledge: draw a line of ledges. Choose which way they jump below, or leave it on Auto (south across the map, east down it).",
  building: "Building lot: drag across the area the building covers. It becomes a building with a door in the middle of its bottom edge (Gen 3 doors face south), a path cell in front, and a door warp: set where it leads in the Details tab.",
};

const LEDGE_DIRS: Array<{ dir: "auto" | "s" | "e" | "w"; label: string; tip: string }> = [
  { dir: "auto", label: "Auto", tip: "Work it out from the line: a line across the map jumps south, a line down it jumps east." },
  { dir: "s", label: "↓", tip: "Jump south (down)" },
  { dir: "e", label: "→", tip: "Jump east (right)" },
  { dir: "w", label: "←", tip: "Jump west (left)" },
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
                  className={`terrain-item ${s.tool === "pencil" && s.terrain === i ? "active" : ""}`}
                  title={`${t.label} (${PASSABILITY_TEXT[t.passability]}). ${t.note}`}
                  aria-pressed={s.tool === "pencil" && s.terrain === i}
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
        <h3>Smart strokes</h3>
        <p className="hint">Draw, and the tool makes it valid: paths and streams get bridges where they cross, streams get banks, shorelines are tidied. What you draw is locked. Brush size sets the width.</p>
        <div className="terrain-grid">
          {SMART_KINDS.map((kind) => {
            const active = s.tool === "strokes" && s.smartKind === kind;
            const t = TERRAIN_TYPES[SMART_TERRAIN[kind]];
            return (
              <button
                key={kind}
                className={`terrain-item ${active ? "active" : ""}`}
                title={SMART_TIPS[kind]}
                aria-pressed={active}
                onClick={() => {
                  s.setSmartKind(kind);
                  onPicked?.();
                }}
              >
                <span className="swatch" style={{ background: palette.colors[t.id] }}>
                  {t.glyph ?? ""}
                </span>
                <span className="terrain-label">{SMART_LABELS[kind]}</span>
              </button>
            );
          })}
        </div>
        {s.tool === "strokes" && s.smartKind === "ledge" && (
          <div className="segmented" role="group" aria-label="Ledge jump direction">
            {LEDGE_DIRS.map((d) => (
              <button key={d.dir} className={s.ledgeDir === d.dir ? "active" : ""} title={d.tip} aria-pressed={s.ledgeDir === d.dir} onClick={() => s.setLedgeDir(d.dir)}>
                {d.label}
              </button>
            ))}
          </div>
        )}
      </section>

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
        <h3>Things on the map</h3>
        <p className="hint">Pick one, then tap the map to place it (Things tool, T). Drag a thing to move it. Things you place or move are kept when you Generate.</p>
        <div className="terrain-grid">
          {PLACEABLE_KINDS.map((kind) => {
            const active = s.tool === "things" && s.thingKind === kind;
            return (
              <button
                key={kind}
                className={`terrain-item ${active ? "active" : ""}`}
                title={THING_TIPS[kind]}
                aria-pressed={active}
                onClick={() => {
                  s.setThingKind(kind);
                  onPicked?.();
                }}
              >
                <span className="swatch marker" style={{ background: ENTITY_COLORS[kind] }}>
                  {placePrefix(kind)}
                </span>
                <span className="terrain-label">{THING_LABELS[kind]}</span>
              </button>
            );
          })}
          <button
            className={`terrain-item ${s.tool === "things" && s.thingKind === "remove" ? "active" : ""}`}
            title="Tap things on the map to remove them."
            aria-pressed={s.tool === "things" && s.thingKind === "remove"}
            onClick={() => {
              s.setThingKind("remove");
              onPicked?.();
            }}
          >
            <span className="swatch">
              <Icon name="erase" size={16} />
            </span>
            <span className="terrain-label">Remove things</span>
          </button>
        </div>
        <ul className="heat-key legend" aria-label="Other map markers">
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

      <section className="terrain-group">
        <h3>Lock brush</h3>
        <p className="hint">Locked cells (marked with a yellow corner) are kept when you Generate. Lock what you want to keep; unlock what Generate may change.</p>
        <div className="terrain-grid">
          {(["lock", "unlock"] as const).map((mode) => {
            const active = s.tool === "lock" && s.lockMode === mode;
            return (
              <button
                key={mode}
                className={`terrain-item ${active ? "active" : ""}`}
                title={mode === "lock" ? "Lock cells (K)" : "Unlock cells (K, then tap the swatch to switch)"}
                aria-pressed={active}
                onClick={() => {
                  s.setLockMode(mode);
                  onPicked?.();
                }}
              >
                <span className="swatch">
                  <Icon name={mode} size={16} />
                </span>
                <span className="terrain-label">{mode === "lock" ? "Lock" : "Unlock"}</span>
              </button>
            );
          })}
        </div>
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
