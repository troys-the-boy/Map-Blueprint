// The bar across the top of the canvas for the Select and Things tools: big
// buttons for copy, paste, delete, turning trainers and so on, so everything
// works with a finger or Pencil as well as with the keyboard.

import { useState } from "react";
import { useStore } from "../store";
import type { SelectMode } from "../store";
import { Icon } from "./icons";
import { canvasRef } from "./MapCanvas";
import { THING_LABELS, MAX_SIGHT, facingOf, isWarp, sightOf, thingTag } from "../../core/things";
import type { Direction } from "../../core/terrain";
import { ELEVATION_LEVELS, TERRAIN_TYPES } from "../../core/terrain";
import { LEVEL_VALUE, hexDigit } from "../../core/porymap";
import { LEVEL_LABELS } from "./TerrainPanel";

const MODES: Array<{ mode: SelectMode; label: string; tip: string }> = [
  { mode: "new", label: "New", tip: "A new shape replaces the selection. Drag inside the selection to move it." },
  { mode: "add", label: "+", tip: "Add: a new shape is added to the selection (or hold Shift)." },
  { mode: "subtract", label: "−", tip: "Subtract: a new shape is taken away from the selection (or hold Alt)." },
];

const FACINGS: Array<{ dir: Direction | "all"; label: string; tip: string }> = [
  { dir: "n", label: "↑", tip: "Face up (north)" },
  { dir: "e", label: "→", tip: "Face right (east)" },
  { dir: "s", label: "↓", tip: "Face down (south)" },
  { dir: "w", label: "←", tip: "Face left (west)" },
  { dir: "all", label: "✣", tip: "Look around (every direction)" },
];

/** The cell in the middle of the canvas, where a paste first appears. */
function viewCentre(): [number, number] | null {
  const r = canvasRef.renderer;
  if (!r) return null;
  return r.cellAt(r.size.width / 2, r.size.height / 2);
}

export function EditBar() {
  const s = useStore();
  if (s.selecting) return <SelectBar />;
  if (s.tool === "things" && s.pickedThing) return <ThingBar />;
  return null;
}

function SelectBar() {
  const s = useStore();
  // The less-used buttons can be folded away to see more of the map.
  const [more, setMore] = useState(true);
  const sel = s.selection;
  if (s.floating && !s.floating.source) {
    return (
      <div className="edit-bar" role="toolbar" aria-label="Paste">
        <span className="edit-bar-label">Drag the copy into place</span>
        <button className="primary" title="Put the copy down here (Enter)" onClick={() => s.dropFloating()}>
          Place
        </button>
        <button className="secondary" title="Don't paste (Esc)" onClick={() => s.cancelFloating()}>
          Cancel
        </button>
      </div>
    );
  }
  return (
    <div className="edit-bar" role="toolbar" aria-label="Selection">
      <span className="edit-bar-group first" role="group" aria-label="Selection mode">
        {MODES.map((m) => (
          <button key={m.mode} className={`icon-button facing ${s.selectMode === m.mode ? "active" : ""}`} title={m.tip} aria-label={m.tip} aria-pressed={s.selectMode === m.mode} onClick={() => s.setSelectMode(m.mode)}>
            {m.label}
          </button>
        ))}
      </span>
      {s.tool === "wand" && (
        <label className="edit-bar-group check" title="Pick the tapped terrain everywhere on the map, not just the joined patch.">
          <input type="checkbox" checked={s.wandEverywhere} onChange={(e) => s.setWandEverywhere(e.target.checked)} />
          Everywhere
        </label>
      )}
      <span className="edit-bar-label">{sel ? (sel.mask ? `Shape, ${sel.mask.reduce((a, b) => a + b, 0)} cells` : `${sel.w}×${sel.h} at ${sel.x}, ${sel.y}`) : s.tool === "lasso" ? "Draw round an area" : s.tool === "wand" ? "Tap a terrain to select it" : "Drag to select an area"}</span>
      <button className="icon-button" title="Copy (Ctrl+C)" aria-label="Copy" disabled={!sel} onClick={() => s.copySelection()}>
        <Icon name="copy" />
      </button>
      <button className="icon-button" title="Cut: copy, then clear the area (filled as chosen under Gaps) (Ctrl+X)" aria-label="Cut" disabled={!sel} onClick={() => s.cutSelection()}>
        <Icon name="cut" />
      </button>
      <button className="icon-button" title="Paste the last copy (Ctrl+V). It appears in the middle of the view; drag it, then Place." aria-label="Paste" disabled={!s.clipboard} onClick={() => s.paste(viewCentre())}>
        <Icon name="paste" />
      </button>
      <button className="icon-button" title="Clear the area and remove the things in it; it is filled as chosen under Gaps (Delete)" aria-label="Delete" disabled={!sel} onClick={() => s.deleteSelection()}>
        <Icon name="trash" />
      </button>
      <button
        className="secondary"
        title="Make this area again with the generator. Everything outside it stays exactly as it is. Each try gives a different result; Undo goes back."
        disabled={!sel || s.generating}
        onClick={() => s.regenerateSelection()}
      >
        <Icon name="generate" size={18} /> Regenerate area
      </button>
      {sel && (
        <button className="icon-button" title="Clear the selection (Esc)" aria-label="Clear selection" onClick={() => s.clearSelection()}>
          <Icon name="close" />
        </button>
      )}
      <button
        className="icon-button"
        title={more ? "Fewer buttons: hide grow, shrink, fill, elevation, lock and gaps, to see more of the map" : "More buttons: grow, shrink, invert, select all, fill, elevation, lock and gaps"}
        aria-label={more ? "Fewer buttons" : "More buttons"}
        aria-expanded={more}
        onClick={() => setMore(!more)}
      >
        {more ? "▴" : "▾"}
      </button>
      {more && (
        <span className="edit-bar-more">
      <span className="edit-bar-group" role="group" aria-label="Change the selection's shape">
        <button className="icon-button" title="Grow the selection by one cell all round" aria-label="Grow selection" disabled={!sel} onClick={() => s.growSelection(1)}>
          <Icon name="grow" />
        </button>
        <button className="icon-button" title="Shrink the selection by one cell all round" aria-label="Shrink selection" disabled={!sel} onClick={() => s.growSelection(-1)}>
          <Icon name="shrink" />
        </button>
        <button className="icon-button" title="Invert: select everything that isn't selected (Ctrl+I)" aria-label="Invert selection" onClick={() => s.invertSelection()}>
          <Icon name="invert" />
        </button>
        <button className="icon-button" title="Select the whole map (Ctrl+A)" aria-label="Select all" onClick={() => s.selectAll()}>
          <Icon name="all" />
        </button>
      </span>
      <span className="edit-bar-group" role="group" aria-label="Change the selection">
        <select
          value=""
          disabled={!sel}
          title="Fill every selected cell with one terrain, like a paint bucket. The cells are locked if Lock what I paint is on."
          aria-label="Fill the selection with a terrain"
          onChange={(e) => e.target.value !== "" && s.changeSelection({ fill: Number(e.target.value) })}
        >
          <option value="">Fill with…</option>
          {TERRAIN_TYPES.map((t, i) => (
            <option key={t.id} value={i}>
              {t.label}
            </option>
          ))}
        </select>
        <select
          value=""
          disabled={!sel}
          title="Set the elevation of every selected cell (the number you'll set in Porymap). Terrain stays as it is."
          aria-label="Set the elevation of the selection"
          onChange={(e) => e.target.value !== "" && s.changeSelection({ elevation: Number(e.target.value) })}
        >
          <option value="">Elevation…</option>
          {ELEVATION_LEVELS.map((level, i) => (
            <option key={level} value={i}>
              {hexDigit(LEVEL_VALUE[i])} · {LEVEL_LABELS[level]}
            </option>
          ))}
        </select>
        <button className="icon-button" title="Lock every selected cell, so Generate keeps it" aria-label="Lock the selection" disabled={!sel} onClick={() => s.changeSelection({ lock: true })}>
          <Icon name="lock" />
        </button>
        <button className="icon-button" title="Unlock every selected cell, so Generate can change it" aria-label="Unlock the selection" disabled={!sel} onClick={() => s.changeSelection({ lock: false })}>
          <Icon name="unlock" />
        </button>
      </span>
      <label className="edit-bar-group" title="What fills the gap a move, cut or delete leaves behind. Generated terrain matches the surroundings (Undo once goes back to before the move); plain ground stays empty and unlocked, so you can regenerate it later.">
        <span className="edit-bar-value">Gaps:</span>
        <select value={s.prefs.gapFill} onChange={(e) => s.setGapFill(e.target.value as "ground" | "regenerate")} aria-label="Fill the gap left behind with">
          <option value="regenerate">Generated terrain</option>
          <option value="ground">Plain ground</option>
        </select>
      </label>
        </span>
      )}
    </div>
  );
}

function ThingBar() {
  const s = useStore();
  const e = s.pickedThing!;
  const map = s.currentMap!;
  const facing = !isWarp(e) && e.kind === "trainer" ? facingOf(e) : null;
  return (
    <div className="edit-bar" role="toolbar" aria-label={thingTag(map, e)}>
      <span className="edit-bar-label" title="Every field of this thing is in the Details tab.">
        <b>{thingTag(map, e)}</b> {isWarp(e) ? "Warp" : THING_LABELS[e.kind]} at {e.x}, {e.y}
      </span>
      {!isWarp(e) && e.kind === "trainer" && (
        <>
          <span className="edit-bar-group" role="group" aria-label="Facing">
            {FACINGS.map((f) => (
              <button key={f.dir} className={`icon-button facing ${facing === f.dir ? "active" : ""}`} title={f.tip} aria-label={f.tip} aria-pressed={facing === f.dir} onClick={() => s.turnThing(f.dir)}>
                {f.label}
              </button>
            ))}
          </span>
          <span className="edit-bar-group" role="group" aria-label="Sight range" title="How many cells the trainer can see">
            <button className="icon-button" aria-label="Shorter sight" disabled={sightOf(e) <= 1} onClick={() => s.changeSight(-1)}>
              −
            </button>
            <span className="edit-bar-value">Sees {sightOf(e)}</span>
            <button className="icon-button" aria-label="Longer sight" disabled={sightOf(e) >= MAX_SIGHT} onClick={() => s.changeSight(1)}>
              +
            </button>
          </span>
        </>
      )}
      <button className="icon-button" title="Remove this thing (Delete)" aria-label="Remove" onClick={() => s.deleteThing()}>
        <Icon name="trash" />
      </button>
    </div>
  );
}
