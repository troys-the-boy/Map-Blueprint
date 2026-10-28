// The editor's main layout: header, canvas with tool strip, terrain panel,
// status bar, and the dialogs.

import { useEffect, useRef, useState } from "react";
import { checkMapSize } from "../core/sizeRule";
import { TERRAIN_TYPES } from "../core/terrain";
import { MapCanvas, canvasRef } from "./components/MapCanvas";
import { SketchCanvas, sketchViewRef } from "./components/SketchCanvas";
import { SketchPanel } from "./components/SketchPanel";
import { SketchToolbar } from "./components/SketchToolbar";
import { sketchProblems } from "./sketchProblems";
import { sketchEditor } from "./sketchEditor";
import { MapsPanel } from "./components/MapsPanel";
import { ResizeDialog } from "./components/ResizeDialog";
import { NewMapDialog } from "./components/NewMapDialog";
import { SettingsDialog } from "./components/SettingsDialog";
import { SidePanel } from "./components/SidePanel";
import type { SideTab } from "./components/SidePanel";
import { ExportDialog } from "./components/ExportDialog";
import { Toolbar } from "./components/Toolbar";
import { EditBar } from "./components/EditBar";
import { NeighbourLinks } from "./components/NeighbourLinks";
import { VariationsDialog } from "./components/VariationsDialog";
import { Icon } from "./components/icons";
import { openProject, saveProject } from "./files";
import { screenLabel } from "./renderer";
import { store, useStore } from "./store";

type Dialog = null | "newMap" | "settings" | "export" | "resize";

export function App() {
  const s = useStore();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [mapsOpen, setMapsOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [tab, setTab] = useState<SideTab>("terrain");
  /** Show a side-panel tab (and slide the panel in on narrow screens). */
  const showTab = (t: SideTab) => {
    setTab(t);
    setPanelOpen(true);
  };
  const [hover, setHover] = useState<[number, number] | null>(null);
  const region = s.view === "region";
  const map = region ? null : s.currentMap;
  const sketchTroubles = region ? sketchProblems(s.region) : [];

  useKeyboardShortcuts(() => setDialog("newMap"));

  // Warn before closing the tab with unsaved changes.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (store.dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  const confirmDiscard = () =>
    !store.dirty || window.confirm("You have unsaved changes. Continue without saving them?\n\n(Choose Cancel, then Save, to keep them.)");

  const hoverTerrain = hover && map ? TERRAIN_TYPES[map.layers.terrain.data[hover[1] * map.width + hover[0]]] : null;
  const size = map ? checkMapSize(map.width, map.height, s.region.settings.engineLimits) : null;

  return (
    <div className="app">
      <header className="topbar">
        <button className="icon-button labeled" onClick={() => setMapsOpen(true)} title="Show the maps in this project">
          <Icon name="maps" /> <span>Maps</span>
        </button>
        <nav className="breadcrumbs" aria-label="Location">
          <button className={`crumb crumb-button ${region ? "current" : ""}`} title="Show the region sketch" onClick={() => s.openRegion()}>
            {s.region.name}
          </button>
          {map && (
            <>
              <span className="sep">›</span>
              <span className="crumb current">{map.name}</span>
            </>
          )}
        </nav>
        <div className="spacer" />
        {s.dirty && (
          <span className="unsaved" title="Changes since your last save live only in this browser. Save to a file to keep them.">
            ● Unsaved changes
          </span>
        )}
        <button className="icon-button labeled" onClick={() => setDialog("newMap")} title="Create a new map (N)">
          <Icon name="plus" /> <span>New map</span>
        </button>
        <button className="icon-button labeled" onClick={() => confirmDiscard() && void openProject(store)} title="Open a project file from this device">
          <Icon name="open" /> <span>Open</span>
        </button>
        <button className="icon-button labeled" onClick={() => void saveProject(store)} title="Save the project to a file on this device (Ctrl+S)">
          <Icon name="save" /> <span>Save</span>
        </button>
        {map && (
          <button className="icon-button labeled" onClick={() => setDialog("export")} title="Export the rebuild packet, or any of its sheets (blueprint, screen tiles, placement table, header sheet, map.json, encounters, checklist)">
            <Icon name="export" /> <span>Export</span>
          </button>
        )}
        <details className="menu">
          <summary className="icon-button" title="More">
            ⋯
          </summary>
          <div className="menu-items">
            <button onClick={() => void saveProject(store, { forceDownload: true })} title="Always download a copy of the project file">
              Download a copy
            </button>
            <button
              onClick={() => {
                if (confirmDiscard()) store.newProject();
              }}
              title="Start a new, empty project"
            >
              New project
            </button>
          </div>
        </details>
        <button className="icon-button" onClick={() => setDialog("settings")} title="Settings" aria-label="Settings">
          <Icon name="settings" />
        </button>
      </header>

      {s.notice && (
        <div className={`notice ${s.notice.kind}`} role={s.notice.kind === "error" ? "alert" : "status"}>
          <span>{s.notice.text}</span>
          <button className="icon-button" aria-label="Dismiss message" onClick={() => s.setNotice(null)}>
            <Icon name="close" size={18} />
          </button>
        </div>
      )}

      <main className="workspace">
        <div className="canvas-wrap">
          {region ? <SketchCanvas onHover={setHover} /> : <MapCanvas onHover={setHover} />}
          {region && <SketchToolbar onShowPanel={() => setPanelOpen(true)} />}
          {map && <Toolbar onShowTab={showTab} />}
          {map && <EditBar />}
          {map && <NeighbourLinks />}
          {!map && !region && (
            <div className="welcome">
              <h1>Gen 3 Map Blueprint</h1>
              <p>Plan maps for your pokeemerald hack, then rebuild them in Porymap.</p>
              <div className="welcome-actions">
                <button className="primary" onClick={() => setDialog("newMap")}>
                  <Icon name="plus" size={18} /> Create a map
                </button>
                <button className="secondary" title="Plan the whole region: towns, routes, forests, caves, lakes and rivers" onClick={() => s.openRegion()}>
                  <Icon name="region" size={18} /> Sketch a region
                </button>
                <button className="secondary" onClick={() => void openProject(store)}>
                  <Icon name="open" size={18} /> Open a project file
                </button>
              </div>
            </div>
          )}
        </div>
        {region && (
          <div className={`terrain-dock ${panelOpen ? "open" : ""}`}>
            <SketchPanel onClose={panelOpen ? () => setPanelOpen(false) : undefined} />
          </div>
        )}
        {map && (
          <div className={`terrain-dock ${panelOpen ? "open" : ""}`}>
            <SidePanel tab={tab} onTab={setTab} onClose={panelOpen ? () => setPanelOpen(false) : undefined} />
          </div>
        )}
      </main>

      <footer className="statusbar">
        {map ? (
          <>
            <span title="Cell under the pointer (x, y), counted from the top-left corner">
              {hover ? `x ${hover[0]}, y ${hover[1]}` : "x –, y –"}
            </span>
            <span title="The 15×10 GBA screen this cell is in (columns A, B, C… left to right; rows 1, 2, 3… top to bottom)">
              Screen {hover ? screenLabel(hover[0], hover[1]) : "–"}
            </span>
            <span className="grow">{hoverTerrain ? hoverTerrain.label : ""}</span>
            <span title={size ? `Map memory: ${size.used.toLocaleString("en-US")} of ${size.limit.toLocaleString("en-US")} used` : ""} className={size?.ok ? "" : "bad"}>
              {map.width}×{map.height} · {size?.ok ? `${size.remaining.toLocaleString("en-US")} left` : "too big"}
            </span>
            <button
              className={`status-check ${s.issues.some((i) => i.severity === "error") ? "bad" : s.issues.length ? "warn" : "good"}`}
              title="Problems found on this map. Click to see them."
              onClick={() => showTab("check")}
            >
              {s.issues.length === 0 ? "✓ OK" : `${s.issues.filter((i) => i.severity === "error").length} errors · ${s.issues.filter((i) => i.severity === "warning").length} warnings`}
            </button>
            <span title="Seed for this map">Seed {map.seed}</span>
          </>
        ) : region ? (
          <>
            <span title="Position under the pointer, in metatiles from the sketch's top-left corner">{hover ? `x ${hover[0]}, y ${hover[1]}` : "x –, y –"}</span>
            <span className="grow" />
            <button
              className={`status-check ${sketchTroubles.some((i) => i.severity === "error") ? "bad" : sketchTroubles.length ? "warn" : "good"}`}
              title="Problems in the sketch. Click to see them."
              onClick={() => setPanelOpen(true)}
            >
              {sketchTroubles.length === 0 ? "✓ OK" : `${sketchTroubles.filter((i) => i.severity === "error").length} errors · ${sketchTroubles.filter((i) => i.severity === "warning").length} warnings`}
            </button>
          </>
        ) : (
          <span>No map open</span>
        )}
      </footer>

      {mapsOpen && (
        <>
          <div className="drawer-backdrop" onPointerDown={() => setMapsOpen(false)} />
          <MapsPanel
            onClose={() => setMapsOpen(false)}
            onNewMap={() => {
              setMapsOpen(false);
              setDialog("newMap");
            }}
            onResize={() => {
              setMapsOpen(false);
              setDialog("resize");
            }}
          />
        </>
      )}
      {dialog === "newMap" && <NewMapDialog onClose={() => setDialog(null)} />}
      {dialog === "settings" && <SettingsDialog onClose={() => setDialog(null)} />}
      {dialog === "resize" && <ResizeDialog onClose={() => setDialog(null)} />}
      {dialog === "export" && <ExportDialog onClose={() => setDialog(null)} />}
      <VariationsDialog />
    </div>
  );
}

function useKeyboardShortcuts(openNewMap: () => void) {
  const openRef = useRef(openNewMap);
  openRef.current = openNewMap;
  useEffect(() => {
    const openNewMap = () => openRef.current();
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT") return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (store.view === "region") {
        const ed = sketchEditor;
        if (mod && key === "z" && !e.shiftKey) ed.undo();
        else if (mod && (key === "y" || (key === "z" && e.shiftKey))) ed.redo();
        else if (mod && key === "s") void saveProject(store);
        else if (mod) return;
        else if (key === "enter" && ed.riverPoints) ed.finishRiver();
        else if (key === "escape") ed.riverPoints ? ed.cancelRiver() : ed.tool === "calibrate" || ed.tool === "pin" ? ed.setTool("select") : ed.select(null);
        else if ((key === "delete" || key === "backspace") && ed.selected) ed.deleteSelected();
        else if (key === "0") sketchViewRef.fit?.();
        else if (key === "+" || key === "=") sketchViewRef.zoom?.(1.25);
        else if (key === "-") sketchViewRef.zoom?.(0.8);
        else return;
        e.preventDefault();
        return;
      }
      const selecting = store.selecting;
      const centre = () => {
        const r = canvasRef.renderer;
        return r ? r.cellAt(r.size.width / 2, r.size.height / 2) : null;
      };
      if (mod && key === "a" && selecting) store.selectAll();
      else if (mod && key === "i" && selecting) store.invertSelection();
      else if (mod && key === "c" && selecting) store.copySelection();
      else if (mod && key === "x" && selecting) store.cutSelection();
      else if (mod && key === "v") store.paste(canvasRef.renderer?.hover ?? centre());
      else if ((key === "delete" || key === "backspace") && selecting && store.selection) store.deleteSelection();
      else if ((key === "delete" || key === "backspace") && store.tool === "things" && store.selectedThing) store.deleteThing();
      else if (key === "escape" && selecting) store.clearSelection();
      else if (key === "enter" && store.floating) store.dropFloating();
      else if (key === "r" && !mod && store.tool === "things" && store.selectedEntity?.kind === "trainer") store.turnClockwise();
      else if (mod && key === "z" && !e.shiftKey) store.undo();
      else if (mod && (key === "y" || (key === "z" && e.shiftKey))) store.redo();
      else if (mod && key === "s") void saveProject(store);
      else if (mod) return;
      else if (key === "b") store.setTool("pencil");
      else if (key === "e") store.setTool("erase");
      else if (key === "l") store.setTool("elevation");
      else if (key === "v") store.setTool("select");
      else if (key === "q") store.setTool("lasso");
      else if (key === "w") store.setTool("wand");
      else if (key === "s") store.setTool("strokes");
      else if (key === "z") store.setTool("zones");
      else if (key === "u") store.setLockMode("unlock");
      else if (key === "t") store.setTool("things");
      else if (key === "k") store.setLockMode("lock");
      else if (key === "h") store.setTool("pan");
      else if (key === "i") store.setTool("pick");
      else if (key === "n") openNewMap();
      else if (key === "g") void store.generate();
      else if (key === "[") store.setBrush(store.brush - 1);
      else if (key === "]") store.setBrush(store.brush + 1);
      else if (key === "0") canvasRef.renderer?.fit();
      else if (key === "+" || key === "=") canvasRef.renderer?.zoomAt(1.25, canvasRef.renderer.size.width / 2, canvasRef.renderer.size.height / 2);
      else if (key === "-") canvasRef.renderer?.zoomAt(0.8, canvasRef.renderer.size.width / 2, canvasRef.renderer.size.height / 2);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
