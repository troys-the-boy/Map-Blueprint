// The controls for a reference image: the drawing to trace under the region sketch, or
// a map's reference image. Both work the same way; the panel that shows this says what
// to do with each change (see SketchPanel's UnderlaySection and MapImageSection).

import { useState } from "react";
import type { ReactNode } from "react";
import type { ReferenceImage } from "../../core/referenceImage";
import { REFERENCE_MAX_BYTES, formatBytes, isMissingFile, newReferenceImage } from "../../core/referenceImage";
import { store } from "../store";
import { underlayError, underlayPicture } from "../underlay";
import type { UnderlayPicture } from "../underlay";
import { NumberField } from "./NumberField";
import { Icon } from "./icons";

export interface ReferenceImageProps {
  image: ReferenceImage | null;
  /** The picture cache slot ("sketch" or "map"). */
  slot: string;
  /** "the sketch" or "the map", for the words shown. */
  where: string;
  /** Called when the picture has loaded (to redraw). */
  onReady: () => void;
  /** A file was picked: a new image, or the missing file of this one put back. */
  onLoad: (image: ReferenceImage, isNew: boolean) => void;
  onPatch: (patch: Partial<ReferenceImage>) => void;
  onRemove: () => void;
  onRotate: (degrees: number, pic: UnderlayPicture) => void;
  /** Stretch it across the width of the sketch or map. */
  onFit: (pic: UnderlayPicture) => void;
  moving: boolean;
  onToggleMove: () => void;
  onStartCalibration: () => void;
  /** Extra buttons for scale (e.g. 1 pixel = 1/16 metatile). */
  scaleExtras?: (pic: UnderlayPicture) => ReactNode;
  /** Shown while setting the scale. */
  calibration?: ReactNode;
  summary: string;
  intro: string;
}

export function ReferenceImageSection(p: ReferenceImageProps) {
  const u = p.image;
  const missing = !!u && isMissingFile(u);
  const pic = missing ? null : underlayPicture(u, p.onReady, p.slot);
  const error = missing ? null : underlayError(p.slot);
  const [open, setOpen] = useState(!!u);

  const load = (file: File) => {
    if (file.size > REFERENCE_MAX_BYTES) {
      store.setNotice({ kind: "error", text: `That file is ${formatBytes(file.size)}. A reference image can be at most ${formatBytes(REFERENCE_MAX_BYTES)}. Try a smaller image or a one-page PDF.` });
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
      // Putting a missing file back keeps where it sat; anything else starts fresh.
      if (u && missing) p.onLoad({ ...u, kind, name: file.name.slice(0, 200), data }, false);
      else p.onLoad(newReferenceImage(kind, file.name, data), true);
    };
    reader.readAsDataURL(file);
  };
  const picker = (label: string) => (
    <label className="secondary file-button">
      {label}
      <input
        type="file"
        accept="application/pdf,image/png,image/jpeg,image/webp,image/gif"
        onChange={(ev) => {
          if (ev.target.files?.[0]) load(ev.target.files[0]);
          ev.target.value = "";
        }}
        hidden
      />
    </label>
  );

  return (
    <details className="sketch-section" open={open || !!u} onToggle={(ev) => setOpen((ev.target as HTMLDetailsElement).open)}>
      <summary title={p.intro}>
        {p.summary}
        {u ? `: ${u.name}` : ""}
      </summary>
      {!u ? (
        <>
          <p className="hint">{p.intro}</p>
          {picker("Load a PDF or image…")}
        </>
      ) : missing ? (
        <>
          <p className="hint warn">
            <b>{u.name}</b> isn't in this project: it wasn't saved with it. Pick the same file again to put it back where it was.
          </p>
          <div className="field-row wrap">
            {picker("Pick the file again…")}
            <button className="secondary danger" onClick={p.onRemove}>
              <Icon name="trash" size={18} /> Forget it
            </button>
          </div>
        </>
      ) : (
        <>
          {error && <p className="hint bad">Couldn't show it: {error}</p>}
          <label className="check">
            <input type="checkbox" checked={u.visible} onChange={(ev) => p.onPatch({ visible: ev.target.checked })} />
            Show
          </label>
          <label className="slider">
            <span>
              Opacity <b>{Math.round(u.opacity * 100)}</b>
            </span>
            <input type="range" min={0.1} max={1} step={0.05} value={u.opacity} onChange={(ev) => p.onPatch({ opacity: Number(ev.target.value) })} />
          </label>
          {u.kind === "pdf" && (
            <label className="field inline" title="Which page of the PDF to show.">
              <span>Page</span>
              <NumberField min={1} max={9999} value={u.page} onChange={(v) => p.onPatch({ page: v })} />
            </label>
          )}
          <div className="field-row wrap">
            <button className="secondary" disabled={!pic || u.locked} title="Tap two points on the image and say how many metatiles apart they are." onClick={p.onStartCalibration}>
              Set scale…
            </button>
            <button className="secondary" disabled={!pic || u.locked} title={`Stretch the image across ${p.where}'s width.`} onClick={() => pic && p.onFit(pic)}>
              Fit to {p.where.replace(/^the /, "")}
            </button>
            {pic && !u.locked && p.scaleExtras?.(pic)}
          </div>
          {p.calibration}
          <div className="field-row wrap">
            <button className="secondary" disabled={!pic || u.locked} title="Turn a quarter to the left" onClick={() => pic && p.onRotate(u.rotation - 90, pic)}>
              ↺ 90°
            </button>
            <button className="secondary" disabled={!pic || u.locked} title="Turn a quarter to the right" onClick={() => pic && p.onRotate(u.rotation + 90, pic)}>
              ↻ 90°
            </button>
            <button className={`secondary ${p.moving ? "active" : ""}`} disabled={u.locked} title="Drag the image to move it" onClick={p.onToggleMove}>
              Move
            </button>
          </div>
          <label className="slider" title="Turn it a little to line it up (degrees, clockwise).">
            <span>
              Turn <b>{Math.round(u.rotation)}°</b>
            </span>
            <input type="range" min={-180} max={180} step={1} value={u.rotation} disabled={!pic || u.locked} onChange={(ev) => pic && p.onRotate(Number(ev.target.value), pic)} />
          </label>
          <label className="check" title="Locked: it can't be moved, scaled or turned by accident.">
            <input type="checkbox" checked={u.locked} onChange={(ev) => p.onPatch({ locked: ev.target.checked })} />
            Lock in place
          </label>
          <p className="hint">
            Scale: 1 metatile = {(1 / u.scale).toFixed(2)} {u.kind === "pdf" ? "points (1/72 inch)" : "pixels"} of the image.
          </p>
          <label className="check" title="On: the file is saved inside the project. Off: the project keeps where it sits but not the file, which keeps the project small; pick the file again after opening the project.">
            <input type="checkbox" checked={u.save} onChange={(ev) => p.onPatch({ save: ev.target.checked })} />
            Save with the project ({formatBytes(u.data.length)})
          </label>
          {!u.save && <p className="hint">Left out of the project file. This browser keeps it for now; after opening the project file, pick the file again to bring it back.</p>}
          <div className="field-row wrap">
            {picker("Replace…")}
            <button className="secondary danger" onClick={p.onRemove}>
              <Icon name="trash" size={18} /> Remove
            </button>
          </div>
        </>
      )}
    </details>
  );
}

/** Once a new image has loaded, call `fit` with its picture (as part of loading it). */
export function fitWhenReady(slot: string, current: () => ReferenceImage | null | undefined, fit: (pic: UnderlayPicture) => void) {
  let tries = 0;
  const check = () => {
    const u = current();
    if (!u) return;
    const pic = underlayPicture(u, () => undefined, slot);
    if (pic) fit(pic);
    else if (underlayError(slot) === null && tries++ < 100) setTimeout(check, 100);
  };
  check();
}
