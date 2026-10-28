// List of the project's maps: open, rename, delete, and create new ones.

import { useStore } from "../store";
import { checkMapSize } from "../../core/sizeRule";
import { Icon } from "./icons";

const TYPE_LABELS: Record<string, string> = {
  route: "Route",
  town: "Town",
  forest: "Forest",
  cave: "Cave",
  interior_stub: "Interior",
};

export function MapsPanel({ onClose, onNewMap, onResize }: { onClose: () => void; onNewMap: () => void; onResize: () => void }) {
  const s = useStore();
  return (
    <aside className="drawer left" aria-label="Maps in this project">
      <div className="panel-head">
        <h2>Maps</h2>
        <button className="icon-button" aria-label="Close maps list" title="Close" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      <label className="field" title="The name of the whole region (project).">
        <span>Region name</span>
        <input defaultValue={s.region.name} key={s.region.name} maxLength={100} onBlur={(e) => s.renameRegion(e.target.value)} />
      </label>
      <button
        className="secondary"
        title="Plan the whole region: towns, routes, forests, caves, lakes and rivers"
        onClick={() => {
          s.openRegion();
          onClose();
        }}
      >
        <Icon name="region" size={18} /> Region sketch
      </button>
      <ul className="map-list">
        {s.region.maps.map((m) => {
          const fits = checkMapSize(m.width, m.height, s.region.settings.engineLimits).ok;
          return (
            <li key={m.id} className={m.id === s.currentMapId ? "active" : ""}>
              <button
                className="map-open"
                title={`Open ${m.name}`}
                onClick={() => {
                  s.openMap(m.id);
                  onClose();
                }}
              >
                <span className="map-name">{m.name}</span>
                <span className="map-meta">
                  {TYPE_LABELS[m.mapType]} · {m.width}×{m.height}
                  {fits ? "" : " · too big"}
                </span>
              </button>
              {m.id === s.currentMapId && (
                <button className="icon-button" title={`Resize ${m.name} (change its width and height)`} aria-label={`Resize ${m.name}`} onClick={onResize}>
                  <Icon name="resize" size={18} />
                </button>
              )}
              <button
                className="icon-button"
                title={`Rename ${m.name}`}
                aria-label={`Rename ${m.name}`}
                onClick={() => {
                  const name = window.prompt("New name for this map:", m.name);
                  if (name) s.renameMap(m.id, name);
                }}
              >
                <Icon name="pencil" size={18} />
              </button>
              <button
                className="icon-button"
                title={`Delete ${m.name}`}
                aria-label={`Delete ${m.name}`}
                onClick={() => {
                  if (window.confirm(`Delete the map "${m.name}"? This can't be undone (but you can re-open your last saved file).`)) s.deleteMap(m.id);
                }}
              >
                <Icon name="trash" size={18} />
              </button>
            </li>
          );
        })}
        {s.region.maps.length === 0 && <li className="empty">No maps yet.</li>}
      </ul>
      <button className="primary wide" onClick={onNewMap} title="Create a new blank map in this project">
        <Icon name="plus" size={18} /> New map
      </button>
    </aside>
  );
}
