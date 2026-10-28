// The region sketch's side panel: what the current tool does, the picked
// place's details, problems, the sketch's size and segment length, and the
// underlay (a PDF or image to trace over).

import { useState } from "react";
import type { Biome } from "../../core/model";
import type { SketchArea } from "../../core/sketch";
import { MAX_SKETCH_SIDE, SKETCH_AREAS, SKETCH_CELL, isOutdoor, parentOf, placePieces, resizeSketch, sketchIssues } from "../../core/sketch";
import { checkMapSize } from "../../core/sizeRule";
import { sketchEditor } from "../sketchEditor";
import { store, useStore } from "../store";
import { underlayError, underlayPicture } from "../underlay";
import { SKETCH_AREA_COLORS } from "../zoneColors";
import { NumberField } from "./NumberField";
import { Icon } from "./icons";

const BIOME_LABELS: Record<Biome, string> = {
  temperate_rainforest: "Temperate rainforest",
  coastal: "Coastal",
  wetland: "Wetland",
  alpine: "Alpine",
  meadow: "Meadow",
  urban_edge: "Urban edge",
};
const AREA_LABELS: Record<SketchArea, string> = { ...BIOME_LABELS, lake: "Lake", sea: "Sea" };
const KIND_LABELS = { town: "Town", route: "Route", forest: "Forest", cave: "Cave" } as const;

/** Largest file kept inside the project (it's saved with it). */
const UNDERLAY_MAX_BYTES = 15 * 1024 * 1024;

export function SketchPanel({ onClose }: { onClose?: () => void }) {
  const s = useStore();
  const e = sketchEditor;
  const sketch = s.region.sketch;
  if (!sketch) return null;
  const target = s.region.settings.targetSegmentLength;
  const limits = s.region.settings.engineLimits;
  const issues = sketchIssues(sketch, target, limits);
  const sel = e.selected;

  return (
    <aside className="side-panel" aria-label="Sketch panel">
      <div className="panel-head">
        <h2>Region sketch</h2>
        {onClose && (
          <button className="icon-button" aria-label="Close panel" title="Close" onClick={onClose}>
            <Icon name="close" />
          </button>
        )}
      </div>

      <ToolHelp />

      {sel && (
        <section className="sketch-section">
          <h3>{KIND_LABELS[sel.kind]}</h3>
          <label className="field">
            <span>Name</span>
            <input type="text" value={sel.name} maxLength={60} onChange={(ev) => e.updateSelected({ name: ev.target.value })} />
          </label>
          {isOutdoor(sel.kind) ? (
            <>
              {sel.rects.map((r, k) => {
                const pieces = placePieces({ ...sel, rects: [r] }, target);
                const fits = pieces.every((p) => checkMapSize(p.w, p.h, limits).ok);
                return (
                  <div key={k} className="stretch-row">
                    <span>
                      {sel.kind === "route" ? `Stretch ${k + 1}: ` : "Size: "}
                      <b className={fits ? "" : "bad"}>
                        {r.w}×{r.h}
                      </b>
                      {pieces.length > 1 && ` → ${pieces.length} segments of ${pieces.map((p) => (r.h >= r.w ? p.h : p.w)).join(", ")}`}
                    </span>
                    {sel.kind === "route" && sel.rects.length > 1 && (
                      <button className="icon-button" title="Remove this stretch" aria-label={`Remove stretch ${k + 1}`} onClick={() => e.deleteStretch(k)}>
                        <Icon name="close" size={18} />
                      </button>
                    )}
                  </div>
                );
              })}
              {sel.kind === "route" && <p className="hint">To carry the route on or bend it, keep it picked and draw a rectangle with the Route tool touching its last stretch.</p>}
            </>
          ) : (
            <>
              <div className="field-row">
                <label className="field inline" title="The map's width in metatiles.">
                  <span>Width</span>
                  <NumberField min={10} max={256} value={sel.size?.w ?? 40} onChange={(v) => e.updateSelected({ size: { w: v, h: sel.size?.h ?? 40 } })} />
                </label>
                <label className="field inline" title="The map's height in metatiles.">
                  <span>Height</span>
                  <NumberField min={10} max={256} value={sel.size?.h ?? 40} onChange={(v) => e.updateSelected({ size: { w: sel.size?.w ?? 40, h: v } })} />
                </label>
              </div>
              <p className="hint">
                In {parentOf(sketch, sel)?.name ?? "no route or town yet"}. {sel.pins.length} entrance{sel.pins.length === 1 ? "" : "s"}: drag a pin to move it.
              </p>
              {sel.pins.map((_, k) => (
                <div key={k} className="stretch-row">
                  <span>Entrance {k + 1}</span>
                  <button className="icon-button" title="Remove this entrance" aria-label={`Remove entrance ${k + 1}`} onClick={() => e.removePin(k)}>
                    <Icon name="close" size={18} />
                  </button>
                </div>
              ))}
              <button className="secondary" title="Tap the route or town where another entrance is (a forest that splits a route has one on each side)." onClick={() => e.setTool("pin")}>
                Add an entrance
              </button>
              <label className="check" title="On the in-game region map: off = part of its route or town (the fly map shows that name); on = its own location on one of their squares.">
                <input type="checkbox" checked={sel.ownSection} onChange={(ev) => e.updateSelected({ ownSection: ev.target.checked })} />
                Own region map section
              </label>
            </>
          )}
          <button className="secondary danger" onClick={() => e.deleteSelected()}>
            <Icon name="trash" size={18} /> Delete {sel.name}
          </button>
        </section>
      )}

      <section className="sketch-section">
        <h3>Check</h3>
        {issues.length === 0 ? (
          <p className="check-summary good">✓ No problems found.</p>
        ) : (
          <ul className="issue-list">
            {issues.map((issue, k) => (
              <li key={k}>
                <button className={`issue ${issue.severity}`} disabled={!issue.placeId} title={issue.placeId ? "Pick this place" : undefined} onClick={() => e.select(issue.placeId)}>
                  <span className="issue-badge">{issue.severity === "error" ? "Error" : "Warning"}</span>
                  <span>{issue.message}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {sketch.rivers.length > 0 && (
        <details className="sketch-section">
          <summary>Rivers ({sketch.rivers.length})</summary>
          {sketch.rivers.map((r, k) => (
            <div key={r.id} className="stretch-row">
              <span>
                River {k + 1}, {r.width} wide
              </span>
              <button className="icon-button" title="Delete this river" aria-label={`Delete river ${k + 1}`} onClick={() => e.deleteRiver(r.id)}>
                <Icon name="trash" size={18} />
              </button>
            </div>
          ))}
        </details>
      )}

      <UnderlaySection />

      <details className="sketch-section">
        <summary>Sketch settings</summary>
        <label className="field inline" title="Routes longer than this (in metatiles) are split into segments. One map per segment.">
          <span>Segment length</span>
          <NumberField min={10} max={512} value={target} onChange={(v) => e.setSegmentLength(v)} />
        </label>
        <div className="field-row">
          <label className="field inline" title="The sketch's width in metatiles.">
            <span>Width</span>
            <NumberField min={SKETCH_CELL} max={MAX_SKETCH_SIDE} value={sketch.width} onChange={(v) => e.edit((sk) => resizeSketch(sk, v, sk.height))} />
          </label>
          <label className="field inline" title="The sketch's height in metatiles.">
            <span>Height</span>
            <NumberField min={SKETCH_CELL} max={MAX_SKETCH_SIDE} value={sketch.height} onChange={(v) => e.edit((sk) => resizeSketch(sk, sk.width, v))} />
          </label>
        </div>
        <p className="hint">Each square of the grid is {SKETCH_CELL}×{SKETCH_CELL} metatiles; the stronger lines are every 50. A GBA screen is 15×10.</p>
      </details>
    </aside>
  );
}


/** What the current tool does, and its settings. */
function ToolHelp() {
  const e = sketchEditor;
  const [distance, setDistance] = useState(90);
  switch (e.tool) {
    case "paint":
      return (
        <section className="sketch-section">
          <h3>Paint</h3>
          <div className="terrain-grid">
            {SKETCH_AREAS.map((a) => (
              <button key={a} className={`terrain-item ${e.area === a ? "active" : ""}`} onClick={() => e.setArea(a)}>
                <span className="swatch" style={{ background: SKETCH_AREA_COLORS[a] }} />
                <span className="terrain-label">{AREA_LABELS[a]}</span>
              </button>
            ))}
          </div>
          <p className="hint">Biomes set the look of the maps they cover. Lakes and sea become water on the maps; the edge of the sea is the coastline.</p>
        </section>
      );
    case "river":
      return (
        <section className="sketch-section">
          <h3>River</h3>
          <label className="field inline" title="How wide the river is, in metatiles.">
            <span>Width</span>
            <NumberField min={1} max={12} value={e.riverWidth} onChange={(v) => e.setRiverWidth(v)} />
          </label>
          <p className="hint">Tap points along the river. Tap the last point again to finish.</p>
          {e.riverPoints && (
            <div className="field-row">
              <button className="primary" disabled={e.riverPoints.length < 4} onClick={() => e.finishRiver()}>
                Finish river
              </button>
              <button className="secondary" onClick={() => e.cancelRiver()}>
                Cancel
              </button>
            </div>
          )}
        </section>
      );
    case "pin":
      return <p className="hint tool-help">Tap the route or town where the new entrance is.</p>;
    case "calibrate":
      return (
        <section className="sketch-section">
          <h3>Set the drawing's scale</h3>
          <p className="hint">
            {e.calibration.length < 2
              ? `Tap ${e.calibration.length === 0 ? "a point" : "a second point"} on the drawing whose distance you know (say, the two ends of a route).`
              : "How far apart are A and B, in metatiles?"}
          </p>
          {e.calibration.length === 2 && (
            <div className="field-row">
              <NumberField min={1} max={MAX_SKETCH_SIDE} value={distance} onChange={setDistance} />
              <button className="primary" onClick={() => e.applyCalibration(distance)}>
                Set scale
              </button>
            </div>
          )}
          <button className="secondary" onClick={() => e.setTool("select")}>
            Cancel
          </button>
        </section>
      );
    case "town":
      return <p className="hint tool-help">Drag a rectangle for the town. It snaps to the grid and shows its size.</p>;
    case "route":
      return <p className="hint tool-help">Drag a rectangle for each straight stretch. With a route picked, a rectangle touching its last stretch carries it on (a bend, or more straight road).</p>;
    case "forest":
    case "cave":
      return <p className="hint tool-help">Tap the route or town where the {e.tool}'s entrance is. Its own size is set in this panel once it's placed.</p>;
    case "underlay":
      return <p className="hint tool-help">Drag the drawing to move it.</p>;
    default:
      return null;
  }
}

function UnderlaySection() {
  const s = useStore();
  const e = sketchEditor;
  const u = s.region.sketch?.underlay ?? null;
  const pic = underlayPicture(u, () => store.sketchChanged(false));
  const error = underlayError();

  const load = (file: File) => {
    if (file.size > UNDERLAY_MAX_BYTES) {
      store.setNotice({ kind: "error", text: `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The drawing is saved inside the project, so it can be at most ${UNDERLAY_MAX_BYTES / 1024 / 1024} MB. Try a smaller image or a one-page PDF.` });
      return;
    }
    const kind = file.type === "application/pdf" ? "pdf" : /^image\/(png|jpeg|webp|gif)$/.test(file.type) ? "image" : null;
    if (!kind) {
      store.setNotice({ kind: "error", text: "Pick a PDF or an image (PNG, JPG, WebP or GIF)." });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const data = String(reader.result);
      e.edit((sk) => {
        sk.underlay = { kind, name: file.name.slice(0, 200), data, page: 1, x: 0, y: 0, scale: 1, rotation: 0, opacity: 0.5, visible: true, locked: false };
      });
      fitWhenReady();
    };
    reader.readAsDataURL(file);
  };

  return (
    <details className="sketch-section" open={!!u}>
      <summary title="A PDF or image of your own map to trace over">Drawing to trace{u ? `: ${u.name}` : ""}</summary>
      {!u ? (
        <>
          <p className="hint">Put your own sketch (a PDF or a picture) under the grid, scale it, and trace the towns and routes over it. It's saved inside the project.</p>
          <label className="secondary file-button">
            Load a PDF or image…
            <input type="file" accept="application/pdf,image/png,image/jpeg,image/webp,image/gif" onChange={(ev) => ev.target.files?.[0] && load(ev.target.files[0])} hidden />
          </label>
        </>
      ) : (
        <>
          {error && <p className="hint bad">Couldn't show it: {error}</p>}
          <label className="check">
            <input type="checkbox" checked={u.visible} onChange={(ev) => e.setUnderlay({ visible: ev.target.checked })} />
            Show
          </label>
          <label className="slider">
            <span>
              Opacity <b>{Math.round(u.opacity * 100)}</b>
            </span>
            <input type="range" min={0.1} max={1} step={0.05} value={u.opacity} onChange={(ev) => e.setUnderlay({ opacity: Number(ev.target.value) })} />
          </label>
          {u.kind === "pdf" && (
            <label className="field inline" title="Which page of the PDF to show.">
              <span>Page</span>
              <NumberField min={1} max={9999} value={u.page} onChange={(v) => e.setUnderlay({ page: v })} />
            </label>
          )}
          <div className="field-row wrap">
            <button className="secondary" disabled={!pic} title="Tap two points on the drawing and say how many metatiles apart they are." onClick={() => e.startCalibration()}>
              Set scale…
            </button>
            <button className="secondary" disabled={!pic} title="Stretch the drawing across the sketch's width." onClick={() => pic && e.fitUnderlay(pic.width)}>
              Fit to sketch
            </button>
          </div>
          <div className="field-row wrap">
            <button className="secondary" disabled={!pic || u.locked} title="Turn a quarter to the left" onClick={() => pic && e.rotateUnderlay(u.rotation - 90, pic.width, pic.height)}>
              ↺ 90°
            </button>
            <button className="secondary" disabled={!pic || u.locked} title="Turn a quarter to the right" onClick={() => pic && e.rotateUnderlay(u.rotation + 90, pic.width, pic.height)}>
              ↻ 90°
            </button>
            <button className={`secondary ${e.tool === "underlay" ? "active" : ""}`} disabled={u.locked} title="Drag the drawing to move it" onClick={() => e.setTool(e.tool === "underlay" ? "select" : "underlay")}>
              Move
            </button>
          </div>
          <label className="slider" title="Turn it a little to line it up (degrees, clockwise).">
            <span>
              Turn <b>{Math.round(u.rotation)}°</b>
            </span>
            <input type="range" min={-180} max={180} step={1} value={u.rotation} disabled={!pic || u.locked} onChange={(ev) => pic && e.rotateUnderlay(Number(ev.target.value), pic.width, pic.height)} />
          </label>
          <label className="check" title="Locked: it can't be moved, scaled or turned by accident.">
            <input type="checkbox" checked={u.locked} onChange={(ev) => e.setUnderlay({ locked: ev.target.checked })} />
            Lock in place
          </label>
          <p className="hint">Scale: 1 metatile = {(1 / u.scale).toFixed(2)} {u.kind === "pdf" ? "points (1/72 inch)" : "pixels"} of the drawing.</p>
          <button className="secondary danger" onClick={() => e.setUnderlay(null)}>
            <Icon name="trash" size={18} /> Remove the drawing
          </button>
        </>
      )}
    </details>
  );
}

/** Once a new drawing has loaded, stretch it across the sketch. */
function fitWhenReady() {
  let tries = 0;
  const check = () => {
    const u = store.region.sketch?.underlay;
    if (!u) return;
    const pic = underlayPicture(u, () => undefined);
    if (pic) {
      // Fitting is part of loading it, not an undo step of its own.
      const s = store.region.sketch!;
      Object.assign(u, { scale: s.width / pic.width });
      store.sketchChanged(true);
    } else if (underlayError() === null && tries++ < 100) setTimeout(check, 100);
  };
  check();
}
