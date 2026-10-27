// The Zones tab: an optional plan for a map before it's generated. Paint areas
// as a biome, water, a boundary along an edge, or keep-clear ground; the
// generator follows them. Soft zones are followed loosely, hard ones exactly.

import { useState } from "react";
import { useStore } from "../store";
import { BIOMES, EDGES } from "../../core/model";
import type { Edge, Zone } from "../../core/model";
import { BIOME_NAMES, BOUNDARY_LABELS, BOUNDARY_TYPES, WATER_LABELS, WATER_TYPES, userZones } from "../../core/zones";
import type { ZoneKind } from "../../core/zones";
import { areaCells } from "../../core/selection";
import { zoneColor } from "../zoneColors";
import { NumberField } from "./NumberField";
import { Icon } from "./icons";

const EDGE_NAMES: Record<Edge, string> = { north: "North (top)", south: "South (bottom)", east: "East (right)", west: "West (left)" };

const NEW_ZONES: Array<{ kind: ZoneKind; label: string; tip: string }> = [
  { kind: "biome", label: "Biome area", tip: "An area of a different biome, e.g. wetland in the south of a meadow route." },
  { kind: "water", label: "Water", tip: "Where water must be: lake, pond, river, ocean or marsh." },
  { kind: "edge", label: "Boundary", tip: "A boundary you paint, e.g. a cliff line or forest wall. For a stretch of the map edge, use the form below." },
  { kind: "keep_clear", label: "Keep clear", tip: "Walkable ground with no water or trees: a clearing, a town lot, a landmark." },
];

export function ZonesPanel() {
  const s = useStore();
  const map = s.currentMap!;
  const zones = userZones(map);
  const [edge, setEdge] = useState<Edge>("east");
  const along = edge === "north" || edge === "south" ? map.width : map.height;
  const across = edge === "north" || edge === "south" ? map.height : map.width;
  const [from, setFrom] = useState(0);
  const [to, setTo] = useState(along - 1);
  const [depth, setDepth] = useState(Math.max(3, Math.round(across * 0.25)));
  const [boundary, setBoundary] = useState<string>("coast");

  const startZone = (kind: ZoneKind) => {
    // A new zone starts as the current selection, if there is one; otherwise you paint it.
    const cells = s.selection ? areaCells(map, s.selection) : [];
    s.addZone(kind, {}, cells);
  };

  return (
    <div className="zones-panel" aria-label="Zones">
      <p className="hint">
        Optional: plan parts of the map before you generate. The generator follows your zones; anything left unzoned is up to it. Pick a zone, then paint it with the Zones tool (Z), or select an area first and
        start a zone from it.
      </p>

      <section className="terrain-group">
        <h3>New zone</h3>
        <div className="terrain-grid">
          {NEW_ZONES.map((n) => (
            <button key={n.kind} className="terrain-item" title={n.tip + (s.selection ? " It starts as the selected area." : " Then paint it on the map.")} onClick={() => startZone(n.kind)}>
              <span className="swatch">
                <Icon name="plus" size={16} />
              </span>
              <span className="terrain-label">{n.label}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="terrain-group">
        <h3>Along a map edge</h3>
        <p className="hint">For example: the east edge is coast from y 10 to y 40, 8 cells deep.</p>
        <div className="field-row wrap">
          <label className="field">
            <span>Edge</span>
            <select
              value={edge}
              onChange={(e) => {
                const next = e.target.value as Edge;
                setEdge(next);
                setFrom(0);
                setTo((next === "north" || next === "south" ? map.width : map.height) - 1);
              }}
            >
              {EDGES.map((e) => (
                <option key={e} value={e}>
                  {EDGE_NAMES[e]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Type</span>
            <select value={boundary} onChange={(e) => setBoundary(e.target.value)}>
              {BOUNDARY_TYPES.map((b) => (
                <option key={b} value={b}>
                  {BOUNDARY_LABELS[b]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="field-row wrap">
          <label className="field small" title={edge === "north" || edge === "south" ? "First x along the edge" : "First y along the edge"}>
            <span>From {edge === "north" || edge === "south" ? "x" : "y"}</span>
            <NumberField min={0} max={along - 1} value={from} onChange={setFrom} />
          </label>
          <label className="field small" title={edge === "north" || edge === "south" ? "Last x along the edge" : "Last y along the edge"}>
            <span>To</span>
            <NumberField min={0} max={along - 1} value={to} onChange={setTo} />
          </label>
          <label className="field small" title="How many cells in from the edge">
            <span>Depth</span>
            <NumberField min={1} max={across} value={depth} onChange={setDepth} />
          </label>
        </div>
        <button className="secondary wide" onClick={() => s.addEdgeZone(boundary, edge, from, to, depth)}>
          Add edge zone
        </button>
      </section>

      <section className="terrain-group">
        <h3>Zones on this map</h3>
        {zones.length === 0 && <p className="hint">None yet.</p>}
        {zones.map((z) => (
          <ZoneRow key={z.id} z={z} />
        ))}
        {s.activeZone && (
          <>
            <div className="segmented" role="group" aria-label="Paint or erase">
              <button className={!s.zoneErase ? "active" : ""} aria-pressed={!s.zoneErase} title="Painting adds cells to the zone" onClick={() => s.setZoneErase(false)}>
                Paint
              </button>
              <button className={s.zoneErase ? "active" : ""} aria-pressed={s.zoneErase} title="Painting takes cells away from the zone" onClick={() => s.setZoneErase(true)}>
                Erase
              </button>
            </div>
            <button className="secondary wide" disabled={!s.selection} title="Add the selected cells to this zone (or take them away, in Erase)" onClick={() => s.selectionToZone()}>
              {s.zoneErase ? "Take the selection out of this zone" : "Add the selection to this zone"}
            </button>
          </>
        )}
      </section>
    </div>
  );
}

function ZoneRow({ z }: { z: Zone }) {
  const s = useStore();
  const active = s.activeZoneId === z.id && s.tool === "zones";
  const cells = z.mask.data.reduce((a, b) => a + b, 0);
  return (
    <div className={`zone-row ${active ? "active" : ""}`}>
      <div className="zone-head">
        <span className="swatch" style={{ background: zoneColor(z) }} />
        <b>{z.name}</b>
        <span className="hint">{cells} cells</span>
        <span className="spacer" />
        <button className={`icon-button ${active ? "active" : ""}`} title="Paint this zone on the map (Zones tool)" aria-label={`Paint ${z.name}`} aria-pressed={active} onClick={() => s.setActiveZone(active ? null : z.id)}>
          <Icon name="pencil" size={18} />
        </button>
        <button className="icon-button" title="Delete this zone" aria-label={`Delete ${z.name}`} onClick={() => s.deleteZone(z.id)}>
          <Icon name="trash" size={18} />
        </button>
      </div>
      {z.kind === "biome" && (
        <select value={String(z.data.biome)} aria-label="Biome" onChange={(e) => s.updateZone(z.id, { data: { biome: e.target.value } })}>
          {BIOMES.map((b) => (
            <option key={b} value={b}>
              {BIOME_NAMES[b]}
            </option>
          ))}
        </select>
      )}
      {z.kind === "water" && (
        <div className="field-row">
          <select value={String(z.data.water)} aria-label="Kind of water" onChange={(e) => s.updateZone(z.id, { data: { water: e.target.value } })}>
            {WATER_TYPES.map((w) => (
              <option key={w} value={w}>
                {WATER_LABELS[w]}
              </option>
            ))}
          </select>
          {z.data.water !== "marsh" && (
            <select value={String(z.data.depth)} aria-label="Depth" title="Deep water needs Surf; shallow water can be walked through" onChange={(e) => s.updateZone(z.id, { data: { depth: e.target.value } })}>
              <option value="deep">Deep (Surf)</option>
              <option value="shallow">Shallow (walk)</option>
            </select>
          )}
        </div>
      )}
      {z.kind === "edge" && (
        <select value={String(z.data.boundary)} aria-label="Boundary type" onChange={(e) => s.updateZone(z.id, { data: { boundary: e.target.value } })}>
          {BOUNDARY_TYPES.map((b) => (
            <option key={b} value={b}>
              {BOUNDARY_LABELS[b]}
            </option>
          ))}
        </select>
      )}
      <label className="check" title="Hard: followed exactly, cell for cell. Soft: the generator follows the general shape with natural edges.">
        <input type="checkbox" checked={z.hard} onChange={(e) => s.updateZone(z.id, { hard: e.target.checked })} />
        Exact edges (hard)
      </label>
      {!z.hard && (
        <label className="slider" title="How loosely the edges are followed: 0 = exactly, 100 = up to 4 cells in or out.">
          <span>
            Fuzziness <b>{Math.round(z.fuzziness * 100)}</b>
          </span>
          <input type="range" min={0} max={1} step={0.05} value={z.fuzziness} onChange={(e) => s.updateZone(z.id, { fuzziness: Number(e.target.value) })} />
        </label>
      )}
    </div>
  );
}
