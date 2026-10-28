// Building the region in the sketch panel: make or update every map from the
// sketch, then generate the new ones. See core/buildRegion.ts.

import { useStore } from "../store";
import { Icon } from "./icons";

export function BuildPanel({ errors }: { errors: number }) {
  const s = useStore();
  const sketch = s.region.sketch;
  if (!sketch) return null;
  const built = sketch.places.some((p) => p.mapIds.length);
  const last = s.lastBuild;
  const report = last?.report;
  const name = (id: string) => s.region.maps.find((m) => m.id === id)?.name ?? id;
  const batch = s.batch;

  return (
    <section className="sketch-section build-section">
      <h3>Maps</h3>
      <button
        className="primary"
        disabled={errors > 0 || !sketch.places.length || !!batch}
        title={errors ? "Fix the errors under Check first." : "Make a map for every town, route segment, forest and cave, joined up. Building again updates them and keeps what you've drawn."}
        onClick={() => s.buildFromSketch()}
      >
        <Icon name="maps" size={18} /> {built ? "Update the maps from the sketch" : "Build the maps"}
      </button>
      {errors > 0 && <p className="hint">Fix the errors under Check first.</p>}
      {batch && (
        <p className="hint" role="status">
          Generating map {Math.min(batch.done + 1, batch.total)} of {batch.total}…
          <progress max={batch.total} value={batch.done} />
        </p>
      )}
      {report && report.blocked.length > 0 && <p className="hint bad">Not built: {report.blocked[0]}</p>}
      {report && !report.blocked.length && !batch && (
        <div className="build-report">
          <p className="hint">
            {report.created.length ? `Made ${report.created.length} map${report.created.length === 1 ? "" : "s"}` : "No new maps"}
            {report.updated.length ? `, updated ${report.updated.length}` : ""}.{" "}
            {report.needsGenerate.length
              ? `${report.needsGenerate.length} need${report.needsGenerate.length === 1 ? "s" : ""} generating (new, or their size or entrances changed).`
              : "Nothing needs generating."}
          </p>
          <div className="field-row wrap">
            {report.needsGenerate.length > 0 && (
              <button className="secondary" onClick={() => void s.generateMaps(report.needsGenerate)}>
                <Icon name="generate" size={18} /> Generate {report.needsGenerate.length === 1 ? "it" : `all ${report.needsGenerate.length}`}
              </button>
            )}
            {last?.before && (
              <button className="secondary" title="Put the maps back as they were before this build" onClick={() => s.undoBuild()}>
                <Icon name="undo" size={18} /> Undo build
              </button>
            )}
          </div>
          {report.orphans.length > 0 && (
            <>
              <p className="hint warn">
                No longer in the sketch (kept; delete them in the Maps list if you don't want them): {report.orphans.map(name).join(", ")}.
              </p>
            </>
          )}
        </div>
      )}
      {built && !report && <p className="hint">Building again updates the maps: their size, entrances, connections, warps, region map section, levels and HMs. What you've drawn or generated on them stays.</p>}
    </section>
  );
}

/** Buttons to open the maps made from a place. */
export function PlaceMaps({ mapIds }: { mapIds: string[] }) {
  const s = useStore();
  const maps = mapIds.map((id) => s.region.maps.find((m) => m.id === id)).filter((m) => !!m);
  if (!maps.length) return null;
  return (
    <div className="field-row wrap">
      {maps.map((m) => (
        <button key={m.id} className="secondary" title={`Open ${m.name} (${m.width}×${m.height})`} onClick={() => s.openMap(m.id)}>
          Open {m.name}
        </button>
      ))}
    </div>
  );
}
