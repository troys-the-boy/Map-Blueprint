// Reference images: a PDF page or a picture laid over the region sketch or a map, to
// trace over. The same kind of image is used in both places.
//
// The file itself is kept as a data: URL. It's saved inside the project unless its
// "Save with the project" switch is off: then the project keeps its name and where it
// sits (position, scale, turn), but not the file, so picking the same file again puts it
// straight back in line.

import type { Region } from "./model";

export interface ReferenceImage {
  kind: "pdf" | "image";
  /** The file's name, for showing. */
  name: string;
  /** The file itself, as a data: URL. Empty when it wasn't saved with the project. */
  data: string;
  /** Which page of a PDF (1 = first). */
  page: number;
  /** Where the image's top-left corner sits, in metatiles. */
  x: number;
  y: number;
  /** Metatiles per unit of the image (an image pixel, or a PDF point of 1/72 inch). */
  scale: number;
  /** Turned clockwise, in degrees, about its top-left corner. */
  rotation: number;
  opacity: number;
  visible: boolean;
  /** Locked: can't be moved by accident. */
  locked: boolean;
  /** Save the file inside the project (on by default). */
  save: boolean;
}

/** Largest file that can be added (it may be saved inside the project). */
export const REFERENCE_MAX_BYTES = 15 * 1024 * 1024;

/**
 * Sizes for the saving check, in bytes of the saved file. The project file limit is 30 MB
 * (FILE_LIMITS.maxFileBytes in project.ts): over 25 MB of images the warning is strong, and a
 * project over the limit can't be saved, as it couldn't be opened again.
 */
export const IMAGE_SIZE_SUGGEST = 10 * 1024 * 1024;
export const IMAGE_SIZE_WARN = 25 * 1024 * 1024;

/** A new reference image from a loaded file, at the top-left, not yet scaled. */
export function newReferenceImage(kind: "pdf" | "image", name: string, data: string): ReferenceImage {
  return { kind, name: name.slice(0, 200), data, page: 1, x: 0, y: 0, scale: 1, rotation: 0, opacity: 0.5, visible: true, locked: false, save: true };
}

/** True when the image's file isn't here (it wasn't saved with the project): pick it again to show it. */
export function isMissingFile(u: ReferenceImage): boolean {
  return !/,./.test(u.data);
}

/** The image as saved in the project: without its file when its save switch is off. */
export function savedImage(u: ReferenceImage | null): ReferenceImage | null {
  return u && !u.save ? { ...u, data: "" } : u;
}

/**
 * Scale an image so two points on it (a, b, in metatiles) end up `distance` metatiles
 * apart, keeping point a where it is. Returns false if it can't (the points are the same).
 */
export function calibrateImage(u: ReferenceImage, a: [number, number], b: [number, number], distance: number): boolean {
  const now = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (!(now > 0) || !(distance > 0)) return false;
  const k = distance / now;
  u.scale *= k;
  u.x = a[0] + (u.x - a[0]) * k;
  u.y = a[1] + (u.y - a[1]) * k;
  return true;
}

/**
 * Turn an image to `degrees` (clockwise), about its centre. `w`, `h` = its size in its own
 * units (image pixels or PDF points).
 */
export function rotateImage(u: ReferenceImage, degrees: number, w: number, h: number): void {
  const turn = (deg: number, x: number, y: number): [number, number] => {
    const a = (deg * Math.PI) / 180;
    return [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
  };
  const half: [number, number] = [(w * u.scale) / 2, (h * u.scale) / 2];
  const [cx0, cy0] = turn(u.rotation, ...half);
  const centre = [u.x + cx0, u.y + cy0];
  const next = ((((degrees + 180) % 360) + 360) % 360) - 180;
  const [cx1, cy1] = turn(next, ...half);
  u.rotation = next;
  u.x = centre[0] - cx1;
  u.y = centre[1] - cy1;
}

/** One reference image in a region: the sketch's or a map's. */
export interface RegionImage {
  /** "sketch", or the map's id. */
  owner: string;
  /** Where it is, for showing: "Region sketch" or the map's name. */
  label: string;
  image: ReferenceImage;
}

/** Every reference image in the region that has its file. */
export function regionImages(region: Region): RegionImage[] {
  const out: RegionImage[] = [];
  const u = region.sketch?.underlay;
  if (u && !isMissingFile(u)) out.push({ owner: "sketch", label: "Region sketch", image: u });
  for (const m of region.maps) if (m.underlay && !isMissingFile(m.underlay)) out.push({ owner: m.id, label: m.name, image: m.underlay });
  return out;
}

/** How many bytes the images set to be saved add to the project file. */
export function savedImageBytes(region: Region): number {
  return regionImages(region)
    .filter((r) => r.image.save)
    .reduce((n, r) => n + r.image.data.length, 0);
}

/** "3.4 MB" */
export function formatBytes(n: number): string {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}
