// The pictures of reference images (the sketch's drawing to trace, and a map's
// reference image): an image, or a page of a PDF drawn to a canvas. Loading takes a
// moment, so each picture is kept once ready and its listeners are called to redraw.
// Each place that shows one has its own slot ("sketch", "map").

import type { ReferenceImage } from "../core/referenceImage";
import { isMissingFile } from "../core/referenceImage";

export interface UnderlayPicture {
  source: CanvasImageSource;
  /** Size in the image's units (image pixels, or PDF points). */
  width: number;
  height: number;
  /** Bitmap pixels per unit (a PDF page is drawn sharper than 1 pixel per point). */
  pixelsPerUnit: number;
}

interface Slot {
  key: string;
  picture: UnderlayPicture | null;
  failed: string | null;
  loading: Promise<void> | null;
  /** How many pages the PDF has (0 until it's read). */
  pages: number;
  listeners: Set<() => void>;
}

const slots = new Map<string, Slot>();

function slotOf(name: string): Slot {
  let s = slots.get(name);
  if (!s) slots.set(name, (s = { key: "", picture: null, failed: null, loading: null, pages: 0, listeners: new Set() }));
  return s;
}

/** The picture for an image, or null while it loads (onReady is called when it's ready). */
export function underlayPicture(u: ReferenceImage | null, onReady: () => void, slot = "sketch"): UnderlayPicture | null {
  if (!u || isMissingFile(u)) return null;
  const s = slotOf(slot);
  const k = `${u.kind}:${u.page}:${u.data.length}:${u.data.slice(-64)}`;
  if (k === s.key) {
    if (!s.picture && !s.failed) s.listeners.add(onReady);
    return s.picture;
  }
  s.key = k;
  s.picture = null;
  s.failed = null;
  s.listeners = new Set([onReady]);
  const done = () => {
    const list = [...s.listeners];
    s.listeners.clear();
    for (const fn of list) fn();
  };
  s.loading = load(u, s)
    .then((p) => {
      if (s.key !== k) return;
      s.picture = p;
      done();
    })
    .catch((err: unknown) => {
      if (s.key !== k) return;
      s.failed = err instanceof Error ? err.message : String(err);
      done();
    });
  return null;
}

/** Why the picture couldn't be shown, if it couldn't. */
export function underlayError(slot = "sketch"): string | null {
  return slotOf(slot).failed;
}

/** How many pages the slot's PDF has (0 until it's read). */
export function underlayPages(slot = "sketch"): number {
  return slotOf(slot).pages;
}

/** Wait for the picture being loaded (for tests in the browser). */
export function underlayLoading(slot = "sketch"): Promise<void> | null {
  return slotOf(slot).loading;
}

async function load(u: ReferenceImage, slot: Slot): Promise<UnderlayPicture> {
  if (u.kind === "image") {
    const img = new Image();
    img.decoding = "async";
    img.src = u.data;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, pixelsPerUnit: 1 };
  }
  // The PDF reader is large, so it's only loaded when a PDF is shown.
  const { renderPdfPage } = await import("./pdfUnderlay");
  const page = await renderPdfPage(u.data, u.page);
  slot.pages = page.pages;
  return { source: page.canvas, width: page.width, height: page.height, pixelsPerUnit: page.scale };
}

/** Draw a reference image: (X, Y) turn metatiles into screen pixels, `scale` = pixels per metatile. */
export function drawUnderlay(ctx: CanvasRenderingContext2D, u: ReferenceImage, pic: UnderlayPicture, X: (x: number) => number, Y: (y: number) => number, scale: number) {
  ctx.save();
  ctx.globalAlpha = u.opacity;
  ctx.translate(X(u.x), Y(u.y));
  ctx.rotate((u.rotation * Math.PI) / 180);
  const k = (scale * u.scale) / pic.pixelsPerUnit;
  ctx.scale(k, k);
  ctx.drawImage(pic.source, 0, 0);
  ctx.restore();
}
