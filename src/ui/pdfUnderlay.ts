// Draws one page of a PDF to a canvas, for the sketch underlay. Loaded only
// when a PDF is opened (it's large).
//
// Safety: the PDF is read from the project's own data (nothing is fetched), in
// pdf.js's worker, and only drawn to a canvas: no text layer, links, forms
// (XFA off) or scripts. pdf.js 6 no longer evaluates code at all (the
// `isEvalSupported` option the spec names was removed with its eval-based
// function compiler), and the app's Content Security Policy blocks eval anyway.

import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import PdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?worker&inline";

/** Longest side of the drawn page, in pixels: sharp enough to trace, small enough for an iPad. */
const MAX_PIXELS = 4096;

export interface PdfPage {
  canvas: HTMLCanvasElement;
  /** Page size in PDF points (1/72 inch). */
  width: number;
  height: number;
  /** Canvas pixels per point. */
  scale: number;
  pages: number;
}

function bytesOf(dataUrl: string): Uint8Array {
  const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const text = atob(b64);
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i);
  return out;
}

export async function renderPdfPage(dataUrl: string, pageNumber: number): Promise<PdfPage> {
  if (!GlobalWorkerOptions.workerPort) GlobalWorkerOptions.workerPort = new PdfWorker();
  const task = getDocument({ data: bytesOf(dataUrl), enableXfa: false, useSystemFonts: false, stopAtErrors: false });
  const doc = await task.promise;
  try {
    const n = Math.min(Math.max(1, Math.round(pageNumber)), doc.numPages);
    const page = await doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(4, MAX_PIXELS / Math.max(base.width, base.height));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvas, viewport, background: "#ffffff" }).promise;
    return { canvas, width: base.width, height: base.height, scale, pages: doc.numPages };
  } finally {
    // Frees the document (the shared worker given as workerPort stays for the next PDF).
    void task.destroy();
  }
}
