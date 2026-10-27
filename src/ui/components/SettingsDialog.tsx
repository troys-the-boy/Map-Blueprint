// Per-device settings: finger behaviour on touch screens, color palette.

import { PALETTES } from "../../core/terrain";
import type { FingerMode } from "../prefs";
import { APP_VERSION, useStore } from "../store";

const FINGER_OPTIONS: Array<{ value: FingerMode; label: string; tip: string }> = [
  { value: "auto", label: "Automatic", tip: "A finger paints until you use an Apple Pencil; after that the Pencil paints and a finger moves the view." },
  { value: "paint", label: "Finger paints", tip: "One finger always paints. Use two fingers to move the view." },
  { value: "pan", label: "Finger moves the view", tip: "Only the Apple Pencil or a mouse paints. One finger always moves the view." },
];

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const s = useStore();
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <h2 id="settings-title">Settings</h2>
        <p className="hint">These settings are remembered on this device only. They aren't saved in project files.</p>

        <fieldset>
          <legend>One finger on a touch screen</legend>
          {FINGER_OPTIONS.map((o) => (
            <label key={o.value} className="radio" title={o.tip}>
              <input type="radio" name="finger" checked={s.prefs.fingerMode === o.value} onChange={() => s.updatePrefs({ fingerMode: o.value })} />
              <span>
                <strong>{o.label}</strong>
                <small>{o.tip}</small>
              </span>
            </label>
          ))}
          {s.prefs.fingerMode === "auto" && (
            <p className="hint">{s.prefs.penSeen ? "An Apple Pencil has been used here, so one finger moves the view." : "No Apple Pencil used yet, so one finger paints."}</p>
          )}
        </fieldset>

        <fieldset>
          <legend>Map colors</legend>
          {PALETTES.map((p) => (
            <label key={p.id} className="radio" title={p.description}>
              <input type="radio" name="palette" checked={s.prefs.paletteId === p.id} onChange={() => s.updatePrefs({ paletteId: p.id })} />
              <span>
                <strong>{p.name}</strong>
                <small>{p.description}</small>
              </span>
            </label>
          ))}
        </fieldset>

        <fieldset>
          <legend>Gestures and shortcuts</legend>
          <ul className="shortcuts">
            <li>Two-finger drag: move the view. Pinch: zoom. Two-finger tap: undo.</li>
            <li>Mouse wheel: zoom. Space + drag, or right-drag: move the view.</li>
            <li>B pencil · E eraser · H move view · I pick terrain (or Alt+click) · [ ] brush size</li>
            <li>Ctrl+Z undo · Ctrl+Shift+Z or Ctrl+Y redo · Ctrl+S save · 0 fit map</li>
          </ul>
        </fieldset>

        <p className="hint">Gen 3 Map Blueprint version {APP_VERSION}. Works offline. Makes no network requests.</p>
        <div className="modal-actions">
          <button className="primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
