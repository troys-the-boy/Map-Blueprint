// The map canvas: connects the renderer and pointer input to the store.

import { useEffect, useRef } from "react";
import { CanvasInput } from "../input";
import { MapRenderer } from "../renderer";
import { store } from "../store";
import { hmHeatmap, openingCells } from "../../core/reach";
import { AREA_KINDS, SMART_TERRAIN } from "../../core/strokes";

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
    renderer.setNeighbours(store.currentMap, store.region.maps);

    let shownMapId = store.currentMapId;
    let shownSize = store.currentMap ? `${store.currentMap.width}x${store.currentMap.height}` : "";
    const offCells = store.onCells((mapId, indices) => {
      renderer.setPalette(store.prefs.paletteId);
      renderer.overlays = { ...store.prefs.overlays };
      if (indices && mapId === shownMapId) {
        renderer.updateCells(indices);
      } else {
        // Fit the view again when another map opens, or this one is resized.
        const size = store.currentMap ? `${store.currentMap.width}x${store.currentMap.height}` : "";
        const refit = shownMapId !== store.currentMapId || size !== shownSize;
        shownMapId = store.currentMapId;
        shownSize = size;
        renderer.setMap(store.currentMap);
        renderer.setNeighbours(store.currentMap, store.region.maps);
        if (refit) renderer.fit();
      }
    });
    // Overlay toggles that don't change cells (grid, rulers, frame) only need a redraw.
    // So do brush size and tool changes (the hover outline shows the brush footprint).
    const brushFor = () =>
      store.tool === "pencil" || store.tool === "erase" || store.tool === "elevation" || store.tool === "lock" || store.tool === "zones"
        ? store.brush
        : store.tool === "strokes" && !AREA_KINDS.has(store.smartKind)
          ? store.smartWidth
          : 1;
    renderer.brush = brushFor();
    let heatFor = -1;
    let lassoLength = 0;
    let smartLength = 0;
    let focusSeq = store.focus?.seq ?? 0;
    const sync = () => {
      let redraw = false;
      const o = store.prefs.overlays;
      if (JSON.stringify(o) !== JSON.stringify(renderer.overlays)) {
        // Lock marks are drawn into the terrain bitmaps, so those need a full redraw.
        const locksChanged = o.locks !== renderer.overlays.locks;
        renderer.overlays = { ...o };
        if (locksChanged) renderer.setMap(store.currentMap);
        redraw = true;
      }
      if (renderer.elevationOpacity !== store.prefs.elevationOpacity) {
        renderer.elevationOpacity = store.prefs.elevationOpacity;
        redraw = true;
      }
      if (renderer.brush !== brushFor()) {
        renderer.brush = brushFor();
        redraw = true;
      }
      // Selection, an area being placed, and the picked thing.
      const floating = store.floating ? { clip: store.floating.clip, x: store.floating.x, y: store.floating.y } : null;
      if (
        renderer.activeZoneId !== store.activeZoneId ||
        renderer.selection !== store.selection ||
        renderer.selectedThing !== store.selectedThing ||
        renderer.floating?.clip !== floating?.clip ||
        renderer.floating?.x !== floating?.x ||
        renderer.floating?.y !== floating?.y ||
        renderer.lassoPoints !== store.lassoPoints ||
        (store.lassoPoints?.length ?? 0) !== lassoLength
      ) {
        lassoLength = store.lassoPoints?.length ?? 0;
        renderer.lassoPoints = store.lassoPoints;
        renderer.selection = store.selection;
        renderer.activeZoneId = store.activeZoneId;
        renderer.selectedThing = store.selectedThing;
        renderer.floating = floating;
        redraw = true;
      }
      // A smart stroke being drawn.
      const pts = store.smartPoints;
      if ((pts?.length ?? 0) !== smartLength || (!pts && renderer.smartPreview)) {
        smartLength = pts?.length ?? 0;
        renderer.smartPreview = pts
          ? { points: pts, width: store.smartWidth, closed: AREA_KINDS.has(store.smartKind), color: renderer.colorOf(SMART_TERRAIN[store.smartKind]) }
          : null;
        redraw = true;
      }
      if (renderer.issues !== store.issues) {
        renderer.issues = store.issues;
        redraw = true;
      }
      // The reachability heatmap is only worked out while it's switched on.
      const map = store.currentMap;
      if (o.reach && map && heatFor !== store.mapVersion) {
        heatFor = store.mapVersion;
        const starts = map.openings.flatMap((op) => openingCells(op, map.width, map.height));
        renderer.heat = hmHeatmap({ width: map.width, height: map.height, terrain: map.layers.terrain.data, entities: map.entities }, starts);
        redraw = true;
      }
      if (store.focus && store.focus.seq !== focusSeq) {
        focusSeq = store.focus.seq;
        renderer.focusOn(store.focus.x, store.focus.y, store.focus.cells);
      }
      if (redraw) renderer.requestFrame();
    };
    const offStore = store.subscribe(sync);
    sync();

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
