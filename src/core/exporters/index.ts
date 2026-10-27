// All exports go through one Exporter interface, so new ones (the planned
// Porymap paint script and map.bin writers) plug in without UI changes.

import { strToU8, zipSync } from "fflate";
import { SCREEN_HEIGHT_METATILES, SCREEN_WIDTH_METATILES } from "../constants";
import { ENTITY_PREFIX, PORYMAP_GROUP } from "../entities";
import type { MapBlueprint } from "../model";
import { ELEVATION_VALUES } from "../porymap";
import { renderBlueprint, screenName } from "./blueprint";
import { checklistHtml, checklistMarkdown, encountersHtml, headerSheetHtml, healLocations, jsonText, mapJson, page, rawGrid, screens } from "./rebuild";
import { wildEncountersEntry } from "../encounters";

export interface ExportContext {
  paletteId: string;
  regionName: string;
  appVersion: string;
  /** All maps in the project, to name neighbours in connections. */
  maps?: readonly MapBlueprint[];
}

export interface ExportFile {
  name: string;
  mime: string;
  data: Uint8Array | string;
}

export interface Exporter {
  id: string;
  label: string;
  description: string;
  run(map: MapBlueprint, ctx: ExportContext): ExportFile;
}

/** A safe file name from a map name: "Route 3 North" → "Route-3-North". */
export function fileBase(map: MapBlueprint): string {
  return map.name.replace(/[^A-Za-z0-9 _-]+/g, "").trim().replace(/\s+/g, "-") || map.id;
}

function subtitle(map: MapBlueprint, ctx: ExportContext) {
  return `${ctx.regionName} - ${map.width}X${map.height} - SEED ${map.seed} - ${map.header.id}`;
}

export const blueprintPng: Exporter = {
  id: "blueprint-png",
  label: "Blueprint (PNG)",
  description: "The whole map at Gen 3 size (16 px per cell) with rulers, grid, numbered things, sight lines and a legend.",
  run(map, ctx) {
    const img = renderBlueprint(map, { paletteId: ctx.paletteId, title: map.name, subtitle: subtitle(map, ctx), legend: true, labelEvery: 10 });
    return { name: `${fileBase(map)}-blueprint.png`, mime: "image/png", data: img.toPng() };
  },
};

export const elevationPng: Exporter = {
  id: "elevation-png",
  label: "Elevation (PNG)",
  description:
    "The map as Porymap's collision tab shows it: each cell in its elevation colour with its number (white = walkable, red = blocked). Keep it beside Porymap while setting elevations.",
  run(map, ctx) {
    const img = renderBlueprint(map, { paletteId: ctx.paletteId, title: `${map.name} elevation`, subtitle: subtitle(map, ctx), legend: true, labelEvery: 10, mode: "elevation" });
    return { name: `${fileBase(map)}-elevation.png`, mime: "image/png", data: img.toPng() };
  },
};

export const screenTilesZip: Exporter = {
  id: "screen-tiles",
  label: "Screen tiles (ZIP of PNGs)",
  description: "The map cut into 15×10 GBA screens named A1, B1, A2… with real coordinates, for rebuilding cell by cell. Each screen also comes as an elevation sheet.",
  run(map, ctx) {
    const base = fileBase(map);
    const files = screenFiles(map, ctx, `${base}-screens/`);
    return { name: `${base}-screens.zip`, mime: "application/zip", data: zip(files) };
  },
};

/** A zip with a fixed date, so identical maps give identical files. */
function zip(files: Record<string, Uint8Array>): Uint8Array {
  return zipSync(files, { level: 0, mtime: new Date("2000-01-01T00:00:00Z") });
}

/** The screen PNGs (and their elevation sheets) with an index, inside `folder`. */
function screenFiles(map: MapBlueprint, ctx: ExportContext, folder: string): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  const cols = Math.ceil(map.width / SCREEN_WIDTH_METATILES);
  const rows = Math.ceil(map.height / SCREEN_HEIGHT_METATILES);
  const index: string[] = [
    `${map.name} - screen tiles`,
    `Map ${map.width} x ${map.height} cells. Each tile is one GBA screen (15 x 10 cells).`,
    `Columns are letters (A = x 0-14, B = x 15-29, ...); rows are numbers (1 = y 0-9, 2 = y 10-19, ...).`,
    `The elevation folder has the same screens the way Porymap's collision tab shows them.`,
    "",
  ];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const x = c * SCREEN_WIDTH_METATILES;
      const y = r * SCREEN_HEIGHT_METATILES;
      const w = Math.min(SCREEN_WIDTH_METATILES, map.width - x);
      const h = Math.min(SCREEN_HEIGHT_METATILES, map.height - y);
      const name = screenName(c, r);
      const img = renderBlueprint(map, {
        paletteId: ctx.paletteId,
        area: { x, y, width: w, height: h },
        title: `${map.name} ${name}`,
        subtitle: `X ${x}-${x + w - 1}  Y ${y}-${y + h - 1}`,
        labelEvery: 5,
      });
      files[`${folder}${name}.png`] = img.toPng();
      const elev = renderBlueprint(map, {
        paletteId: ctx.paletteId,
        area: { x, y, width: w, height: h },
        title: `${map.name} ${name} elevation`,
        subtitle: `X ${x}-${x + w - 1}  Y ${y}-${y + h - 1}`,
        labelEvery: 5,
        mode: "elevation",
      });
      files[`${folder}elevation/${name}.png`] = elev.toPng();
      index.push(`${name}.png  x ${x}-${x + w - 1}, y ${y}-${y + h - 1}`);
    }
  files[`${folder}index.txt`] = strToU8(index.join("\r\n") + "\r\n");
  return files;
}

// --- Placement table --------------------------------------------------------------------

/** Field columns in a readable order; any other fields follow alphabetically. */
const FIELD_ORDER = [
  "graphics_id",
  "movement_type",
  "movement_range_x",
  "movement_range_y",
  "trainer_type",
  "trainer_sight_or_berry_tree_id",
  "script",
  "flag",
  "item",
  "tier",
  "var",
  "var_value",
  "player_facing_dir",
  "text",
];

const GROUP_ORDER = ["object", "warp", "coord", "bg", "heal"];
const GROUP_LABEL: Record<string, string> = {
  object: "Object",
  warp: "Warp",
  coord: "Coord event",
  bg: "BG event",
  heal: "Heal location",
};

export interface PlacementRow {
  id: string;
  kind: string;
  group: string;
  /** Position within its Porymap event list (Porymap shows these numbers). */
  index: number;
  x: number;
  y: number;
  elevation: string;
  elevationValue: string;
  fields: Record<string, string>;
}

export function placementRows(map: MapBlueprint): { rows: PlacementRow[]; fieldNames: string[] } {
  const rows: PlacementRow[] = [];
  const counters: Record<string, number> = {};
  const kindOrder = Object.keys(ENTITY_PREFIX);
  const entities = [...map.entities].sort(
    (a, b) =>
      GROUP_ORDER.indexOf(PORYMAP_GROUP[a.kind]) - GROUP_ORDER.indexOf(PORYMAP_GROUP[b.kind]) ||
      kindOrder.indexOf(a.kind) - kindOrder.indexOf(b.kind) ||
      a.id.localeCompare(b.id, "en", { numeric: true }),
  );
  const elevationValue = (e: string) => {
    const v = (ELEVATION_VALUES as Record<string, number>)[e];
    return typeof v === "number" ? String(v) : "";
  };
  for (const e of entities) {
    const group = PORYMAP_GROUP[e.kind];
    counters[group] = (counters[group] ?? 0) + 1;
    rows.push({
      id: e.id,
      kind: e.kind,
      group: GROUP_LABEL[group],
      index: counters[group],
      x: e.x,
      y: e.y,
      elevation: e.elevation,
      elevationValue: elevationValue(e.elevation),
      fields: Object.fromEntries(Object.entries(e.fields).map(([k, v]) => [k, String(v)])),
    });
  }
  map.warps.forEach((w, k) => {
    rows.push({
      id: `W${k}`,
      kind: `warp (${w.kind})`,
      group: GROUP_LABEL.warp,
      index: k,
      x: w.x,
      y: w.y,
      elevation: w.elevation,
      elevationValue: elevationValue(w.elevation),
      fields: { dest_map: w.destMap, dest_warp_id: w.destWarpId === null ? "" : String(w.destWarpId) },
    });
  });
  const seen = new Set(rows.flatMap((r) => Object.keys(r.fields)));
  const fieldNames = [...FIELD_ORDER.filter((f) => seen.has(f)), ...[...seen].filter((f) => !FIELD_ORDER.includes(f)).sort()];
  return { rows, fieldNames };
}

/** One CSV cell. Values that a spreadsheet would run as a formula are prefixed with ' (CSV injection guard). */
export function csvCell(v: string | number): string {
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const placementCsv: Exporter = {
  id: "placement-csv",
  label: "Placement table (CSV)",
  description: "One row per thing on the map with its position and suggested Porymap fields. Opens in Excel or Numbers.",
  run(map) {
    const { rows, fieldNames } = placementRows(map);
    const header = ["id", "kind", "porymap_group", "porymap_index", "x", "y", "elevation", "elevation_value", ...fieldNames];
    const lines = [header, ...rows.map((r) => [r.id, r.kind, r.group, r.index, r.x, r.y, r.elevation, r.elevationValue, ...fieldNames.map((f) => r.fields[f] ?? "")])];
    return { name: `${fileBase(map)}-placements.csv`, mime: "text/csv", data: lines.map((l) => l.map(csvCell).join(",")).join("\r\n") + "\r\n" };
  },
};

/** Escape text for HTML. Everything from the project is shown as plain text. */
export function escapeHtml(s: string | number): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export const placementHtml: Exporter = {
  id: "placement-html",
  label: "Placement table (printable page)",
  description: "The same table as a tidy page to print or keep open beside Porymap.",
  run(map, ctx) {
    const { rows, fieldNames } = placementRows(map);
    const head = ["ID", "Kind", "Porymap group", "#", "x", "y", "Elevation", ...fieldNames];
    const body = rows
      .map(
        (r) =>
          `<tr><td><b>${escapeHtml(r.id)}</b></td><td>${escapeHtml(r.kind.replace(/_/g, " "))}</td><td>${escapeHtml(r.group)}</td><td>${r.index}</td><td>${r.x}</td><td>${r.y}</td><td>${escapeHtml(r.elevation)}${r.elevationValue ? ` (${escapeHtml(r.elevationValue)})` : ""}</td>${fieldNames.map((f) => `<td>${escapeHtml(r.fields[f] ?? "")}</td>`).join("")}</tr>`,
      )
      .join("\n");
    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(map.name)} - placements</title>
<style>
body { font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; margin: 24px; color: #1e2226; }
h1 { font-size: 20px; margin: 0 0 4px; }
p { margin: 0 0 16px; color: #555; }
table { border-collapse: collapse; width: 100%; }
th, td { border: 1px solid #ccc; padding: 4px 6px; text-align: left; vertical-align: top; }
th { background: #eef1f2; position: sticky; top: 0; }
tr:nth-child(even) td { background: #f8f9f9; }
td { font-family: ui-monospace, Consolas, monospace; font-size: 12px; }
@media print { body { margin: 8mm; } th { position: static; } }
</style>
</head>
<body>
<h1>${escapeHtml(map.name)} - placements</h1>
<p>${escapeHtml(ctx.regionName)} &middot; ${map.width}&times;${map.height} &middot; seed ${map.seed} &middot; ${rows.length} things. Values are suggestions: check names against your project in Porymap.</p>
<table>
<thead><tr>${head.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead>
<tbody>
${body}
</tbody>
</table>
</body>
</html>
`;
    return { name: `${fileBase(map)}-placements.html`, mime: "text/html", data: html };
  },
};

// --- Header sheet, encounters, checklist, raw grid (see rebuild.ts) ---------------------

export const headerSheet: Exporter = {
  id: "header-sheet",
  label: "Header sheet (printable page)",
  description: "map.json header values, layout (size, border, tilesets) and connections with offsets, as a list and as JSON.",
  run(map, ctx) {
    return { name: `${fileBase(map)}-header-sheet.html`, mime: "text/html", data: headerSheetHtml(map, ctx) };
  },
};

export const mapJsonFile: Exporter = {
  id: "map-json",
  label: "map.json draft",
  description: "The whole map.json in pokeemerald's format: header, connections and every event, numbered as in the placement table.",
  run(map, ctx) {
    return { name: `${fileBase(map)}-map.json`, mime: "application/json", data: jsonText(mapJson(map, ctx.maps ?? [])) };
  },
};

export const encountersPage: Exporter = {
  id: "encounters",
  label: "Encounter draft (page and JSON)",
  description: "The draft wild encounter tables as a readable page, with the wild_encounters.json entry to paste.",
  run(map, ctx) {
    return { name: `${fileBase(map)}-encounters.html`, mime: "text/html", data: encountersHtml(map, ctx) };
  },
};

export const checklist: Exporter = {
  id: "checklist",
  label: "Rebuild checklist (page)",
  description: "Step-by-step rebuild in Porymap with this map's values: create, size and border, paint by screen, events, connections, encounters, then walk every exit.",
  run(map, ctx) {
    return { name: `${fileBase(map)}-checklist.html`, mime: "text/html", data: checklistHtml(map, ctx) };
  },
};

export const rawGridJson: Exporter = {
  id: "raw-grid",
  label: "Raw grid (JSON)",
  description: "The terrain, elevation and things as plain data, for scripts and the planned tileset tool.",
  run(map) {
    return { name: `${fileBase(map)}-grid.json`, mime: "application/json", data: jsonText(rawGrid(map)) };
  },
};

/** Everything for rebuilding one map, in one ZIP with an index page. */
export const rebuildPacket: Exporter = {
  id: "rebuild-packet",
  label: "Rebuild packet (everything, ZIP)",
  description: "All of the below in one folder, with an index page and the checklist to work through: blueprint, elevation sheet, screen tiles, placement table, header sheet, map.json, encounters and raw grid.",
  run(map, ctx) {
    const base = fileBase(map);
    const dir = `${base}-rebuild/`;
    const files: Record<string, Uint8Array> = {};
    const put = (name: string, data: Uint8Array | string) => (files[dir + name] = typeof data === "string" ? strToU8(data) : data);
    put("checklist.html", checklistHtml(map, ctx));
    put("checklist.md", checklistMarkdown(map, ctx));
    put("blueprint.png", blueprintPng.run(map, ctx).data as Uint8Array);
    put("elevation.png", elevationPng.run(map, ctx).data as Uint8Array);
    Object.assign(files, screenFiles(map, ctx, `${dir}screens/`));
    put("placements.html", placementHtml.run(map, ctx).data as string);
    put("placements.csv", placementCsv.run(map, ctx).data as string);
    put("header-sheet.html", headerSheetHtml(map, ctx));
    put("map.json", jsonText(mapJson(map, ctx.maps ?? [])));
    put("encounters.html", encountersHtml(map, ctx));
    if (map.encounterPlan) put("wild_encounters-entry.json", jsonText(wildEncountersEntry(map, map.encounterPlan)));
    const heals = healLocations(map);
    if (heals.length) put("heal_locations-entries.json", jsonText(heals));
    put("grid.json", jsonText(rawGrid(map)));
    const link = (href: string, label: string, note: string) => `<li><a href="${escapeHtml(href)}">${escapeHtml(label)}</a>: ${escapeHtml(note)}</li>`;
    const scr = screens(map);
    put(
      "index.html",
      page(
        `${map.name} - rebuild packet`,
        `<h1>${escapeHtml(map.name)} - rebuild packet</h1>
<p class="sub">${escapeHtml(ctx.regionName)} &middot; ${map.width}&times;${map.height} &middot; seed ${map.seed} &middot; made with Gen 3 Map Blueprint ${escapeHtml(ctx.appVersion)}</p>
<h2>Start here</h2>
<ul>${link("checklist.html", "Rebuild checklist", "the steps in order, with this map's values (also checklist.md)")}</ul>
<h2>Sheets</h2>
<ul>
${link("blueprint.png", "Blueprint", "the whole map with rulers, numbered things and sight lines")}
${link("elevation.png", "Elevation sheet", "as Porymap's collision tab shows it")}
${link("screens/index.txt", `Screen tiles (${scr.length})`, "screens/A1.png … one per GBA screen, plus screens/elevation/")}
${link("placements.html", "Placement table", "every thing with its Porymap fields (also placements.csv)")}
${link("header-sheet.html", "Header sheet", "header values, layout and connections")}
${link("encounters.html", "Encounter draft", "the wild Pokémon tables")}
</ul>
<h2>Files to paste or keep</h2>
<ul>
${link("map.json", "map.json", "the full map.json draft for data/maps/${map.header.name}/")}
${map.encounterPlan ? link("wild_encounters-entry.json", "wild_encounters-entry.json", "this map's entry for src/data/wild_encounters.json") : ""}
${heals.length ? link("heal_locations-entries.json", "heal_locations-entries.json", "entries for src/data/heal_locations.json") : ""}
${link("grid.json", "grid.json", "the raw grid (terrain, elevation, things) for scripts")}
</ul>`,
      ),
    );
    return { name: `${base}-rebuild.zip`, mime: "application/zip", data: zip(files) };
  },
};

export const EXPORTERS: readonly Exporter[] = [
  rebuildPacket,
  checklist,
  blueprintPng,
  elevationPng,
  screenTilesZip,
  placementCsv,
  placementHtml,
  headerSheet,
  mapJsonFile,
  encountersPage,
  rawGridJson,
];
