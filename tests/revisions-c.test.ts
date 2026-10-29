// Revisions after Milestone 6, part C: reference images on maps, and saving them or not.

import { describe, expect, it } from "vitest";
import { addNewMap, newRegion } from "../src/core/model";
import { CURRENT_SCHEMA_VERSION, migrate, parseProject, serializeProject } from "../src/core/project";
import { calibrateImage, isMissingFile, newReferenceImage, regionImages, rotateImage, savedImageBytes } from "../src/core/referenceImage";
import { newSketch } from "../src/core/sketch";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";

function region() {
  const r = newRegion("r", 1);
  const m = addNewMap(r, { name: "Route 1", mapType: "route", width: 30, height: 60, seed: 1, biome: "meadow" });
  r.sketch = newSketch(200, 200);
  return { r, m };
}

describe("reference images on maps", () => {
  it("a map's image is saved with the project, and comes back as it was", () => {
    const { r, m } = region();
    m.underlay = { ...newReferenceImage("image", "screenshot.png", PNG), x: 2.5, y: -1, scale: 1 / 16, rotation: 90, opacity: 0.7 };
    expect(CURRENT_SCHEMA_VERSION).toBe(15);
    const back = parseProject(serializeProject(r, "test"));
    expect(back.maps[0].underlay).toEqual(m.underlay);
  });

  it("with saving off, the file is left out but its place is kept", () => {
    const { r, m } = region();
    m.underlay = { ...newReferenceImage("image", "screenshot.png", PNG), x: 4, y: 5, scale: 0.25, save: false };
    r.sketch!.underlay = { ...newReferenceImage("pdf", "plan.pdf", "data:application/pdf;base64,JVBERi0="), save: false };
    const text = serializeProject(r, "test");
    expect(text).not.toContain("iVBORw0KGgo");
    expect(text).not.toContain("JVBERi0");
    const back = parseProject(text);
    const u = back.maps[0].underlay!;
    expect(u).toEqual({ ...m.underlay, data: "" });
    expect(isMissingFile(u)).toBe(true);
    expect(back.sketch!.underlay!.name).toBe("plan.pdf");
    // Nothing missing is counted, and the project still has the image in memory.
    expect(regionImages(back)).toEqual([]);
    expect(isMissingFile(m.underlay)).toBe(false);
  });

  it("counts only the images set to be saved", () => {
    const { r, m } = region();
    m.underlay = newReferenceImage("image", "a.png", PNG);
    r.sketch!.underlay = { ...newReferenceImage("image", "b.png", PNG + "AAAA"), save: false };
    expect(regionImages(r).map((x) => x.owner)).toEqual(["sketch", m.id]);
    expect(savedImageBytes(r)).toBe(PNG.length);
  });

  it("older files open with no map images, and the sketch's drawing set to be saved", () => {
    const { r } = region();
    r.sketch!.underlay = newReferenceImage("image", "plan.png", PNG);
    const file = JSON.parse(serializeProject(r, "test"));
    // Make it look like a version-14 file.
    file.schemaVersion = 14;
    delete file.region.maps[0].underlay;
    delete file.region.sketch.underlay.save;
    const up = migrate(file) as { region: { maps: Array<{ underlay: unknown }>; sketch: { underlay: { save: boolean } } } };
    expect(up.region.maps[0].underlay).toBeNull();
    expect(up.region.sketch.underlay.save).toBe(true);
    const back = parseProject(JSON.stringify(file));
    expect(back.maps[0].underlay).toBeNull();
    expect(back.sketch!.underlay!.save).toBe(true);
  });

  it("rejects an image file that isn't a picture or PDF", () => {
    const { r, m } = region();
    m.underlay = { ...newReferenceImage("image", "x", "data:text/html;base64,PHA+") };
    expect(() => parseProject(serializeProject(r, "test"))).toThrow(/underlay/);
  });
});

describe("lining an image up", () => {
  it("two-point scale keeps the first point where it is", () => {
    const u = newReferenceImage("image", "a.png", PNG);
    Object.assign(u, { x: 10, y: 10, scale: 1 });
    // Points 20 metatiles apart on screen should be 5 apart.
    expect(calibrateImage(u, [10, 10], [30, 10], 5)).toBe(true);
    expect(u.scale).toBeCloseTo(0.25);
    expect([u.x, u.y]).toEqual([10, 10]);
    expect(calibrateImage(u, [3, 3], [3, 3], 5)).toBe(false);
  });

  it("turning keeps the centre in place", () => {
    const u = newReferenceImage("image", "a.png", PNG);
    Object.assign(u, { x: 0, y: 0, scale: 1 });
    rotateImage(u, 90, 40, 20);
    // Centre was (20, 10); after a quarter turn the 40×20 image is 20 wide, 40 tall about it.
    expect(u.rotation).toBe(90);
    expect(u.x).toBeCloseTo(30);
    expect(u.y).toBeCloseTo(-10);
  });
});
