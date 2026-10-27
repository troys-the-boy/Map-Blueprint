// The rebuild packet's sheets: a map.json draft and header sheet, the encounter
// draft, the step-by-step rebuild checklist, and the raw grid.
//
// map.json follows pokeemerald's data/maps/*/map.json exactly (key order and
// event fields checked against Route101, Route104, Route119 and
// LittlerootTown_BrendansHouse_1F): id, name, layout, music, region_map_section,
// requires_flash, weather, map_type, allow_cycling, allow_escaping,
// allow_running, show_map_name, battle_scene, connections (null when there are
// none), object_events, warp_events, coord_events, bg_events. Heal locations
// live in src/data/heal_locations.json (id, map, x, y) instead.

import { SCREEN_HEIGHT_METATILES, SCREEN_WIDTH_METATILES } from "../constants";
import { TABLES, TABLE_LABELS, SLOT_CHANCES, wildEncountersEntry } from "../encounters";
import type { EncounterPlan } from "../encounters";
import type { Entity, MapBlueprint } from "../model";
import { ELEVATION_VALUES } from "../porymap";
import { ELEVATION_LEVELS, TERRAIN_TYPES } from "../terrain";
import { screenName } from "./blueprint";
import type { ExportContext } from "./index";
import { escapeHtml, placementRows } from "./index";

/** Porymap's elevation number for a thing's level. */
function elevationNumber(level: string): number {
  return (ELEVATION_VALUES as Record<string, number>)[level] ?? ELEVATION_VALUES.ground;
}

/** "MAP_ROUTE101" → "LAYOUT_ROUTE101", as vanilla names layouts. */
export function layoutConstant(map: MapBlueprint): string {
  return map.header.id.replace(/^MAP_/, "LAYOUT_");
}

/** A map's MAP_* constant from its internal id (connections store internal ids). */
function mapConstant(maps: readonly MapBlueprint[], id: string): string {
  return maps.find((m) => m.id === id)?.header.id ?? id;
}

const text = (v: unknown, fallback = "0") => (v === undefined || v === null || v === "" ? fallback : String(v));
const whole = (v: unknown) => (typeof v === "number" ? v : Number.isFinite(Number(v)) ? Number(v) : 0);

function objectEvent(e: Entity) {
  const f = e.fields;
  return {
    graphics_id: text(f.graphics_id, "OBJ_EVENT_GFX_ITEM_BALL"),
    x: e.x,
    y: e.y,
    elevation: elevationNumber(e.elevation),
    movement_type: text(f.movement_type, "MOVEMENT_TYPE_LOOK_AROUND"),
    movement_range_x: whole(f.movement_range_x),
    movement_range_y: whole(f.movement_range_y),
    trainer_type: text(f.trainer_type, "TRAINER_TYPE_NONE"),
    trainer_sight_or_berry_tree_id: text(f.trainer_sight_or_berry_tree_id),
    script: text(f.script),
    flag: text(f.flag),
  };
}

function coordEvent(e: Entity) {
  const f = e.fields;
  const base = { type: f.type === "weather" ? "weather" : "trigger", x: e.x, y: e.y, elevation: elevationNumber(e.elevation) };
  return f.type === "weather" ? { ...base, weather: text(f.weather, "COORD_EVENT_WEATHER_SUNNY") } : { ...base, var: text(f.var), var_value: text(f.var_value), script: text(f.script) };
}

function bgEvent(e: Entity) {
  const f = e.fields;
  const base = { x: e.x, y: e.y, elevation: elevationNumber(e.elevation) };
  if (e.kind === "hidden_item") return { type: "hidden_item", ...base, item: text(f.item, "ITEM_POTION"), flag: text(f.flag) };
  if (e.kind === "secret_base") return { type: "secret_base", ...base, secret_base_id: text(f.secret_base_id) };
  return { type: "sign", ...base, player_facing_dir: text(f.player_facing_dir, "BG_EVENT_PLAYER_FACING_ANY"), script: text(f.script) };
}

/**
 * The map's map.json, drafted from the blueprint. Events are listed in the same
 * order as the placement table, so its numbers match Porymap's event lists.
 */
export function mapJson(map: MapBlueprint, maps: readonly MapBlueprint[] = []): Record<string, unknown> {
  const h = map.header;
  const byId = new Map(map.entities.map((e) => [e.id, e]));
  const ordered = placementRows(map).rows.map((r) => byId.get(r.id)).filter((e): e is Entity => !!e);
  const of = (group: string) => ordered.filter((e) => groupOf(e) === group);
  const out: Record<string, unknown> = {
    id: h.id,
    name: h.name,
    layout: layoutConstant(map),
    music: h.music,
    region_map_section: h.region_map_section,
    requires_flash: h.requires_flash,
    weather: h.weather,
    map_type: h.map_type,
    allow_cycling: h.allow_cycling,
    allow_escaping: h.allow_escaping,
    allow_running: h.allow_running,
    show_map_name: h.show_map_name,
  };
  // floor_number isn't in vanilla Emerald's map.json; include it only when set.
  if (h.floor_number !== null) out.floor_number = h.floor_number;
  out.battle_scene = h.battle_scene;
  out.connections = map.connections.length ? map.connections.map((c) => ({ map: mapConstant(maps, c.map), offset: c.offset, direction: c.direction })) : null;
  out.object_events = of("object").map(objectEvent);
  out.warp_events = map.warps.map((w) => ({ x: w.x, y: w.y, elevation: elevationNumber(w.elevation), dest_map: w.destMap || "MAP_NONE", dest_warp_id: String(w.destWarpId ?? 0) }));
  out.coord_events = of("coord").map(coordEvent);
  out.bg_events = of("bg").map(bgEvent);
  return out;
}

function groupOf(e: Entity): string {
  if (e.kind === "trigger") return "coord";
  if (e.kind === "sign" || e.kind === "hidden_item" || e.kind === "secret_base") return "bg";
  if (e.kind === "heal_location") return "heal";
  return "object";
}

/** Entries for src/data/heal_locations.json, if the map has any. */
export function healLocations(map: MapBlueprint): Array<{ id: string; map: string; x: number; y: number }> {
  return map.entities
    .filter((e) => e.kind === "heal_location")
    .map((e) => ({ id: text(e.fields.id, `HEAL_LOCATION_${map.header.id.replace(/^MAP_/, "")}`), map: text(e.fields.map, map.header.id), x: e.x, y: e.y }));
}

/** JSON as it appears in pokeemerald's files: two-space indent, one event per block. */
export function jsonText(v: unknown): string {
  return JSON.stringify(v, null, 2) + "\n";
}

// --- Pages -------------------------------------------------------------------------------

/** A small self-contained printable page (no scripts, no outside files). */
export function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'self'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
body { font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; margin: 24px; color: #1e2226; max-width: 960px; }
h1 { font-size: 22px; margin: 0 0 4px; }
h2 { font-size: 17px; margin: 24px 0 8px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
h3 { font-size: 15px; margin: 16px 0 6px; }
p.sub { margin: 0 0 16px; color: #555; }
table { border-collapse: collapse; margin: 6px 0 12px; }
th, td { border: 1px solid #ccc; padding: 3px 8px; text-align: left; vertical-align: top; }
th { background: #eef1f2; }
code, pre, td.mono { font-family: ui-monospace, Consolas, monospace; font-size: 12.5px; }
pre { background: #f4f6f7; border: 1px solid #ddd; border-radius: 6px; padding: 10px; overflow-x: auto; }
ol.steps > li { margin-bottom: 14px; }
li.check { list-style: none; margin-left: -20px; }
li.check::before { content: "☐  "; }
.note { color: #555; }
a { color: #1d5f8a; }
@media print { body { margin: 8mm; } pre { white-space: pre-wrap; } }
</style>
</head>
<body>
${body}
</body>
</html>
`;
}

const row = (label: string, value: string | number | boolean) => `<tr><th>${escapeHtml(label)}</th><td class="mono">${escapeHtml(String(value))}</td></tr>`;

const DIRECTION_WORDS: Record<string, string> = { up: "north edge", down: "south edge", left: "west edge", right: "east edge", dive: "dive (underwater map)", emerge: "emerge (surface map)" };

function terrainLabel(id: string) {
  return TERRAIN_TYPES.find((t) => t.id === id)?.label ?? id;
}

/** Edge entrances described for the header sheet and checklist. */
function openingLines(map: MapBlueprint): string[] {
  return map.openings.map((o) => {
    const along = o.edge === "north" || o.edge === "south" ? "x" : "y";
    return `${o.edge} edge, ${along} ${o.start}–${o.start + o.width - 1} (${o.width} wide, ${o.kind === "surf" ? "surfing" : "walking"})`;
  });
}

/** The header sheet: map.json header values, layout and connections, readable and as JSON. */
export function headerSheetHtml(map: MapBlueprint, ctx: ExportContext): string {
  const h = map.header;
  const json = mapJson(map, ctx.maps ?? []);
  const header = Object.fromEntries(Object.entries(json).filter(([k]) => !k.endsWith("_events")));
  const conn = map.connections.length
    ? `<table><tr><th>Edge</th><th>Map</th><th>Offset</th></tr>${map.connections
        .map((c) => `<tr><td>${escapeHtml(DIRECTION_WORDS[c.direction] ?? c.direction)} (<code>${c.direction}</code>)</td><td class="mono">${escapeHtml(mapConstant(ctx.maps ?? [], c.map))}</td><td class="mono">${c.offset}</td></tr>`)
        .join("")}</table>`
    : `<p class="note">No connections yet (set them in the Details tab).</p>`;
  const openings = openingLines(map);
  return page(
    `${map.name} - header sheet`,
    `<h1>${escapeHtml(map.name)} - header sheet</h1>
<p class="sub">${escapeHtml(ctx.regionName)} &middot; values for Porymap's header and layout. They're suggestions: change any to fit your project.</p>
<h2>Header (map.json)</h2>
<table>
${row("Map constant (id)", h.id)}
${row("Name", h.name)}
${row("Layout", layoutConstant(map))}
${row("Music", h.music)}
${row("Region map section", h.region_map_section)}
${row("Weather", h.weather)}
${row("Map type", h.map_type)}
${row("Requires Flash", h.requires_flash)}
${row("Allow cycling", h.allow_cycling)}
${row("Allow escaping", h.allow_escaping)}
${row("Allow running", h.allow_running)}
${row("Show map name", h.show_map_name)}
${row("Battle scene", h.battle_scene)}
${h.floor_number !== null ? row("Floor number", h.floor_number) : ""}
</table>
<h2>Layout</h2>
<table>
${row("Size", `${map.width} × ${map.height} metatiles`)}
${row("Border block (2×2)", map.layout.borderBlock.map(terrainLabel).join(", "))}
${row("Primary tileset", map.layout.primaryTileset || "(pick in Porymap)")}
${row("Secondary tileset", map.layout.secondaryTileset || "(pick in Porymap)")}
</table>
<h2>Connections</h2>
${conn}
${openings.length ? `<h3>Entrances on this map</h3><ul>${openings.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul><p class="note">The neighbouring map's entrance must line up with these exactly.</p>` : ""}
<h2>JSON</h2>
<p class="note">The header part of map.json. The full file with every event is <code>map.json</code> in the packet.</p>
<pre>${escapeHtml(jsonText(header))}</pre>`,
  );
}

/** The encounter draft as a readable page plus the wild_encounters.json entry. */
export function encountersHtml(map: MapBlueprint, ctx: ExportContext): string {
  const plan: EncounterPlan = map.encounterPlan ?? {};
  const tables = TABLES.filter((k) => plan[k]);
  const ROD: Record<number, string> = { 0: "Old Rod", 2: "Good Rod", 5: "Super Rod" };
  const body = tables
    .map((kind) => {
      const t = plan[kind]!;
      const rows = t.slots
        .map(
          (s, k) =>
            `${kind === "fish" && ROD[k] ? `<tr><th colspan="4">${ROD[k]}</th></tr>` : ""}<tr><td>${SLOT_CHANCES[kind][k]}%</td><td class="mono">${escapeHtml(s.species)}</td><td>${s.min}</td><td>${s.max}</td></tr>`,
        )
        .join("");
      return `<h2>${escapeHtml(TABLE_LABELS[kind])} &middot; encounter rate ${t.rate}</h2><table><tr><th>Chance</th><th>Species</th><th>Min</th><th>Max</th></tr>${rows}</table>`;
    })
    .join("\n");
  return page(
    `${map.name} - encounters`,
    `<h1>${escapeHtml(map.name)} - wild encounters</h1>
<p class="sub">${escapeHtml(ctx.regionName)} &middot; draft tables. Paste the JSON below into <code>src/data/wild_encounters.json</code> (in the "encounters" list of the gWildMonHeaders group), or enter it in Porymap's Wild Pokémon tab.</p>
${tables.length ? body : `<p class="note">No encounter tables yet. Add a species list in Generate → Gameplay → Encounters.</p>`}
${tables.length ? `<h2>JSON</h2><pre>${escapeHtml(jsonText(wildEncountersEntry(map, plan)))}</pre>` : ""}`,
  );
}

// --- Rebuild checklist ----------------------------------------------------------------------

/** The screens of the map, A1, B1… with their cell ranges. */
export function screens(map: MapBlueprint): Array<{ name: string; x: number; y: number; w: number; h: number }> {
  const out = [];
  for (let r = 0; r < Math.ceil(map.height / SCREEN_HEIGHT_METATILES); r++)
    for (let c = 0; c < Math.ceil(map.width / SCREEN_WIDTH_METATILES); c++) {
      const x = c * SCREEN_WIDTH_METATILES;
      const y = r * SCREEN_HEIGHT_METATILES;
      out.push({ name: screenName(c, r), x, y, w: Math.min(SCREEN_WIDTH_METATILES, map.width - x), h: Math.min(SCREEN_HEIGHT_METATILES, map.height - y) });
    }
  return out;
}

interface Step {
  title: string;
  items: string[];
}

/** The ordered steps for rebuilding the map in Porymap (spec: Outputs → Rebuild checklist). */
export function checklistSteps(map: MapBlueprint, ctx: ExportContext): Step[] {
  const h = map.header;
  const maps = ctx.maps ?? [];
  const { rows } = placementRows(map);
  const count = (group: string) => rows.filter((r) => r.group === group).length;
  const plan = map.encounterPlan ?? {};
  const tables = TABLES.filter((k) => plan[k]);
  const heals = healLocations(map);
  const levelsUsed = new Set<number>();
  for (const v of map.layers.elevation.data) levelsUsed.add(v);
  const levels = [...levelsUsed]
    .map((v) => ELEVATION_LEVELS[v])
    .sort((a, b) => ELEVATION_VALUES[a] - ELEVATION_VALUES[b])
    .map((l) => `${l} = ${ELEVATION_VALUES[l]}`);
  const n = (k: number, word: string) => `${k} ${word}${k === 1 ? "" : "s"}`;
  const scr = screens(map);
  return [
    {
      title: "Create the map with these settings",
      items: [
        `In Porymap, make a new map named ${h.name} (constant ${h.id}, layout ${layoutConstant(map)}).`,
        `Map type ${h.map_type}, music ${h.music}, region map section ${h.region_map_section}, weather ${h.weather}, battle scene ${h.battle_scene}.`,
        `Requires Flash ${h.requires_flash}, allow cycling ${h.allow_cycling}, allow escaping ${h.allow_escaping}, allow running ${h.allow_running}, show map name ${h.show_map_name}.`,
        "All values are on the header sheet (and in map.json).",
      ],
    },
    {
      title: "Set the size and border",
      items: [
        `Resize the map to ${map.width} × ${map.height} metatiles.`,
        `Border block (2×2): ${map.layout.borderBlock.map(terrainLabel).join(", ")}; use your tileset's matching metatiles.`,
        map.layout.primaryTileset || map.layout.secondaryTileset
          ? `Tilesets: ${map.layout.primaryTileset || "(primary)"} and ${map.layout.secondaryTileset || "(secondary)"}.`
          : "Pick the primary and secondary tilesets (the same ones as the neighbouring maps, or the seams will look broken).",
      ],
    },
    {
      title: "Paint by screen tile",
      items: [
        `Paint the ${scr.length} screens one at a time with the screen PNGs beside Porymap: ${scr.map((s) => `${s.name} (x ${s.x}–${s.x + s.w - 1}, y ${s.y}–${s.y + s.h - 1})`).join(", ")}.`,
        `Then set elevations in the collision tab, screen by screen, from the elevation PNGs. Levels used: ${levels.join(", ")}; stairs are ${ELEVATION_VALUES.transition} (transition).`,
        "Ledges, water, stairs and bridges need the right metatile behaviours, or the player walks through them.",
      ],
    },
    {
      title: "Place events",
      items: [
        `From the placement table, in its order (so the numbers match Porymap's lists): ${n(count("Object"), "object")}, ${n(map.warps.length, "warp")}, ${n(count("Coord event"), "coord event")}, ${n(count("BG event"), "BG event")}.`,
        "Trainers: set facing, sight range and trainer type; then write their scripts and battles.",
        ...map.warps.map((w, k) => `Warp W${k} at (${w.x}, ${w.y}) → ${w.destMap || "(not set yet)"}, warp ${w.destWarpId ?? "?"}: check the warp there leads back.`),
        ...(heals.length ? [`Heal location${heals.length === 1 ? "" : "s"}: add ${heals.map((x) => `${x.id} (${x.x}, ${x.y})`).join(", ")} to src/data/heal_locations.json.`] : []),
      ],
    },
    {
      title: "Set connections",
      items: map.connections.length
        ? [
            ...map.connections.map((c) => `${DIRECTION_WORDS[c.direction] ?? c.direction}: ${mapConstant(maps, c.map)}, offset ${c.offset}.`),
            "On each neighbouring map, add the matching connection back, and check the entrances line up cell for cell.",
          ]
        : [`No connections set. Entrances: ${openingLines(map).join("; ") || "none"}. Add the neighbouring maps' connections in Porymap so these line up.`],
    },
    {
      title: "Paste encounters",
      items: tables.length
        ? [
            `Add the map's entry to src/data/wild_encounters.json (or Porymap's Wild Pokémon tab): ${tables.map((k) => `${TABLE_LABELS[k]} (rate ${plan[k]!.rate})`).join(", ")}.`,
            "The JSON is on the encounters page and in wild_encounters-entry.json.",
          ]
        : ["This map has no encounter tables (or no draft yet)."],
    },
    {
      title: "Run the game and walk every exit",
      items: [
        "Build the game and walk the whole route: every entrance, warp and ledge, and every trainer's sight line.",
        ...openingLines(map).map((l) => `Exit: ${l}.`),
        ...map.warps.map((w, k) => `Warp W${k} at (${w.x}, ${w.y}): go through and back.`),
      ],
    },
  ];
}

export function checklistMarkdown(map: MapBlueprint, ctx: ExportContext): string {
  const steps = checklistSteps(map, ctx);
  return (
    `# ${map.name}: rebuild checklist\n\n${ctx.regionName} · ${map.width}×${map.height} · seed ${map.seed}\n\n` +
    steps.map((s, k) => `## ${k + 1}. ${s.title}\n\n${s.items.map((i) => `- [ ] ${i}`).join("\n")}\n`).join("\n")
  );
}

export function checklistHtml(map: MapBlueprint, ctx: ExportContext): string {
  const steps = checklistSteps(map, ctx);
  return page(
    `${map.name} - rebuild checklist`,
    `<h1>${escapeHtml(map.name)} - rebuild checklist</h1>
<p class="sub">${escapeHtml(ctx.regionName)} &middot; ${map.width}&times;${map.height} &middot; seed ${map.seed}. Work down the list with Porymap open.</p>
<ol class="steps">
${steps.map((s) => `<li><b>${escapeHtml(s.title)}</b><ul>${s.items.map((i) => `<li class="check">${escapeHtml(i)}</li>`).join("")}</ul></li>`).join("\n")}
</ol>`,
  );
}

// --- Raw grid -----------------------------------------------------------------------------

/**
 * The raw grid: terrain, elevation and things, for the planned Porymap script
 * exporter and tileset tool. Format "gen3-map-blueprint-grid", version 1 (see docs/formats.md).
 */
export function rawGrid(map: MapBlueprint): Record<string, unknown> {
  const rows = (data: Uint8Array) => Array.from({ length: map.height }, (_, y) => Array.from(data.subarray(y * map.width, (y + 1) * map.width)));
  return {
    format: "gen3-map-blueprint-grid",
    version: 1,
    map: map.header.id,
    width: map.width,
    height: map.height,
    terrain: { legend: TERRAIN_TYPES.map((t) => t.id), rows: rows(map.layers.terrain.data) },
    elevation: { legend: [...ELEVATION_LEVELS], values: ELEVATION_LEVELS.map((l) => ELEVATION_VALUES[l]), rows: rows(map.layers.elevation.data) },
    entities: map.entities.map((e) => ({ id: e.id, kind: e.kind, x: e.x, y: e.y, elevation: e.elevation, fields: e.fields })),
    warps: map.warps.map((w, k) => ({ number: k, kind: w.kind, x: w.x, y: w.y, elevation: w.elevation, dest_map: w.destMap, dest_warp_id: w.destWarpId })),
  };
}
