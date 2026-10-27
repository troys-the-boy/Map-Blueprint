// The tool strip on the left of the canvas. Large (44 px+) buttons for touch.

import type { Tool } from "../store";
import { useStore } from "../store";
import { ELEVATION_LEVELS, getPalette, TERRAIN_TYPES } from "../../core/terrain";
import { LEVEL_VALUE, PORYMAP_ELEVATION_COLORS, hexDigit } from "../../core/porymap";
import { ENTITY_PREFIX } from "../../core/entities";
import { ENTITY_COLORS } from "../../core/exporters/blueprint";
import { THING_LABELS } from "../../core/things";
import { Icon } from "./icons";
import { canvasRef } from "./MapCanvas";
import type { SideTab } from "./SidePanel";

const TOOLS: Array<{ tool: Tool; icon: string; label: string; key: string; tip: string }> = [
  { tool: "pencil", icon: "pencil", label: "Pencil", key: "B", tip: "Pencil (B): paint the selected terrain. Painted cells are locked so Generate keeps them." },
  { tool: "erase", icon: "erase", label: "Eraser", key: "E", tip: "Eraser (E): set cells back to plain ground and unlock them." },
  { tool: "elevation", icon: "elevation", label: "Elevation brush", key: "L", tip: "Elevation brush (L): paint the elevation numbers you'll set in Porymap's collision tab. Terrain stays as it is." },
  { tool: "select", icon: "select", label: "Select", key: "V", tip: "Select (V): drag a rectangle. Drag inside it to move it (with the things in it). Copy, cut, paste, delete, fill, lock or regenerate it from the bar at the top." },
  { tool: "lasso", icon: "lasso", label: "Lasso", key: "Q", tip: "Lasso (Q): draw around any shape to select it. Then use it like a rectangle selection: drag inside to move it, or use the bar at the top." },
  { tool: "things", icon: "things", label: "Things", key: "T", tip: "Things (T): tap to place the chosen thing (trainer, item…). Drag a thing to move it; tap a picked trainer to turn it." },
];

const PAN = { tool: "pan" as Tool, icon: "pan", label: "Move view", key: "H", tip: "Move view (H): drag to pan. You can also hold Space and drag, or drag with two fingers." };

const LOCKS: Array<{ mode: "lock" | "unlock"; label: string; tip: string }> = [
  { mode: "lock", label: "Lock brush", tip: "Lock brush (K): lock cells so Generate keeps them. Terrain stays as it is." },
  { mode: "unlock", label: "Unlock brush", tip: "Unlock brush (U): unlock cells so Generate can change them. Terrain stays as it is." },
];

export function Toolbar({ onShowTab }: { onShowTab: (tab: SideTab) => void }) {
  const s = useStore();
  const palette = getPalette(s.prefs.paletteId);
  const current = TERRAIN_TYPES[s.terrain];
  const elevationValue = LEVEL_VALUE[s.elevationLevel] ?? LEVEL_VALUE[ELEVATION_LEVELS.indexOf("ground")];
  const r = () => canvasRef.renderer;

  return (
    <div className="toolbar" role="toolbar" aria-label="Tools">
      {TOOLS.map((t) => (
        <button
          key={t.tool}
          className={`tool ${s.tool === t.tool ? "active" : ""}`}
          title={t.tip}
          aria-label={t.label}
          aria-pressed={s.tool === t.tool}
          onClick={() => s.setTool(t.tool)}
        >
          <Icon name={t.icon} />
        </button>
      ))}
      {LOCKS.map((l) => {
        const active = s.tool === "lock" && s.lockMode === l.mode;
        return (
          <button key={l.mode} className={`tool ${active ? "active" : ""}`} title={l.tip} aria-label={l.label} aria-pressed={active} onClick={() => s.setLockMode(l.mode)}>
            <Icon name={l.mode} />
          </button>
        );
      })}
      <button className={`tool ${s.tool === "pan" ? "active" : ""}`} title={PAN.tip} aria-label={PAN.label} aria-pressed={s.tool === "pan"} onClick={() => s.setTool("pan")}>
        <Icon name="pan" />
      </button>
      <button
        className={`tool ${s.tool === "pick" ? "active" : ""}`}
        title="Pick (I, or Alt+click): the next tap copies a cell's terrain into the pencil (or its elevation into the elevation brush). This is the on-screen modifier for touch."
        aria-label="Pick terrain from map"
        aria-pressed={s.tool === "pick"}
        onClick={() => s.setTool(s.tool === "pick" ? "pencil" : "pick")}
      >
        <Icon name="pick" />
      </button>
      {s.tool === "things" ? (
        <button
          className="tool swatch-button"
          title={s.thingKind === "remove" ? "Removing things. Tap to choose a thing to place instead." : `Placing: ${THING_LABELS[s.thingKind]}. Tap to choose another.`}
          aria-label="Choose what to place"
          onClick={() => onShowTab("terrain")}
        >
          {s.thingKind === "remove" ? (
            <span className="swatch big">
              <Icon name="erase" size={18} />
            </span>
          ) : (
            <span className="swatch big marker" style={{ background: ENTITY_COLORS[s.thingKind] }}>
              {ENTITY_PREFIX[s.thingKind]}
            </span>
          )}
        </button>
      ) : s.tool === "elevation" ? (
        <button className="tool swatch-button" title={`Elevation ${hexDigit(elevationValue)}. Tap to choose another.`} aria-label={`Choose elevation (current: ${hexDigit(elevationValue)})`} onClick={() => onShowTab("terrain")}>
          <span className="swatch big elevation-swatch" style={{ background: PORYMAP_ELEVATION_COLORS[elevationValue] }}>
            {hexDigit(elevationValue)}
          </span>
        </button>
      ) : (
        <button className="tool swatch-button" title={`Terrain: ${current.label}. Tap to choose another terrain type.`} aria-label={`Choose terrain (current: ${current.label})`} onClick={() => onShowTab("terrain")}>
          <span className="swatch big" style={{ background: palette.colors[current.id] }}>
            {current.glyph ?? ""}
          </span>
        </button>
      )}
      {(s.tool === "pencil" || s.tool === "erase" || s.tool === "elevation" || s.tool === "lock") && <div className="brush" title="Brush size: how many cells wide the pencil, eraser, elevation brush and lock brush paint.">
        <button className="tool small" aria-label="Smaller brush" onClick={() => s.setBrush(s.brush - 1)}>
          −
        </button>
        <span aria-label={`Brush size ${s.brush}`}>{s.brush}</span>
        <button className="tool small" aria-label="Larger brush" onClick={() => s.setBrush(s.brush + 1)}>
          +
        </button>
      </div>}
      <hr />
      <button
        className="tool"
        title="Generate (G): build this map from its seed and settings. Long-press or right-click for settings."
        aria-label="Generate map"
        disabled={s.generating}
        onClick={() => void s.generate()}
        onContextMenu={(e) => {
          e.preventDefault();
          onShowTab("generate");
        }}
      >
        <Icon name="generate" />
      </button>
      <hr />
      <button className="tool" title="Undo (Ctrl+Z, or tap with two fingers)" aria-label="Undo" disabled={!s.canUndo()} onClick={() => s.undo()}>
        <Icon name="undo" />
      </button>
      <button className="tool" title="Redo (Ctrl+Shift+Z or Ctrl+Y)" aria-label="Redo" disabled={!s.canRedo()} onClick={() => s.redo()}>
        <Icon name="redo" />
      </button>
      <hr />
      <button className="tool" title="Zoom in (+)" aria-label="Zoom in" onClick={() => r()?.zoomAt(1.25, r()!.size.width / 2, r()!.size.height / 2)}>
        <Icon name="zoomIn" />
      </button>
      <button className="tool" title="Zoom out (−)" aria-label="Zoom out" onClick={() => r()?.zoomAt(0.8, r()!.size.width / 2, r()!.size.height / 2)}>
        <Icon name="zoomOut" />
      </button>
      <button className="tool" title="Fit the whole map on screen (0)" aria-label="Fit map to screen" onClick={() => r()?.fit()}>
        <Icon name="fit" />
      </button>
    </div>
  );
}
