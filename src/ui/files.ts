// Saving and opening project files on the user's device.
//
// Three ways to save, best available first:
//   1. Chrome/Edge: the File System Access API ("save in place" to a file you pick).
//   2. iPad/iPhone: the share sheet, where you choose "Save to Files".
//   3. Everywhere: a normal download.
// Opening always uses a file picker. The app never touches any other file.

import { FILE_LIMITS, explainOpenError, parseProject } from "../core/project";
import type { EditorStore } from "./store";

// Minimal types for the File System Access API (not in every TypeScript DOM library).
interface FileHandleLike {
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: Blob | string): Promise<void>; close(): Promise<void> }>;
}
type PickerWindow = Window & {
  showSaveFilePicker?: (opts: unknown) => Promise<FileHandleLike>;
  showOpenFilePicker?: (opts: unknown) => Promise<FileHandleLike[]>;
};

const pickerTypes = [{ description: "Map blueprint project", accept: { "application/json": [".json"] } }];

function isAbort(err: unknown) {
  return err instanceof DOMException && err.name === "AbortError";
}

/** A safe file name from the region name. */
export function suggestedFileName(store: EditorStore): string {
  if (store.fileName) return store.fileName;
  const base = store.region.name.replace(/[^A-Za-z0-9 _-]+/g, "").trim().replace(/\s+/g, "-") || "project";
  return `${base}.json`;
}

function isTouchDevice() {
  return navigator.maxTouchPoints > 1 && /Mac|iPad|iPhone|Android/.test(navigator.userAgent);
}

/** Save the project. Returns true if it was saved (false if cancelled or failed). */
export async function saveProject(store: EditorStore, opts: { forceDownload?: boolean } = {}): Promise<boolean> {
  const text = store.serialize();
  const name = suggestedFileName(store);
  const blob = new Blob([text], { type: "application/json" });
  const w = window as PickerWindow;

  try {
    if (!opts.forceDownload) {
      // 1. Save in place (Chrome/Edge).
      let handle = store.fileHandle as FileHandleLike | null;
      if (!handle && w.showSaveFilePicker) handle = await w.showSaveFilePicker({ suggestedName: name, types: pickerTypes });
      if (handle) {
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        store.markSaved(handle.name, handle);
        store.setNotice({ kind: "info", text: `Saved to ${handle.name}.` });
        return true;
      }

      // 2. Share sheet (iPad: "Save to Files").
      const file = new File([blob], name, { type: "application/json" });
      if (isTouchDevice() && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: name });
        store.markSaved(name, null);
        store.setNotice({ kind: "info", text: `Shared ${name}. Choose "Save to Files" in the share sheet to keep it.` });
        return true;
      }
    }

    // 3. Download.
    downloadBlob(blob, name);
    store.markSaved(name, null);
    store.setNotice({ kind: "info", text: `Downloaded ${name}. It is in your Downloads folder.` });
    return true;
  } catch (err) {
    if (isAbort(err)) return false;
    store.setNotice({ kind: "error", text: `Could not save: ${err instanceof Error ? err.message : String(err)}. Try "Download a copy" instead.` });
    return false;
  }
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Read and load a picked file. */
async function loadFile(store: EditorStore, file: File, handle: FileHandleLike | null) {
  if (file.size > FILE_LIMITS.maxFileBytes) {
    store.setNotice({ kind: "error", text: `This file is too large to be a project (${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is ${FILE_LIMITS.maxFileBytes / 1024 / 1024} MB).` });
    return;
  }
  try {
    const region = parseProject(await file.text());
    store.loadRegion(region, file.name, handle);
    store.setNotice({ kind: "info", text: `Opened ${file.name} (${region.maps.length} map${region.maps.length === 1 ? "" : "s"}).` });
  } catch (err) {
    store.setNotice({ kind: "error", text: explainOpenError(err) });
  }
}

/** Ask the user for a project file and open it. */
export async function openProject(store: EditorStore): Promise<void> {
  const w = window as PickerWindow;
  if (w.showOpenFilePicker) {
    try {
      const [handle] = await w.showOpenFilePicker({ types: pickerTypes, multiple: false });
      await loadFile(store, await handle.getFile(), handle);
    } catch (err) {
      if (!isAbort(err)) store.setNotice({ kind: "error", text: explainOpenError(err) });
    }
    return;
  }
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json,application/json";
  input.onchange = () => {
    const file = input.files?.[0];
    if (file) void loadFile(store, file, null);
  };
  input.click();
}
