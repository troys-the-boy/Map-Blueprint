// The Encounters window: the region's species list (pasted text) and this map's
// draft wild encounter tables, which can be redrafted or edited slot by slot.
// See core/encounters.ts for the rules and the pokeemerald facts behind them.

import { Fragment, useState } from "react";
import { createPortal } from "react-dom";
import type { EncounterTable, TableKind } from "../../core/encounters";
import {
  EXAMPLE_SPECIES,
  ROD_SLOTS,
  SLOT_CHANCES,
  TABLES,
  TABLE_LABELS,
  emptyTable,
  levelBand,
  neededTables,
  parseSpeciesList,
  speciesListText,
} from "../../core/encounters";
import { useStore } from "../store";
import { Icon } from "./icons";

const ROD_LABELS: Record<number, string> = { 0: "Old Rod", 2: "Good Rod", 5: "Super Rod" };

const speciesName = (v: string) => {
  const clean = v.replace(/[^A-Za-z0-9_]/g, "").toUpperCase().slice(0, 64);
  return clean || "SPECIES_NONE";
};
const level = (v: string) => Math.max(1, Math.min(100, Math.round(Number(v)) || 1));

export function EncountersDialog({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const map = s.currentMap;
  const [text, setText] = useState(() => speciesListText(s.region.speciesPool));
  const [problems, setProblems] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  if (!map) return null;
  const pool = s.region.speciesPool;
  const plan = map.encounterPlan;
  const needed = neededTables(map);
  const [lo, hi] = levelBand(map);
  const cave = map.mapType === "cave";

  const useList = () => {
    const { entries, problems } = parseSpeciesList(text);
    setProblems(problems);
    s.setSpeciesPool(entries);
    setSaved(true);
  };

  // Drawn over the whole page, not inside the side panel (which slides in as a drawer on narrow screens).
  return createPortal(
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide" role="dialog" aria-modal="true" aria-labelledby="enc-title">
        <h2 id="enc-title">Wild encounters</h2>

        <details open={!pool.length}>
          <summary title="One list for the whole project. Every map drafts its tables from it.">Species list for the region ({pool.length})</summary>
          <p className="hint">
            One species per line: <code>NAME levels where [biomes] [rarity]</code>, e.g. <code>ZIGZAGOON 2-5 land meadow</code>. Where: land (grass, caves), surf, fish, rock (Rock Smash). Rarity: common
            (default), uncommon or rare. A list copied from a spreadsheet works too. The tool comes with no Pokémon data: use your own.
          </p>
          <textarea
            className="species-text"
            value={text}
            rows={8}
            spellCheck={false}
            autoCapitalize="off"
            aria-label="Species list"
            onChange={(e) => {
              setText(e.target.value);
              setSaved(false);
            }}
          />
          {problems.length > 0 && (
            <ul className="notice-inline bad problem-list">
              {problems.slice(0, 6).map((p) => (
                <li key={p}>{p}</li>
              ))}
              {problems.length > 6 && <li>…and {problems.length - 6} more.</li>}
            </ul>
          )}
          <div className="button-row">
            <button className="primary" onClick={useList} title="Read the list and keep it with the project">
              Use this list
            </button>
            <button className="secondary" onClick={() => (setText(EXAMPLE_SPECIES), setSaved(false))} title="Fill in a short example list to try the draft out">
              Example list
            </button>
            {saved && <span className="hint">✓ {pool.length} species kept.</span>}
          </div>
        </details>

        <h3 className="enc-heading">
          {map.name}: levels {lo}–{hi}
        </h3>
        <p className="hint">
          Generate drafts these tables from the species list: only the ones the map needs (grass → land, deep water → surfing and fishing, Rock Smash rocks → rock smash). Change the levels under
          Generate → Gameplay. Edit any slot and the draft is kept as it is.
        </p>
        <div className="button-row">
          <button className="secondary" disabled={!pool.length} onClick={() => s.redraftEncounters()} title="Make a new draft from the species list (one Undo step)">
            <Icon name="generate" size={16} /> Redraft
          </button>
          <label className="check" title="Locked: Generate keeps these tables. Unlocked: Generate drafts them again.">
            <input type="checkbox" checked={!!plan?.locked} onChange={(e) => s.setEncountersLocked(e.target.checked)} />
            Keep this draft when I Generate
          </label>
        </div>
        {!plan && <p className="hint">No draft yet. {pool.length ? "Press Redraft, or Generate the map." : "Add a species list first."}</p>}

        {TABLES.filter((k) => plan?.[k] || needed.includes(k)).map((kind) => (
          <TableEditor key={kind} kind={kind} table={plan?.[kind]} needed={needed.includes(kind)} cave={cave} />
        ))}
        <datalist id="species-names">
          {pool.map((e) => (
            <option key={e.species} value={e.species} />
          ))}
        </datalist>

        <div className="modal-actions">
          <button className="secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function TableEditor({ kind, table, needed, cave }: { kind: TableKind; table?: EncounterTable; needed: boolean; cave: boolean }) {
  const s = useStore();
  const chances = SLOT_CHANCES[kind];
  const editSlot = (k: number, patch: Partial<EncounterTable["slots"][number]>) =>
    s.editEncounters(`${kind}${k}:${Object.keys(patch).join()}`, (p) => {
      const t = p[kind];
      if (!t) return;
      const slot = { ...t.slots[k], ...patch };
      if (slot.max < slot.min) slot.max = slot.min;
      t.slots[k] = slot;
    });
  return (
    <section className="enc-table">
      <div className="enc-table-head">
        <h4>{TABLE_LABELS[kind]}</h4>
        {table ? (
          <>
            <label className="enc-rate" title="encounter_rate: how often a wild Pokémon appears. Vanilla routes use 20 for grass, 4 for surfing, 30 for fishing, 20 for Rock Smash.">
              Rate
              <input type="number" min={0} max={255} value={table.rate} onChange={(e) => s.editEncounters(`${kind}rate`, (p) => p[kind] && (p[kind]!.rate = Math.max(0, Math.min(255, Math.round(Number(e.target.value)) || 0))))} />
            </label>
            <button className="icon-button" title={`Remove the ${TABLE_LABELS[kind]} table`} aria-label={`Remove ${TABLE_LABELS[kind]} table`} onClick={() => s.editEncounters(`${kind}remove`, (p) => delete p[kind])}>
              <Icon name="trash" size={16} />
            </button>
          </>
        ) : (
          <button className="secondary" onClick={() => s.editEncounters(`${kind}add`, (p) => (p[kind] = emptyTable(kind, cave)))}>
            <Icon name="plus" size={16} /> Add an empty table
          </button>
        )}
      </div>
      {!table && needed && <p className="notice-inline bad">This map needs this table: nothing in the species list fits (check where they live and their levels), or add one by hand.</p>}
      {table && (
        <table className="enc-slots">
          <thead>
            <tr>
              <th title="The chance of this slot, in %">%</th>
              <th>Species</th>
              <th>Min</th>
              <th>Max</th>
            </tr>
          </thead>
          <tbody>
            {table.slots.map((slot, k) => (
              <Fragment key={k}>
                {kind === "fish" && ROD_LABELS[k] && (
                  <tr className="rod-row">
                    <td colSpan={4}>{ROD_LABELS[k]}</td>
                  </tr>
                )}
                <tr>
                  <td className="chance">{chances[k]}</td>
                  <td>
                    <input list="species-names" value={slot.species} spellCheck={false} autoCapitalize="off" aria-label={`Slot ${k + 1} species`} onChange={(e) => editSlot(k, { species: speciesName(e.target.value) })} />
                  </td>
                  <td>
                    <input type="number" min={1} max={100} value={slot.min} aria-label={`Slot ${k + 1} lowest level`} onChange={(e) => editSlot(k, { min: level(e.target.value) })} />
                  </td>
                  <td>
                    <input type="number" min={1} max={100} value={slot.max} aria-label={`Slot ${k + 1} highest level`} onChange={(e) => editSlot(k, { max: level(e.target.value) })} />
                  </td>
                </tr>
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
      {kind === "fish" && table && <p className="hint">Slots 1–2 are the Old Rod, 3–5 the Good Rod, 6–10 the Super Rod ({Object.keys(ROD_SLOTS).join(", ")} in wild_encounters.json).</p>}
    </section>
  );
}
