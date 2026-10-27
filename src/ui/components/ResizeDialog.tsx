// "Resize map" dialog: new width and height, which side stays put (the anchor),
// the live size budget, and a warning listing anything that would be cut off.

import { useState } from "react";
import type { Anchor, AnchorPart } from "../../core/resize";
import { hasLoss, resizePreview, resizeShift } from "../../core/resize";
import { checkMapSize, describeSizeCheck } from "../../core/sizeRule";
import { useStore } from "../store";
import { NumberField } from "./NumberField";

const PARTS: AnchorPart[] = [0, 1, 2];
const X_NAMES = ["left", "middle", "right"];
const Y_NAMES = ["top", "middle", "bottom"];
const ARROWS = [
  ["↖", "↑", "↗"],
  ["←", "•", "→"],
  ["↙", "↓", "↘"],
];

function anchorName(a: Anchor) {
  if (a.x === 1 && a.y === 1) return "the middle";
  if (a.x === 1) return `the ${Y_NAMES[a.y]} edge`;
  if (a.y === 1) return `the ${X_NAMES[a.x]} edge`;
  return `the ${Y_NAMES[a.y]}-${X_NAMES[a.x]} corner`;
}

/** "3 cells added on the left, 2 cut from the bottom", for the summary line. */
function describeSides(dx: number, dy: number, dw: number, dh: number): string {
  const parts: string[] = [];
  const side = (n: number, name: string) => {
    if (n > 0) parts.push(`${n} added on the ${name}`);
    if (n < 0) parts.push(`${-n} cut from the ${name}`);
  };
  side(dx, "left");
  side(dw - dx, "right");
  side(dy, "top");
  side(dh - dy, "bottom");
  return parts.length ? parts.join(", ") + "." : "No change.";
}

function LossList({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  const shown = items.slice(0, 6);
  return (
    <li>
      {title}: {shown.join(", ")}
      {items.length > shown.length ? ` and ${items.length - shown.length} more` : ""}
    </li>
  );
}

export function ResizeDialog({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const map = s.currentMap;
  const [width, setWidth] = useState(map?.width ?? 20);
  const [height, setHeight] = useState(map?.height ?? 20);
  const [anchor, setAnchor] = useState<Anchor>({ x: 1, y: 1 });
  if (!map) return null;

  const size = checkMapSize(width, height, s.region.settings.engineLimits);
  const usedPct = Math.min(100, (size.used / size.limit) * 100);
  const same = width === map.width && height === map.height;
  const valid = size.ok && Number.isInteger(width) && Number.isInteger(height) && !same;
  const { dx, dy } = resizeShift(map, width, height, anchor);
  const loss = resizePreview(map, width, height, anchor);
  const losing = hasLoss(loss);

  const apply = () => {
    if (!valid) return;
    s.resizeCurrentMap(width, height, anchor);
    onClose();
  };

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="resize-title">
        <h2 id="resize-title">Resize {map.name}</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            apply();
          }}
        >
          <p className="hint">
            Now {map.width}×{map.height}. New cells are plain ground, not locked, so Generate fills them in. Everything on the map moves with its cells.
          </p>
          <div className="field-row">
            <label className="field" title="Width in metatiles (16×16 px cells).">
              <span>Width</span>
              <NumberField min={1} max={512} value={width} onChange={setWidth} />
            </label>
            <span className="times">×</span>
            <label className="field" title="Height in metatiles (16×16 px cells).">
              <span>Height</span>
              <NumberField min={1} max={512} value={height} onChange={setHeight} />
            </label>
          </div>
          <div className="anchor-row">
            <div className="anchor-grid" role="radiogroup" aria-label="Anchor: which part of the map stays put">
              {PARTS.map((y) =>
                PARTS.map((x) => {
                  const on = anchor.x === x && anchor.y === y;
                  return (
                    <button
                      key={`${x}${y}`}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      className={on ? "active" : ""}
                      title={`Keep ${anchorName({ x, y })} in place`}
                      onClick={() => setAnchor({ x, y })}
                    >
                      {on ? "■" : ARROWS[y][x]}
                    </button>
                  );
                }),
              )}
            </div>
            <p className="hint">
              <strong>Anchor:</strong> {anchorName(anchor)} stays put.
              <br />
              {describeSides(dx, dy, width - map.width, height - map.height)}
            </p>
          </div>
          <div className={`budget ${size.ok ? "" : "over"}`} title="pokeemerald needs (width + 15) × (height + 14) to be at most 10,240 for a map to load.">
            <div className="budget-bar">
              <div style={{ width: `${usedPct}%` }} />
            </div>
            <p>{describeSizeCheck(size)}</p>
          </div>
          {losing && (
            <div className="notice-inline bad resize-loss" role="alert">
              <strong>Shrinking cuts off {loss.cells} cells</strong>
              <ul>
                {loss.lockedCells > 0 && <li>{loss.lockedCells} of them are locked cells you drew or placed</li>}
                <LossList title="Things removed" items={loss.things} />
                <LossList title="Warps removed" items={loss.warps} />
                <LossList title="Zones removed" items={loss.zonesRemoved} />
                <LossList title="Zones made smaller" items={loss.zonesTrimmed} />
                <LossList title="Entrances removed" items={loss.openingsRemoved} />
                <LossList title="Entrances made narrower" items={loss.openingsTrimmed} />
              </ul>
              <span>Undo brings it all back.</span>
            </div>
          )}
          {map.connections.length > 0 && (dx !== 0 || dy !== 0) && (
            <p className="hint">Connection offsets move with the map. Check the neighbouring maps' connections too.</p>
          )}
          <div className="modal-actions">
            <button type="button" className="secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className={losing ? "danger" : "primary"} disabled={!valid} title={same ? "Pick a new size first" : valid ? "Resize the map" : "Fix the size first"}>
              {losing ? "Resize and cut off" : "Resize"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
