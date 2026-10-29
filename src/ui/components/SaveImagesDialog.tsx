// Asked when saving a project that has reference images set to be saved with it: how
// much room they take in the file, how to leave them out, and advice when that's a lot.
// See saveProject in files.ts.

import { useState } from "react";
import { FILE_LIMITS } from "../../core/project";
import { IMAGE_SIZE_SUGGEST, IMAGE_SIZE_WARN, formatBytes, regionImages, savedImageBytes } from "../../core/referenceImage";
import { useStore } from "../store";

export function SaveImagesDialog() {
  const s = useStore();
  const prompt = s.savePrompt;
  const [quiet, setQuiet] = useState(false);
  if (!prompt) return null;
  const images = regionImages(s.region);
  const bytes = savedImageBytes(s.region);
  const fileBytes = s.serialize().length;
  const tooBig = fileBytes > FILE_LIMITS.maxFileBytes;
  const answer = (ok: boolean) => {
    s.answerSavePrompt(ok, quiet ? bytes : null);
    setQuiet(false);
  };

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && answer(false)}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="save-images-title">
        <h2 id="save-images-title">Reference images in the project</h2>
        <p>
          Reference images set to be saved add <b>{formatBytes(bytes)}</b> to this project file (the whole file: {formatBytes(fileBytes)}).
        </p>
        <ul className="save-images-list">
          {images.map((r) => (
            <li key={r.owner}>
              <label className="check" title="Untick to leave this image out of the file. The project keeps where it sits; pick the file again after opening the project.">
                <input type="checkbox" checked={r.image.save} onChange={(e) => s.setImageSaved(r.owner, e.target.checked)} />
                <span>
                  {r.label}: {r.image.name} ({formatBytes(r.image.data.length)})
                </span>
              </label>
            </li>
          ))}
        </ul>
        {tooBig ? (
          <p className="hint bad">
            Too big to save: the file would be {formatBytes(fileBytes)}, and a project over {formatBytes(FILE_LIMITS.maxFileBytes)} can't be opened again. Untick some images above, then save.
          </p>
        ) : bytes > IMAGE_SIZE_WARN ? (
          <p className="hint bad">
            Very large: a project file can be at most {formatBytes(FILE_LIMITS.maxFileBytes)}, and it can't be opened again if it goes over. Untick images you've finished tracing, or use smaller ones (a lower-resolution scan, or one page of a PDF).
          </p>
        ) : bytes > IMAGE_SIZE_SUGGEST ? (
          <p className="hint warn">
            Getting large: big files are slower to save, open and share, especially on the iPad. Consider unticking images you've finished tracing.
          </p>
        ) : (
          <p className="hint">That's a comfortable size.</p>
        )}
        <p className="hint">
          <b>To leave an image out</b>, untick it above, or untick <b>Save with the project</b> under <b>Reference image</b> in a map's Paint tab (or <b>Drawing to trace</b> in the region sketch). The project then keeps where the image sits but not the file: after opening the project, pick the same file again to put it back.
        </p>
        {!tooBig && bytes <= IMAGE_SIZE_WARN && (
          <label className="check">
            <input type="checkbox" checked={quiet} onChange={(e) => setQuiet(e.target.checked)} />
            Don't ask again unless the images get bigger
          </label>
        )}
        <div className="modal-actions">
          <button className="secondary" onClick={() => answer(false)}>
            Cancel
          </button>
          <button className="primary" disabled={tooBig} onClick={() => answer(true)}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
