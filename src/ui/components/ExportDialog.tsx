// Export dialog: blueprint PNG, screen tiles, placement table.
// Exports are blocked while the map has validation errors.

import { useState } from "react";
import { EXPORTERS } from "../../core/exporters";
import { deliverFile } from "../files";
import { APP_VERSION, useStore } from "../store";

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const map = s.currentMap;
  const [busy, setBusy] = useState<string | null>(null);
  const errors = s.issues.filter((i) => i.severity === "error").length;

  const run = async (id: string) => {
    const exporter = EXPORTERS.find((e) => e.id === id);
    if (!map || !exporter) return;
    setBusy(id);
    // Let the "Working…" label paint before the (brief) work starts.
    await new Promise((r) => setTimeout(r, 30));
    try {
      const file = exporter.run(map, { paletteId: s.prefs.paletteId, regionName: s.region.name, appVersion: APP_VERSION });
      await deliverFile(s, file.name, file.mime, file.data);
    } catch (err) {
      s.setNotice({ kind: "error", text: `Export failed: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="export-title">
        <h2 id="export-title">Export {map?.name}</h2>
        {!map && <p className="hint">Open a map first.</p>}
        {map && errors > 0 && (
          <p className="notice-inline bad">
            This map has {errors} error{errors === 1 ? "" : "s"}. Fix {errors === 1 ? "it" : "them"} first (see the Check tab), then export.
          </p>
        )}
        {map && (
          <ul className="export-list">
            {EXPORTERS.map((e) => (
              <li key={e.id}>
                <div>
                  <strong>{e.label}</strong>
                  <small>{e.description}</small>
                </div>
                <button className="primary" disabled={errors > 0 || busy !== null} onClick={() => void run(e.id)} title={errors ? "Fix the errors first" : `Export ${e.label}`}>
                  {busy === e.id ? "Working…" : "Export"}
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="hint">Colours follow your palette setting (Settings → Map colors). Files are made on this device; nothing is uploaded.</p>
        <div className="modal-actions">
          <button className="secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
