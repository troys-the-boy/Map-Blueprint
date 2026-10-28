// The draft in-game region map, in the sketch panel: a live picture of the
// 28 × 15 grid, its sections, and downloads in pokeemerald's own formats.

import { useEffect, useRef } from "react";
import type { RegionMapDraft } from "../../core/regionMap";
import { draftRegionMap, layoutHeader, sectionsJson } from "../../core/regionMap";
import { deliverFile } from "../files";
import { sketchEditor } from "../sketchEditor";
import { store, useStore } from "../store";
import { sectionColor } from "../zoneColors";
import type { Sketch } from "../../core/sketch";
import { parentOf } from "../../core/sketch";

const SQUARE = 10;

export function RegionMapPanel() {
  const s = useStore();
  const e = sketchEditor;
  const sketch = s.region.sketch;
  if (!sketch) return null;
  const draft = draftRegionMap(sketch);
  const manual = draft.sections.filter((x) => x.manual).length;
  const picked = draft.sections.find((x) => x.placeId === e.selectedId);

  return (
    <details className="sketch-section" open>
      <summary title="The Town Map / Fly map, worked out from the sketch">Region map</summary>
      <Thumbnail draft={draft} selected={e.selectedId} line={journeyOnMap(sketch, draft)} />
      <p className="hint">
        The in-game map is {draft.width} × {draft.height} squares (as in Emerald). It follows the sketch as you draw. Tap <b>Region map</b> in the tool strip to see it over the sketch; there, drag a section to move it or a corner to resize it, and it stays where you put it.
      </p>
      {picked && (
        <p className="hint">
          <b>{picked.name}</b> ({picked.id}): x {picked.x}, y {picked.y}, {picked.w}×{picked.h}
          {picked.inside ? ", on its route's square" : ""}
          {picked.manual ? ", placed by hand." : "."}{" "}
          {picked.manual && (
            <button className="link-button" onClick={() => e.resetSection(picked.placeId)}>
              Follow the sketch again
            </button>
          )}
        </p>
      )}
      {draft.problems.map((p, k) => (
        <p key={k} className="hint warn">
          {p}
        </p>
      ))}
      <div className="field-row wrap">
        <button className="secondary" disabled={!draft.sections.length} title="Download region_map_sections.json: each section's id, name and rectangle, as in pokeemerald's src/data/region_map/region_map_sections.json" onClick={() => void deliverFile(store, "region_map_sections.json", "application/json", sectionsJson(draft))}>
          Sections (.json)
        </button>
        <button className="secondary" disabled={!draft.sections.length} title="Download the grid of sections, as in pokeemerald's src/data/region_map/region_map_layout.h" onClick={() => void deliverFile(store, "region_map_layout.h", "text/plain", layoutHeader(draft))}>
          Layout (.h)
        </button>
      </div>
      {manual > 0 && (
        <button className="secondary" onClick={() => e.resetAllSections()}>
          Let all {manual} hand-placed sections follow the sketch
        </button>
      )}
    </details>
  );
}

/** The region map as coloured squares, redrawn whenever the sketch changes. */
/**
 * The journey on the region map: the middle of each stop's section, in order (a forest or cave
 * without its own section uses its route's or town's).
 */
function journeyOnMap(sketch: Sketch, draft: RegionMapDraft): number[] {
  const out: number[] = [];
  for (const id of sketch.journey.stops) {
    const place = sketch.places.find((p) => p.id === id);
    if (!place) continue;
    const sec = draft.sections.find((x) => x.placeId === id) ?? draft.sections.find((x) => x.placeId === parentOf(sketch, place)?.id);
    if (!sec || !sec.w) continue;
    const x = sec.x + sec.w / 2;
    const y = sec.y + sec.h / 2;
    if (out.length >= 2 && out[out.length - 2] === x && out[out.length - 1] === y) continue;
    out.push(x, y);
  }
  return out;
}

function Thumbnail({ draft, selected, line }: { draft: RegionMapDraft; selected: string | null; line: number[] }) {
  const el = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = el.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = draft.width * SQUARE;
    const h = draft.height * SQUARE;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#1c2a33";
    ctx.fillRect(0, 0, w, h);
    for (let gy = 0; gy < draft.height; gy++)
      for (let gx = 0; gx < draft.width; gx++) {
        const k = draft.layout[gy * draft.width + gx];
        if (k < 0) continue;
        ctx.fillStyle = sectionColor(k);
        ctx.globalAlpha = draft.sections[k].placeId === selected ? 1 : 0.75;
        ctx.fillRect(gx * SQUARE + 0.5, gy * SQUARE + 0.5, SQUARE - 1, SQUARE - 1);
      }
    ctx.globalAlpha = 1;
    for (const sec of draft.sections) {
      if (!sec.inside && sec.placeId !== selected) continue;
      ctx.strokeStyle = sec.placeId === selected ? "#ffffff" : "#0f1417";
      ctx.lineWidth = sec.placeId === selected ? 2 : 1.5;
      ctx.strokeRect(sec.x * SQUARE + 1, sec.y * SQUARE + 1, sec.w * SQUARE - 2, sec.h * SQUARE - 2);
    }
    if (line.length >= 4) {
      ctx.strokeStyle = "#f0c25a";
      ctx.lineWidth = 2;
      ctx.lineJoin = "round";
      ctx.beginPath();
      for (let k = 0; k < line.length; k += 2) (k ? ctx.lineTo : ctx.moveTo).call(ctx, line[k] * SQUARE, line[k + 1] * SQUARE);
      ctx.stroke();
    }
  }, [draft, selected, line.join(",")]);
  return (
    <canvas
      ref={el}
      className="region-thumb"
      style={{ width: draft.width * SQUARE, height: draft.height * SQUARE }}
      aria-label={`Region map: ${draft.sections.map((x) => x.name).join(", ") || "empty"}`}
      onClick={(ev) => {
        const r = ev.currentTarget.getBoundingClientRect();
        const gx = Math.floor(((ev.clientX - r.left) / r.width) * draft.width);
        const gy = Math.floor(((ev.clientY - r.top) / r.height) * draft.height);
        const k = draft.layout[gy * draft.width + gx];
        sketchEditor.select(k >= 0 ? draft.sections[k].placeId : null);
      }}
    />
  );
}
