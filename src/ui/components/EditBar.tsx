// The bar across the top of the canvas for the Select and Things tools: big
// buttons for copy, paste, delete, turning trainers and so on, so everything
// works with a finger or Pencil as well as with the keyboard.

import { useStore } from "../store";
import { Icon } from "./icons";
import { canvasRef } from "./MapCanvas";
import { THING_LABELS, MAX_SIGHT, facingOf, sightOf } from "../../core/things";
import type { Direction } from "../../core/terrain";

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
  if (s.tool === "select") return <SelectBar />;
  if (s.tool === "things" && s.selectedEntity) return <ThingBar />;
  return null;
}

function SelectBar() {
  const s = useStore();
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
      <span className="edit-bar-label">{sel ? `${sel.w}×${sel.h} at ${sel.x}, ${sel.y}` : "Drag to select an area"}</span>
      <button className="icon-button" title="Copy (Ctrl+C)" aria-label="Copy" disabled={!sel} onClick={() => s.copySelection()}>
        <Icon name="copy" />
      </button>
      <button className="icon-button" title="Cut: copy, then clear to plain ground (Ctrl+X)" aria-label="Cut" disabled={!sel} onClick={() => s.cutSelection()}>
        <Icon name="cut" />
      </button>
      <button className="icon-button" title="Paste the last copy (Ctrl+V). It appears in the middle of the view; drag it, then Place." aria-label="Paste" disabled={!s.clipboard} onClick={() => s.paste(viewCentre())}>
        <Icon name="paste" />
      </button>
      <button className="icon-button" title="Clear the area to plain ground and remove the things in it (Delete)" aria-label="Delete" disabled={!sel} onClick={() => s.deleteSelection()}>
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
    </div>
  );
}

function ThingBar() {
  const s = useStore();
  const e = s.selectedEntity!;
  const facing = e.kind === "trainer" ? facingOf(e) : null;
  return (
    <div className="edit-bar" role="toolbar" aria-label={`${e.id}`}>
      <span className="edit-bar-label">
        <b>{e.id}</b> {THING_LABELS[e.kind] ?? e.kind} at {e.x}, {e.y}
      </span>
      {e.kind === "trainer" && (
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
