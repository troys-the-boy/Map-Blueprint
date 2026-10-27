import { unzipSync, unzlibSync } from "fflate";
import { describe, expect, it } from "vitest";
import { EXPORTERS, blueprintPng, csvCell, placementCsv, placementHtml, screenTilesZip } from "../src/core/exporters";
import { applyResult, generateRoute } from "../src/core/generate";
import { addNewMap, newRegion } from "../src/core/model";

const ctx = { paletteId: "pnw", regionName: "Test Region", appVersion: "test" };

function generated(seed = 11, width = 30, height = 60) {
  const map = addNewMap(newRegion("Test Region", 1), { name: "Route 1", mapType: "route", width, height, seed });
  applyResult(map, generateRoute(map));
  return map;
}

/** Check a PNG's signature, size, and that its pixel data decompresses to the right length. */
function readPng(bytes: Uint8Array) {
  expect(Array.from(bytes.slice(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  let o = 8;
  const idat: Uint8Array[] = [];
  while (o < bytes.length) {
    const len = view.getUint32(o);
    const type = String.fromCharCode(...bytes.slice(o + 4, o + 8));
    if (type === "IDAT") idat.push(bytes.slice(o + 8, o + 8 + len));
    o += 12 + len;
  }
  const raw = unzlibSync(idat.length === 1 ? idat[0] : new Uint8Array(idat.flatMap((p) => Array.from(p))));
  expect(raw.length).toBe(height * (width * 4 + 1));
  return { width, height };
}

describe("exports", () => {
  it("blueprint PNG is a valid image with 16 px per cell", () => {
    const map = generated();
    const file = blueprintPng.run(map, ctx);
    expect(file.name).toBe("Route-1-blueprint.png");
    const { width, height } = readPng(file.data as Uint8Array);
    expect(width).toBeGreaterThan(30 * 16);
    expect(height).toBeGreaterThan(60 * 16);
  });

  it("every export is identical for the same map (deterministic)", () => {
    for (const e of EXPORTERS) {
      const a = e.run(generated(5), ctx).data;
      const b = e.run(generated(5), ctx).data;
      expect(a).toEqual(b);
    }
    // The rebuild packet draws every sheet, so this takes a few seconds.
  }, 30_000);

  it("screen tiles: one valid PNG per 15×10 screen, named A1, B1…", () => {
    const map = generated(3, 20, 40); // 2 columns × 4 rows of screens
    const files = unzipSync(screenTilesZip.run(map, ctx).data as Uint8Array);
    const names = Object.keys(files).sort();
    expect(names).toContain("Route-1-screens/A1.png");
    expect(names).toContain("Route-1-screens/B4.png");
    expect(names).toContain("Route-1-screens/index.txt");
    expect(names.filter((n) => n.endsWith(".png") && !n.includes("/elevation/"))).toHaveLength(8);
    for (const n of names.filter((x) => x.endsWith(".png"))) readPng(files[n]);
  });

  it("placement CSV has one row per thing, in Porymap order", () => {
    const map = generated();
    const csv = placementCsv.run(map, ctx).data as string;
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toMatch(/^id,kind,porymap_group,porymap_index,x,y,elevation,elevation_value,/);
    expect(lines).toHaveLength(map.entities.length + 1);
    // Objects come first and are numbered 1, 2, 3…
    expect(lines[1]).toMatch(/,Object,1,/);
  });

  it("CSV values can't run as spreadsheet formulas", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvCell(12)).toBe("12");
  });

  it("printable page shows project text as plain text, never as HTML", () => {
    const map = generated();
    map.name = '<script>alert("x")</script>';
    map.entities[0].fields.script = "<img src=x onerror=alert(1)>";
    const html = placementHtml.run(map, ctx).data as string;
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("Content-Security-Policy");
  });
});
