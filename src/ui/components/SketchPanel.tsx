// The region sketch's side panel: what the current tool does, the picked
// place's details, problems, the sketch's size and segment length, and the
// underlay (a PDF or image to trace over).

import { useState } from "react";
import type { Biome } from "../../core/model";
import type { SketchArea } from "../../core/sketch";
import { MAX_SKETCH_SIDE, SKETCH_AREAS, SKETCH_CELL, isOutdoor, parentOf, placePieces, resizeSketch } from "../../core/sketch";
import { checkMapSize } from "../../core/sizeRule";
import { sketchEditor } from "../sketchEditor";
import { store, useStore } from "../store";
import { ReferenceImageSection, fitWhenReady } from "./ReferenceImageSection";
import { HEIGHT_COLORS, SKETCH_AREA_COLORS } from "../zoneColors";
import { TERRAIN_SHAPES } from "../../core/regionTerrain";
import type { HeightBrush, TerrainShape } from "../../core/regionTerrain";
import { MAX_SEED } from "../../core/rng";
import { NumberField } from "./NumberField";
import { Icon } from "./icons";
import { JourneyPanel } from "./JourneyPanel";
import { BuildPanel, PlaceMaps } from "./BuildPanel";
import { sketchProblems } from "../sketchProblems";
import { RegionMapPanel } from "./RegionMapPanel";

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
/** The height brush's choices, lowest first. */
const HEIGHT_CHOICES: Array<{ value: HeightBrush; label: string; color: string }> = [
  { value: "sea", label: "Sea", color: SKETCH_AREA_COLORS.sea },
  { value: 0, label: "Lowland", color: HEIGHT_COLORS[0] },
  { value: 1, label: "Hills", color: HEIGHT_COLORS[1] },
  { value: 2, label: "Highland", color: HEIGHT_COLORS[2] },
  { value: 3, label: "Peaks", color: HEIGHT_COLORS[3] },
];
const SHAPE_LABELS: Record<TerrainShape, string> = {
  island: "Island: sea all round",
  coast: "Coast: sea along one side",
  valley: "Valley: high ground both sides",
  range: "Mountain range: a ridge across",
};


export function SketchPanel({ onClose }: { onClose?: () => void }) {
  const s = useStore();
  const e = sketchEditor;
  const sketch = s.region.sketch;
  if (!sketch) return null;
  const target = s.region.settings.targetSegmentLength;
  const limits = s.region.settings.engineLimits;
  const issues = sketchProblems(s.region);
  const sel = e.selected;
  const river = e.selectedRiver;
  const riverNo = river ? sketch.rivers.indexOf(river) + 1 : 0;

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

      <BuildPanel errors={issues.filter((i) => i.severity === "error").length} />

      {river && (
        <section className="sketch-section">
          <h3>River {riverNo}</h3>
          <label className="field inline" title="How wide the river is, in metatiles.">
            <span>Width</span>
            <NumberField min={1} max={12} value={river.width} onChange={(v) => e.setSelectedRiverWidth(v)} />
          </label>
          <p className="hint">
            Drag a point to move it, or drag the river to move all of it. Tap a + to add a point there. Pick a point, then Remove point (or press Delete) to take it off.
          </p>
          <div className="field-row wrap">
            <button
              className="secondary"
              disabled={e.selectedPoint < 0 || river.points.length <= 4}
              title={river.points.length <= 4 ? "A river needs at least two points." : e.selectedPoint < 0 ? "Pick a point first." : "Take the picked point off the river."}
              onClick={() => e.removeSelectedPoint()}
            >
              Remove point
            </button>
            <button className="secondary" title="Delete this river" onClick={() => e.deleteRiver(river.id)}>
              <Icon name="trash" size={18} /> Delete river
            </button>
          </div>
        </section>
      )}

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
              <label className="check" title="Off: it counts as part of its route or town, and shows that name when you enter it. On: it gets its own region map section (its own name when you enter it, and the player's marker on one of its route's squares), as Petalburg Woods and Granite Cave do. The fly map still names the route under that square.">
                <input type="checkbox" checked={sel.ownSection} onChange={(ev) => e.updateSelected({ ownSection: ev.target.checked })} />
                Own region map section
              </label>
            </>
          )}
          <PlaceMaps mapIds={sel.mapIds} />
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

      <JourneyPanel />

      <RegionMapPanel />

      <TerrainSection />

      {sketch.rivers.length > 0 && (
        <details className="sketch-section">
          <summary>Rivers ({sketch.rivers.length})</summary>
          {sketch.rivers.map((r, k) => (
            <div key={r.id} className={`stretch-row ${r.id === e.selectedRiverId ? "active" : ""}`}>
              <button className="link-button" title="Pick this river to change it" onClick={() => e.selectRiver(r.id)}>
                River {k + 1}, {r.width} wide
              </button>
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


/** The lie of the land: showing it, generating it, and the rivers and lakes it suggests. */
function TerrainSection() {
  const s = useStore();
  const e = sketchEditor;
  const [shape, setShape] = useState<TerrainShape>("island");
  const [seed, setSeed] = useState(s.region.seed);
  const w = e.water;
  return (
    <details className="sketch-section">
      <summary title="Heights, landforms, and where rivers and lakes would be">Terrain</summary>
      <p className="hint">
        Shape the land of the whole region here: paint heights by hand, or generate a landform and change it. Build the maps then gives each map its hills where the land under it is higher than its lowest part.
      </p>
      <div className="field-row wrap">
        <button className={`secondary ${e.tool === "height" ? "active" : ""}`} title="Paint heights with a brush: sea, lowland, hills, highland, peaks." onClick={() => e.setTool("height")}>
          Paint heights
        </button>
        <label className="check" title="Show the heights on the sketch: higher ground is shaded, with a line wherever the height changes.">
          <input type="checkbox" checked={e.showHeights} onChange={() => e.toggleHeights()} />
          Show heights
        </label>
      </div>
      <label className="field" title="The overall shape of the land to generate.">
        <span>Landform</span>
        <select value={shape} onChange={(ev) => setShape(ev.target.value as TerrainShape)}>
          {TERRAIN_SHAPES.map((t) => (
            <option key={t} value={t}>
              {SHAPE_LABELS[t]}
            </option>
          ))}
        </select>
      </label>
      <div className="field-row">
        <label className="field grow" title="The seed decides the shape. Same seed + same landform = the same land.">
          <span>Seed</span>
          <NumberField min={0} max={MAX_SEED} value={seed} onChange={setSeed} />
        </label>
        <button className="secondary" title="Pick a new random seed" onClick={() => setSeed(Math.floor(Math.random() * MAX_SEED))}>
          New seed
        </button>
      </div>
      <button className="secondary wide" title="Fill the sketch with this landform. It replaces every height and the sea; painted biomes and lakes are kept where they're still on land. Undo brings the old land back." onClick={() => e.generateTerrain(seed, shape)}>
        Generate terrain
      </button>
      <button className="secondary wide" title="Work out where water would run over these heights: downhill to the sea, a lake or the edge of the sketch. Nothing is added until you say so." onClick={() => e.suggestWater(seed)}>
        Suggest rivers and lakes
      </button>
      {w && w.reason && <p className="hint warn">{w.reason}</p>}
      {w && (w.rivers.length > 0 || w.lakes.length > 0) && (
        <>
          <p className="hint">Shown dashed and numbered on the sketch. Add the ones you want: an added river is an ordinary river you can reshape with Pick and move.</p>
          {w.rivers.map((r, k) => (
            <div key={`r${k}`} className="stretch-row">
              <span>
                River {k + 1}, {r.width} wide
              </span>
              <span className="field-row">
                <button className="secondary" title="Add this river to the sketch" onClick={() => e.acceptWater("river", k)}>
                  Add
                </button>
                <button className="icon-button" title="Don't add this river" aria-label={`Dismiss river ${k + 1}`} onClick={() => e.dismissWater("river", k)}>
                  <Icon name="close" size={18} />
                </button>
              </span>
            </div>
          ))}
          {w.lakes.map((cells, k) => (
            <div key={`l${k}`} className="stretch-row">
              <span>
                Lake L{k + 1}, {cells.length} squares
              </span>
              <span className="field-row">
                <button className="secondary" title="Paint this lake onto the sketch" onClick={() => e.acceptWater("lake", k)}>
                  Add
                </button>
                <button className="icon-button" title="Don't add this lake" aria-label={`Dismiss lake ${k + 1}`} onClick={() => e.dismissWater("lake", k)}>
                  <Icon name="close" size={18} />
                </button>
              </span>
            </div>
          ))}
          <div className="field-row wrap">
            <button className="primary" title="Add every suggestion (one Undo takes them all off again)" onClick={() => e.acceptAllWater()}>
              Add all
            </button>
            <button className="secondary" title="Dismiss every suggestion" onClick={() => e.dismissWater("river", -1)}>
              Dismiss all
            </button>
          </div>
        </>
      )}
    </details>
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
    case "height":
      return (
        <section className="sketch-section">
          <h3>Heights</h3>
          <div className="terrain-grid">
            {HEIGHT_CHOICES.map((h) => (
              <button key={h.label} className={`terrain-item ${e.band === h.value ? "active" : ""}`} onClick={() => e.setBand(h.value)}>
                <span className="swatch" style={{ background: h.color }} />
                <span className="terrain-label">{h.label}</span>
              </button>
            ))}
          </div>
          <p className="hint">Paint the lie of the land, lowest to highest. A line shows wherever the height changes. Sea here is the same sea as the Paint tool's; painting land over the sea makes it land.</p>
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
    case "journey":
      return <p className="hint tool-help">Journey: tap the places in the order the player first visits them (a forest or cave: tap its pin). Tap the last stop again to take it off.</p>;
    case "sections":
      return <p className="hint tool-help">Region map: tap a section to pick it, drag it to move it, or drag a picked section's corner to resize it. Sections you move stay put (✋); the rest follow the sketch.</p>;
    default:
      return null;
  }
}

function UnderlaySection() {
  const s = useStore();
  const e = sketchEditor;
  const u = s.region.sketch?.underlay ?? null;
  return (
    <ReferenceImageSection
      image={u}
      slot="sketch"
      where="the sketch"
      summary="Drawing to trace"
      intro="Put your own sketch (a PDF or a picture) under the grid, scale it, and trace the towns and routes over it."
      onReady={() => store.sketchChanged(false)}
      onLoad={(image, isNew) => {
        e.edit((sk) => {
          sk.underlay = image;
        });
        // Fitting a new drawing across the sketch is part of loading it, not an undo step of its own.
        if (isNew)
          fitWhenReady("sketch", () => store.region.sketch?.underlay, (pic) => {
            const sk = store.region.sketch!;
            Object.assign(sk.underlay!, { scale: sk.width / pic.width });
            store.sketchChanged(true);
          });
      }}
      onPatch={(patch) => e.setUnderlay(patch)}
      onRemove={() => e.setUnderlay(null)}
      onRotate={(deg, pic) => e.rotateUnderlay(deg, pic.width, pic.height)}
      onFit={(pic) => e.fitUnderlay(pic.width)}
      moving={e.tool === "underlay"}
      onToggleMove={() => e.setTool(e.tool === "underlay" ? "select" : "underlay")}
      onStartCalibration={() => e.startCalibration()}
    />
  );
}
