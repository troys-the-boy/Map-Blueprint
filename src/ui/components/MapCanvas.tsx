// The map canvas: connects the renderer and pointer input to the store.

import { useEffect, useRef } from "react";
import { CanvasInput } from "../input";
import { MapRenderer } from "../renderer";
import { store } from "../store";

/** The renderer of the canvas on screen, so toolbar buttons (zoom, fit) can reach it. */
export const canvasRef: { renderer: MapRenderer | null } = { renderer: null };

export function MapCanvas({ onHover }: { onHover: (cell: [number, number] | null) => void }) {
  const el = useRef<HTMLCanvasElement>(null);
  const hoverRef = useRef(onHover);
  hoverRef.current = onHover;

  useEffect(() => {
    const canvas = el.current!;
    const renderer = new MapRenderer(canvas);
    canvasRef.renderer = renderer;
    renderer.setPalette(store.prefs.paletteId);
    renderer.overlays = { ...store.prefs.overlays };
    renderer.setMap(store.currentMap);

    let shownMapId = store.currentMapId;
    const offCells = store.onCells((mapId, indices) => {
      renderer.setPalette(store.prefs.paletteId);
      renderer.overlays = { ...store.prefs.overlays };
      if (indices && mapId === shownMapId) {
        renderer.updateCells(indices);
      } else {
        const changedMap = shownMapId !== store.currentMapId;
        shownMapId = store.currentMapId;
        renderer.setMap(store.currentMap);
        if (changedMap) renderer.fit();
      }
    });
    // Overlay toggles that don't change cells (grid, rulers, frame) only need a redraw.
    // So do brush size and tool changes (the hover outline shows the brush footprint).
    const brushFor = () => (store.tool === "pencil" || store.tool === "erase" ? store.brush : 1);
    renderer.brush = brushFor();
    const offStore = store.subscribe(() => {
      const o = store.prefs.overlays;
      const r = renderer.overlays;
      if (o.grid !== r.grid || o.rulers !== r.rulers || o.screenFrame !== r.screenFrame) {
        renderer.overlays = { ...o };
        renderer.requestFrame();
      }
      if (renderer.brush !== brushFor()) {
        renderer.brush = brushFor();
        renderer.requestFrame();
      }
    });

    const input = new CanvasInput(canvas, store, renderer, (cell) => hoverRef.current(cell));

    let fitted = false;
    const ro = new ResizeObserver(() => {
      const r = canvas.getBoundingClientRect();
      renderer.resize(r.width, r.height);
      if (!fitted && r.width > 0) {
        fitted = true;
        renderer.fit();
      }
    });
    ro.observe(canvas);

    return () => {
      ro.disconnect();
      input.dispose();
      offCells();
      offStore();
      if (canvasRef.renderer === renderer) canvasRef.renderer = null;
    };
  }, []);

  return <canvas ref={el} className="map-canvas" aria-label="Map canvas. Draw with the pencil; drag with two fingers to pan; pinch to zoom." />;
}
