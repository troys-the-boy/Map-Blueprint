// The tool strip on the left of the region sketch.

import { useStore } from "../store";
import type { SketchTool } from "../sketchEditor";
import { sketchEditor } from "../sketchEditor";
import { SKETCH_AREA_COLORS } from "../zoneColors";
import { Icon } from "./icons";
import { sketchViewRef } from "./SketchCanvas";

export const SKETCH_TOOLS: Array<{ tool: SketchTool; icon: string; label: string; tip: string }> = [
  { tool: "select", icon: "select", label: "Pick and move", tip: "Pick and move: tap a place to pick it (its details show in the panel). Drag it to move it, or drag a corner to resize a stretch." },
  { tool: "town", icon: "town", label: "Town", tip: "Town: drag a rectangle. Its size in metatiles shows as you draw." },
  { tool: "route", icon: "route", label: "Route", tip: "Route: drag a rectangle for each straight stretch. With a route picked, a rectangle touching its end carries the route on, so it can bend. Stretches longer than the segment length are split into segments." },
  { tool: "forest", icon: "forest", label: "Forest", tip: "Forest: tap a route or town where the forest's entrance is. Its inside is its own map, so it takes no room on the sketch." },
  { tool: "cave", icon: "cave", label: "Cave", tip: "Cave: tap a route or town where the cave's mouth is. Its inside is its own map, so it takes no room on the sketch." },
  { tool: "paint", icon: "pencil", label: "Paint areas", tip: "Paint areas: biomes, lakes and sea (pick one in the panel). The coastline is the edge of the sea." },
  { tool: "erase", icon: "erase", label: "Erase areas", tip: "Erase areas: clear painted biomes, lakes and sea." },
  { tool: "river", icon: "river", label: "River", tip: "River: tap points along the river; tap the last point again (or Finish in the panel) to end it." },
  { tool: "journey", icon: "journey", label: "Journey", tip: "Journey: tap the places in the order the player first visits them. Tap the last one again to take it off. This sets each route's Start and Finish, the order of levels, and where badges and HMs are expected." },
  { tool: "pan", icon: "pan", label: "Move view", tip: "Move view: drag to pan. You can also drag with two fingers, or with the right mouse button." },
];

export function SketchToolbar({ onShowPanel }: { onShowPanel: () => void }) {
  useStore();
  const e = sketchEditor;
  return (
    <div className="toolbar" role="toolbar" aria-label="Sketch tools">
      {SKETCH_TOOLS.map((t) => (
        <button key={t.tool} className={`tool ${e.tool === t.tool ? "active" : ""}`} title={t.tip} aria-label={t.label} aria-pressed={e.tool === t.tool} onClick={() => e.setTool(t.tool)}>
          <Icon name={t.icon} />
        </button>
      ))}
      {(e.tool === "paint" || e.tool === "erase") && (
        <>
          {e.tool === "paint" && (
            <button className="tool swatch-button" title="The area being painted. Tap to choose another." aria-label="Choose an area to paint" onClick={onShowPanel}>
              <span className="swatch big" style={{ background: SKETCH_AREA_COLORS[e.area] }} />
            </button>
          )}
          <div className="brush" title="Brush size, in sketch squares (5 metatiles each).">
            <button className="tool small" aria-label="Smaller brush" onClick={() => e.setBrush(e.brush - 1)}>
              −
            </button>
            <span aria-label={`Brush size ${e.brush}`}>{e.brush}</span>
            <button className="tool small" aria-label="Larger brush" onClick={() => e.setBrush(e.brush + 1)}>
              +
            </button>
          </div>
        </>
      )}
      <button className="tool narrow-only" title="Show the panel: the picked place, problems, the drawing to trace and settings" aria-label="Show the sketch panel" onClick={onShowPanel}>
        <Icon name="layers" />
      </button>
      <button
        className={`tool ${e.showRegionMap ? "active" : ""}`}
        title="Region map: show the in-game region map's 28 × 15 grid over the sketch. Drag a section to move it, or a corner to resize it; sections you move stay put."
        aria-label="Show the region map"
        aria-pressed={e.showRegionMap}
        onClick={() => e.toggleRegionMap()}
      >
        <Icon name="region" />
      </button>
      <hr />
      <button className="tool" title="Undo (Ctrl+Z)" aria-label="Undo" disabled={!e.canUndo()} onClick={() => e.undo()}>
        <Icon name="undo" />
      </button>
      <button className="tool" title="Redo (Ctrl+Shift+Z or Ctrl+Y)" aria-label="Redo" disabled={!e.canRedo()} onClick={() => e.redo()}>
        <Icon name="redo" />
      </button>
      <hr />
      <button className="tool" title="Zoom in (+)" aria-label="Zoom in" onClick={() => sketchViewRef.zoom?.(1.25)}>
        <Icon name="zoomIn" />
      </button>
      <button className="tool" title="Zoom out (−)" aria-label="Zoom out" onClick={() => sketchViewRef.zoom?.(0.8)}>
        <Icon name="zoomOut" />
      </button>
      <button className="tool" title="Fit the whole sketch on screen (0)" aria-label="Fit sketch to screen" onClick={() => sketchViewRef.fit?.()}>
        <Icon name="fit" />
      </button>
    </div>
  );
}
