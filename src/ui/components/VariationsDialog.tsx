// Variations: the open map generated with several new seeds side by side, to
// pick the one you like. Each keeps your locked cells, placed things and zones.

import { useEffect, useRef } from "react";
import type { GenerateResult } from "../../core/generate";
import { TERRAIN_TYPES, getPalette } from "../../core/terrain";
import { useStore } from "../store";

/** Largest side of a preview, in screen pixels. */
const THUMB = 168;

function Thumbnail({ result, width, height, paletteId }: { result: GenerateResult; width: number; height: number; paletteId: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    // Draw at one pixel per cell; CSS scales it up without blurring.
    canvas.width = width;
    canvas.height = height;
    const colors = TERRAIN_TYPES.map((t) => getPalette(paletteId).colors[t.id] ?? "#ff00ff");
    const img = ctx.createImageData(width, height);
    for (let i = 0; i < width * height; i++) {
      const hex = colors[result.terrain[i]];
      img.data[i * 4] = parseInt(hex.slice(1, 3), 16);
      img.data[i * 4 + 1] = parseInt(hex.slice(3, 5), 16);
      img.data[i * 4 + 2] = parseInt(hex.slice(5, 7), 16);
      img.data[i * 4 + 3] = 255;
    }
    // Things on the map as small dots, so trainers and items show.
    for (const e of result.entities) {
      const k = (e.y * width + e.x) * 4;
      const [r, g, b] = e.kind === "trainer" ? [230, 70, 60] : [240, 200, 70];
      img.data[k] = r;
      img.data[k + 1] = g;
      img.data[k + 2] = b;
    }
    ctx.putImageData(img, 0, 0);
  }, [result, width, height, paletteId]);
  const k = Math.max(1, Math.floor(THUMB / Math.max(width, height)));
  return <canvas ref={ref} className="variation-thumb" style={{ width: width * k, height: height * k }} aria-hidden="true" />;
}

export function VariationsDialog() {
  const s = useStore();
  const map = s.currentMap;
  const v = s.variations;
  if (!map || !v || v.mapId !== map.id) return null;
  const waiting = s.variationsBusy ? 6 - v.items.length : 0;
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && s.closeVariations()}>
      <div className="modal wide" role="dialog" aria-modal="true" aria-labelledby="variations-title">
        <h2 id="variations-title">Variations of {map.name}</h2>
        <p className="hint">
          The same map and settings with new seeds. Your locked cells, placed things and zones are kept in all of them. Tap one to use it (Undo goes back). Red dots are trainers, yellow are items.
        </p>
        {s.variationsStale && <p className="notice-inline bad">The map has changed since these were made. Using one would undo those changes: make new ones instead.</p>}
        <div className="variations-grid">
          {v.items.map((item, k) => {
            const problems = item.result.issues.filter((i) => i.severity === "error").length;
            const warnings = item.result.issues.length - problems;
            return (
              <button
                key={item.seed}
                className="variation"
                disabled={s.variationsStale}
                title={`Use seed ${item.seed}`}
                onClick={() => s.useVariation(k)}
              >
                <Thumbnail result={item.result} width={map.width} height={map.height} paletteId={s.prefs.paletteId} />
                <span className="variation-label">
                  Seed {item.seed}
                  <small className={problems ? "bad" : ""}>{problems ? `${problems} error${problems === 1 ? "" : "s"}` : warnings ? `✓ ${warnings} warning${warnings === 1 ? "" : "s"}` : "✓ OK"}</small>
                </span>
              </button>
            );
          })}
          {Array.from({ length: waiting }, (_, k) => (
            <div key={`wait${k}`} className="variation waiting">
              Generating…
            </div>
          ))}
        </div>
        <div className="modal-actions">
          <button className="secondary" disabled={s.variationsBusy} onClick={() => void s.makeVariations()}>
            Show 6 more
          </button>
          <button className="secondary" onClick={() => s.closeVariations()}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
