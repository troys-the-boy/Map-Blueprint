// The Details tab: every Porymap field of the picked thing (Things tool), and
// the map's own settings: map.json header, layout (border, tilesets) and
// connections. Values are suggestions you can change; the boxes offer vanilla
// pokeemerald names as you type (see core/porymapValues.ts).

import type { Connection, ConnectionDirection, MapHeader } from "../../core/model";
import { CONNECTION_DIRECTIONS, WARP_KINDS } from "../../core/model";
import { BATTLE_SCENES, FIELD_HELP, FIELD_SUGGESTIONS, MAP_TYPES_PORYMAP, MAP_WEATHER } from "../../core/porymapValues";
import { TERRAIN_TYPES } from "../../core/terrain";
import { THING_LABELS, WARP_LABELS, isWarp, thingTag } from "../../core/things";
import type { Thing } from "../../core/things";
import { useStore } from "../store";
import { Icon } from "./icons";

/** Constants are letters, digits and underscores; anything else is dropped as you type. */
const constant = (v: string) => v.replace(/[^A-Za-z0-9_]/g, "").slice(0, 64);

const DIRECTION_LABELS: Record<ConnectionDirection, string> = { up: "North (up)", down: "South (down)", left: "West (left)", right: "East (right)", dive: "Dive (underwater)", emerge: "Emerge (from underwater)" };

/** A text box with suggestions (the browser shows them as you type). */
function Suggest({ id, value, options, onChange, title, maxLength = 100 }: { id: string; value: string; options?: string[]; onChange: (v: string) => void; title?: string; maxLength?: number }) {
  return (
    <>
      <input value={value} list={options ? `${id}-list` : undefined} maxLength={maxLength} title={title} spellCheck={false} autoCapitalize="off" onChange={(e) => onChange(e.target.value)} />
      {options && (
        <datalist id={`${id}-list`}>
          {options.map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
      )}
    </>
  );
}

export function PropertiesPanel() {
  const s = useStore();
  const map = s.currentMap;
  if (!map) return null;
  const t = s.pickedThing;
  return (
    <div className="properties-panel">
      {t ? (
        <ThingProperties thing={t} />
      ) : (
        <p className="hint">Pick a thing with the Things tool (T) to see and edit its Porymap fields here.</p>
      )}
      <MapProperties />
    </div>
  );
}

function ThingProperties({ thing: t }: { thing: Thing }) {
  const s = useStore();
  const map = s.currentMap!;
  const issue = !isWarp(t) && s.issues.find((i) => i.code === "unavoidable-trainer" && i.entityId === t.id);
  const accepted = !isWarp(t) && (t.accepted ?? []).includes("unavoidable-trainer");
  return (
    <section className="props-section">
      <h3>
        <span className="props-tag">{thingTag(map, t)}</span> {isWarp(t) ? `Warp: ${WARP_LABELS[t.kind]}` : THING_LABELS[t.kind]}
      </h3>
      <p className="hint">
        At x {t.x}, y {t.y}, elevation {t.elevation}. Drag it with the Things tool to move it.
      </p>
      {isWarp(t) ? (
        <>
          <label className="field" title="What the player walks into.">
            <span>Kind</span>
            <select value={t.kind} onChange={(e) => s.editThing("kind", (w) => isWarp(w) && (w.kind = e.target.value as typeof w.kind))}>
              {WARP_KINDS.map((k) => (
                <option key={k} value={k}>
                  {WARP_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="field" title="dest_map: the map this warp leads to (MAP_*). Pick one of this project's maps or type a constant.">
            <span>Leads to (dest_map)</span>
            <Suggest
              id="warp-dest"
              value={t.destMap}
              options={s.region.maps.filter((m) => m.id !== map.id).map((m) => m.header.id)}
              onChange={(v) => s.editThing("destMap", (w) => isWarp(w) && (w.destMap = constant(v)))}
            />
          </label>
          <label className="field" title="dest_warp_id: which warp on that map the player comes out of (its W number there).">
            <span>Arrives at warp (dest_warp_id)</span>
            <input
              type="number"
              min={0}
              max={255}
              value={t.destWarpId ?? ""}
              onChange={(e) => s.editThing("destWarpId", (w) => isWarp(w) && (w.destWarpId = e.target.value === "" ? null : Math.max(0, Math.min(255, Math.round(Number(e.target.value)) || 0))))}
            />
          </label>
          <p className="hint">This is warp {thingTag(map, t)} in Porymap's list (warps are numbered from 0 in the order placed).</p>
        </>
      ) : (
        <>
          {Object.entries(t.fields)
            .filter(([k]) => !(t.kind === "trigger" && ((t.fields.type === "weather" && (k === "var" || k === "var_value" || k === "script")) || (t.fields.type !== "weather" && k === "weather"))))
            .map(([k, v]) =>
              k === "type" && t.kind === "trigger" ? (
                <label key={k} className="field" title={FIELD_HELP.type}>
                  <span>type</span>
                  <select value={String(v)} onChange={(e) => s.editThing(k, (e2) => !isWarp(e2) && (e2.fields[k] = e.target.value))}>
                    <option value="trigger">trigger (runs a script)</option>
                    <option value="weather">weather (changes the weather)</option>
                  </select>
                </label>
              ) : typeof v === "boolean" ? (
                <label key={k} className="check" title={FIELD_HELP[k]}>
                  <input type="checkbox" checked={v} onChange={(e) => s.editThing(k, (e2) => !isWarp(e2) && (e2.fields[k] = e.target.checked))} />
                  {k}
                </label>
              ) : (
                <label key={k} className="field" title={FIELD_HELP[k]}>
                  <span>{k}</span>
                  <Suggest
                    id={`f-${k}`}
                    value={String(v)}
                    options={FIELD_SUGGESTIONS[k]}
                    maxLength={k === "text" || k === "note" ? 500 : 100}
                    onChange={(val) =>
                      s.editThing(k, (e2) => {
                        if (isWarp(e2)) return;
                        // Numbers stay numbers (movement ranges); everything else is text.
                        e2.fields[k] = typeof v === "number" ? Math.max(0, Math.min(255, Math.round(Number(val)) || 0)) : val;
                      })
                    }
                  />
                </label>
              ),
            )}
          {(issue || accepted) && (
            <label className="check" title="The Check tab warns when a trainer's sight covers the only way through. Tick this if that battle is meant to be unavoidable.">
              <input type="checkbox" checked={accepted} onChange={(e) => s.acceptWarning(t.id, "unavoidable-trainer", e.target.checked)} />
              This battle can't be avoided, on purpose
            </label>
          )}
          {!t.locked && <p className="hint">Placed by Generate. Editing it here keeps it where it is next time you Generate.</p>}
        </>
      )}
      <button className="secondary" onClick={() => s.deleteThing()}>
        <Icon name="trash" size={16} /> Remove {thingTag(map, t)}
      </button>
    </section>
  );
}

const HEADER_TEXT: Array<{ key: keyof MapHeader; label: string; tip: string; options?: string[] }> = [
  { key: "id", label: "Map constant (id)", tip: "The MAP_* constant other maps and scripts use for this map." },
  { key: "name", label: "Name (folder name)", tip: "The map's name in Porymap, also its folder in data/maps." },
  { key: "music", label: "Music", tip: "The background music (MUS_*)." },
  { key: "region_map_section", label: "Region map section", tip: "Where the map is on the Town Map, and the name in the popup (MAPSEC_*)." },
  { key: "weather", label: "Weather", tip: "The map's weather (WEATHER_*).", options: MAP_WEATHER },
  { key: "map_type", label: "Map type", tip: "Route, town, cave… changes things like whether you can use Dig or Escape Rope (MAP_TYPE_*).", options: MAP_TYPES_PORYMAP },
  { key: "battle_scene", label: "Battle scene", tip: "The battle background style (MAP_BATTLE_SCENE_*).", options: BATTLE_SCENES },
];

const HEADER_FLAGS: Array<{ key: keyof MapHeader; label: string; tip: string }> = [
  { key: "requires_flash", label: "Dark: needs Flash", tip: "requires_flash" },
  { key: "allow_cycling", label: "Bike allowed", tip: "allow_cycling" },
  { key: "allow_escaping", label: "Escape Rope / Dig work", tip: "allow_escaping" },
  { key: "allow_running", label: "Running allowed", tip: "allow_running" },
  { key: "show_map_name", label: "Show the name popup", tip: "show_map_name" },
];

function MapProperties() {
  const s = useStore();
  const map = s.currentMap!;
  const h = map.header;
  const others = s.region.maps.filter((m) => m.id !== map.id);
  const setConnection = (k: number, patch: Partial<Connection>) =>
    s.editMap(`connection${k}:${Object.keys(patch).join()}`, (m) => (m.connections = m.connections.map((c, i) => (i === k ? { ...c, ...patch } : c))));
  return (
    <>
      <details open={!s.pickedThing}>
        <summary title="The map.json header values to enter in Porymap">Map header ({h.id})</summary>
        {HEADER_TEXT.map((f) => (
          <label key={f.key} className="field" title={f.tip}>
            <span>{f.label}</span>
            <Suggest id={`h-${f.key}`} value={String(h[f.key] ?? "")} options={f.options} onChange={(v) => s.editMap(`header.${f.key}`, (m) => (m.header = { ...m.header, [f.key]: v.slice(0, 100) }))} />
          </label>
        ))}
        {HEADER_FLAGS.map((f) => (
          <label key={f.key} className="check" title={f.tip}>
            <input type="checkbox" checked={h[f.key] === true} onChange={(e) => s.editMap(`header.${f.key}`, (m) => (m.header = { ...m.header, [f.key]: e.target.checked }))} />
            {f.label}
          </label>
        ))}
        <label className="field" title="floor_number: shown in elevators and the Pokémon Center's floor list. Leave empty if the map has none.">
          <span>Floor number (optional)</span>
          <input
            type="number"
            min={-128}
            max={127}
            value={h.floor_number ?? ""}
            onChange={(e) =>
              s.editMap("header.floor_number", (m) => (m.header = { ...m.header, floor_number: e.target.value === "" ? null : Math.max(-128, Math.min(127, Math.round(Number(e.target.value)) || 0)) }))
            }
          />
        </label>
      </details>

      <details>
        <summary title="Border block and tilesets">Layout</summary>
        <p className="hint">The border block is the 2×2 pattern repeated outside the map's edges.</p>
        <div className="border-block">
          {map.layout.borderBlock.map((id, k) => (
            <select
              key={k}
              aria-label={["Border top-left", "Border top-right", "Border bottom-left", "Border bottom-right"][k]}
              value={id}
              onChange={(e) =>
                s.editMap(`border${k}`, (m) => {
                  const b = [...m.layout.borderBlock] as typeof m.layout.borderBlock;
                  b[k] = e.target.value;
                  m.layout = { ...m.layout, borderBlock: b };
                })
              }
            >
              {TERRAIN_TYPES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          ))}
        </div>
        <label className="field" title="The primary tileset (gTileset_*). Left empty until you pick one in Porymap.">
          <span>Primary tileset</span>
          <Suggest id="ts1" value={map.layout.primaryTileset} onChange={(v) => s.editMap("primaryTileset", (m) => (m.layout = { ...m.layout, primaryTileset: constant(v) }))} />
        </label>
        <label className="field" title="The secondary tileset (gTileset_*).">
          <span>Secondary tileset</span>
          <Suggest id="ts2" value={map.layout.secondaryTileset} onChange={(v) => s.editMap("secondaryTileset", (m) => (m.layout = { ...m.layout, secondaryTileset: constant(v) }))} />
        </label>
      </details>

      <details>
        <summary title="Which maps join this one at each edge">Connections ({map.connections.length})</summary>
        <p className="hint">
          A connection joins a neighbouring map along an edge. Offset is how far along the edge the neighbour starts (in cells, from this map's left or top). Entrances on both maps must line up.
        </p>
        {map.connections.map((c, k) => (
          <div key={k} className="connection-row">
            <select value={c.direction} aria-label="Edge" onChange={(e) => setConnection(k, { direction: e.target.value as ConnectionDirection })}>
              {CONNECTION_DIRECTIONS.map((d) => (
                <option key={d} value={d}>
                  {DIRECTION_LABELS[d]}
                </option>
              ))}
            </select>
            <Suggest id={`c${k}`} value={c.map} options={others.map((m) => m.header.id)} title="The neighbouring map (MAP_*)" onChange={(v) => setConnection(k, { map: constant(v) || "MAP_NONE" })} />
            <input
              type="number"
              aria-label="Offset"
              title="offset"
              value={c.offset}
              onChange={(e) => setConnection(k, { offset: Math.max(-2048, Math.min(2048, Math.round(Number(e.target.value)) || 0)) })}
            />
            <button className="icon-button" aria-label="Remove connection" title="Remove this connection" onClick={() => s.editMap("connections", (m) => (m.connections = m.connections.filter((_, i) => i !== k)))}>
              <Icon name="trash" size={16} />
            </button>
          </div>
        ))}
        <button
          className="secondary"
          disabled={map.connections.length >= 16}
          onClick={() => s.editMap("connections", (m) => (m.connections = [...m.connections, { direction: "up", map: others[0]?.header.id || "MAP_NONE", offset: 0 }]))}
        >
          <Icon name="plus" size={16} /> Add a connection
        </button>
      </details>
    </>
  );
}
