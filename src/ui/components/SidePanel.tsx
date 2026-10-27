// The right-hand panel with tabs: Paint (terrain + overlays), Zones, Generate, Properties, Check.
// On narrow screens it slides in as a drawer.

import { CheckPanel } from "./CheckPanel";
import { GeneratePanel } from "./GeneratePanel";
import { PropertiesPanel } from "./PropertiesPanel";
import { TerrainPanel } from "./TerrainPanel";
import { ZonesPanel } from "./ZonesPanel";
import { Icon } from "./icons";
import { useStore } from "../store";

export type SideTab = "terrain" | "zones" | "generate" | "props" | "check";

export function SidePanel({ tab, onTab, onClose }: { tab: SideTab; onTab: (t: SideTab) => void; onClose?: () => void }) {
  const s = useStore();
  const errors = s.issues.filter((i) => i.severity === "error").length;
  const warnings = s.issues.length - errors;
  const tabs: Array<{ id: SideTab; label: string; tip: string }> = [
    { id: "terrain", label: "Paint", tip: "Terrain to paint with, and what to show on the map" },
    { id: "zones", label: "Zones", tip: "Plan areas before generating: biomes, water, edges, keep-clear ground" },
    { id: "generate", label: "Generate", tip: "Generate this map from a seed and settings" },
    { id: "props", label: "Details", tip: "Porymap fields of the picked thing, and the map's header, layout and connections" },
    { id: "check", label: "Check", tip: "Problems found on this map" },
  ];
  return (
    <aside className="side-panel" aria-label="Side panel">
      <div className="panel-head">
        <div className="tabs" role="tablist">
          {tabs.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={`tab ${tab === t.id ? "active" : ""}`} title={t.tip} onClick={() => onTab(t.id)}>
              {t.label}
              {t.id === "check" && (errors || warnings) ? <span className={`count ${errors ? "bad" : "warn"}`}>{errors || warnings}</span> : null}
            </button>
          ))}
        </div>
        {onClose && (
          <button className="icon-button" aria-label="Close panel" title="Close" onClick={onClose}>
            <Icon name="close" />
          </button>
        )}
      </div>
      {tab === "terrain" && <TerrainPanel onPicked={onClose} />}
      {tab === "zones" && <ZonesPanel />}
      {tab === "generate" && <GeneratePanel />}
      {tab === "props" && <PropertiesPanel />}
      {tab === "check" && <CheckPanel />}
    </aside>
  );
}
