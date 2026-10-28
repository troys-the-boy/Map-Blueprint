// The sketch underlay's picture: an image, or a page of a PDF drawn to a canvas.
// Loading takes a moment, so the picture is kept once ready and `onReady` is
// called to redraw.

import type { SketchUnderlay } from "../core/sketch";

export interface UnderlayPicture {
  source: CanvasImageSource;
  /** Size in the underlay's units (image pixels, or PDF points). */
  width: number;
  height: number;
  /** Bitmap pixels per unit (a PDF page is drawn sharper than 1 pixel per point). */
  pixelsPerUnit: number;
}

let key = "";
let picture: UnderlayPicture | null = null;
let failed: string | null = null;
let loading: Promise<void> | null = null;

/** Draws a PDF page; set by the PDF reader module once it's loaded (see pdfUnderlay.ts). */
export const pdfRenderer: { render: ((data: string, page: number) => Promise<{ canvas: HTMLCanvasElement; width: number; height: number; scale: number; pages: number }>) | null } = { render: null };

/** How many pages the current PDF has (0 until it's read). */
export let pdfPageCount = 0;

/** The picture for an underlay, or null while it loads (onReady is called when it's ready). */
export function underlayPicture(u: SketchUnderlay | null, onReady: () => void): UnderlayPicture | null {
  if (!u) return null;
  const k = `${u.kind}:${u.page}:${u.data.length}:${u.data.slice(-64)}`;
  if (k === key) return picture;
  key = k;
  picture = null;
  failed = null;
  const mine = k;
  loading = load(u)
    .then((p) => {
      if (key !== mine) return;
      picture = p;
      onReady();
    })
    .catch((err: unknown) => {
      if (key !== mine) return;
      failed = err instanceof Error ? err.message : String(err);
      onReady();
    });
  return null;
}

/** Why the picture couldn't be shown, if it couldn't. */
export function underlayError(): string | null {
  return failed;
}

/** Wait for the picture being loaded (for tests in the browser). */
export function underlayLoading(): Promise<void> | null {
  return loading;
}

async function load(u: SketchUnderlay): Promise<UnderlayPicture> {
  if (u.kind === "image") {
    const img = new Image();
    img.decoding = "async";
    img.src = u.data;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, pixelsPerUnit: 1 };
  }
  if (!pdfRenderer.render) throw new Error("the PDF reader isn't available");
  const page = await pdfRenderer.render(u.data, u.page);
  pdfPageCount = page.pages;
  return { source: page.canvas, width: page.width, height: page.height, pixelsPerUnit: page.scale };
}
