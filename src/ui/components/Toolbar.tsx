// The tool strip on the left of the canvas. Large (44 px+) buttons for touch.

import type { Tool } from "../store";
import { useStore } from "../store";
import { getPalette, TERRAIN_TYPES } from "../../core/terrain";
import { Icon } from "./icons";
import { canvasRef } from "./MapCanvas";

const TOOLS: Array<{ tool: Tool; icon: string; label: string; key: string; tip: string }> = [
  { tool: "pencil", icon: "pencil", label: "Pencil", key: "B", tip: "Pencil (B): paint the selected terrain. Painted cells are locked so future generators keep them." },
  { tool: "erase", icon: "erase", label: "Eraser", key: "E", tip: "Eraser (E): set cells back to plain ground and unlock them." },
  { tool: "pan", icon: "pan", label: "Move view", key: "H", tip: "Move view (H): drag to pan. You can also hold Space and drag, or drag with two fingers." },
];

export function Toolbar({ onToggleTerrain }: { onToggleTerrain: () => void }) {
  const s = useStore();
  const palette = getPalette(s.prefs.paletteId);
  const current = TERRAIN_TYPES[s.terrain];
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
      <button
        className={`tool ${s.tool === "pick" ? "active" : ""}`}
        title="Pick terrain (I, or Alt+click): the next tap copies a cell's terrain into the pencil. This is the on-screen modifier for touch."
        aria-label="Pick terrain from map"
        aria-pressed={s.tool === "pick"}
        onClick={() => s.setTool(s.tool === "pick" ? "pencil" : "pick")}
      >
        <Icon name="pick" />
      </button>
      <button className="tool swatch-button" title={`Terrain: ${current.label}. Tap to choose another terrain type.`} aria-label={`Choose terrain (current: ${current.label})`} onClick={onToggleTerrain}>
        <span className="swatch big" style={{ background: palette.colors[current.id] }}>
          {current.glyph ?? ""}
        </span>
      </button>
      <div className="brush" title="Brush size: how many cells wide the pencil and eraser paint.">
        <button className="tool small" aria-label="Smaller brush" onClick={() => s.setBrush(s.brush - 1)}>
          −
        </button>
        <span aria-label={`Brush size ${s.brush}`}>{s.brush}</span>
        <button className="tool small" aria-label="Larger brush" onClick={() => s.setBrush(s.brush + 1)}>
          +
        </button>
      </div>
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
