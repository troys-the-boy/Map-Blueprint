// The journey in the sketch panel: the stops in order with their levels and
// step, the level curve, and the progression steps (badges and HMs) with where
// each starts.

import { HMS } from "../../core/constants";
import { planJourney } from "../../core/journey";
import { sketchEditor } from "../sketchEditor";
import { useStore } from "../store";
import { NumberField } from "./NumberField";
import { Icon } from "./icons";

const HM_LABELS: Record<string, string> = { cut: "Cut", flash: "Flash", rock_smash: "Rock Smash", strength: "Strength", surf: "Surf", dive: "Dive", waterfall: "Waterfall" };

export function JourneyPanel() {
  const s = useStore();
  const e = sketchEditor;
  const sketch = s.region.sketch;
  if (!sketch) return null;
  const plan = planJourney(sketch, s.region);
  const byId = new Map(sketch.places.map((p) => [p.id, p]));
  const stops = sketch.journey.stops.filter((id) => byId.has(id));
  const steps = s.region.progression;
  const stepName = (id: string | null) => steps.find((x) => x.id === id)?.name ?? null;
  const curve = s.region.settings.levelCurve;

  return (
    <details className="sketch-section" open={e.tool === "journey" || stops.length > 0}>
      <summary title="The order the player goes through the places">Journey ({stops.length} stop{stops.length === 1 ? "" : "s"})</summary>
      {stops.length === 0 && <p className="hint">Pick the <b>Journey</b> tool and tap the places in the order the player goes through them: towns, routes, and the forests and caves on the way. Tap a place again later when the player goes back through it.</p>}
      <ol className="stop-list">
        {stops.map((id, i) => {
          const p = byId.get(id)!;
          const pj = plan.places.get(id);
          const way = plan.stops[i];
          const again = pj?.stop !== i;
          const step = stepName(pj?.stepId ?? null);
          return (
            <li key={i} className={`${e.selectedId === id ? "active" : ""} ${again ? "again" : ""}`}>
              <button className="stop-name" title={`Pick ${p.name}`} onClick={() => e.select(id)}>
                <b>
                  {i + 1}. {p.name}
                </b>
                <span className="map-meta">
                  {again ? `Back through (as at stop ${(pj?.stop ?? 0) + 1})` : pj?.levels ? `Lv ${pj.levels.min}–${pj.levels.max}` : ""}
                  {!again && step ? ` · ${step}` : ""}
                  {way && way.pieces.length ? ` · ${way.pieces[0].from ?? "?"} → ${way.pieces[way.pieces.length - 1].to ?? "?"}` : ""}
                </span>
              </button>
              <button className="icon-button" title="Earlier in the journey" aria-label={`Move ${p.name} earlier`} disabled={i === 0} onClick={() => e.moveStop(i, -1)}>
                ↑
              </button>
              <button className="icon-button" title="Later in the journey" aria-label={`Move ${p.name} later`} disabled={i === stops.length - 1} onClick={() => e.moveStop(i, 1)}>
                ↓
              </button>
              <button className="icon-button" title="Take it off the journey" aria-label={`Take ${p.name} off the journey`} onClick={() => e.removeStop(i)}>
                <Icon name="close" size={18} />
              </button>
            </li>
          );
        })}
      </ol>
      {stops.length > 0 && (
        <p className="hint">Routes show where they're entered → left. Going back through a place doesn't change it: when the region is built, each map gets its Start and Finish, levels and HMs from its first visit.</p>
      )}

      <h3>Levels</h3>
      <div className="field-row">
        <label className="field inline" title="Wild Pokémon level at the first stop.">
          <span>Start</span>
          <NumberField min={1} max={100} value={curve.start} onChange={(v) => e.setLevelCurve(v, curve.end)} />
        </label>
        <label className="field inline" title="Wild Pokémon level at the last stop.">
          <span>End</span>
          <NumberField min={1} max={100} value={curve.end} onChange={(v) => e.setLevelCurve(curve.start, v)} />
        </label>
      </div>
      <p className="hint">Spread evenly along the journey. Places off it take the levels of the route or town they're on.</p>

      <h3>Progression steps</h3>
      <p className="hint">What the player has by each part of the journey. A step lasts from where it starts until the next one starts. Each map is checked only with the HMs of the step it was first visited in; going back through later doesn't change that.</p>
      {steps.map((step) => (
        <div key={step.id} className="step-card">
          <div className="field-row">
            <label className="field">
              <span>Name</span>
              <input type="text" value={step.name} maxLength={60} onChange={(ev) => e.updateStep(step.id, { name: ev.target.value })} />
            </label>
            <button className="icon-button" title="Remove this step" aria-label={`Remove ${step.name}`} onClick={() => e.removeStep(step.id)}>
              <Icon name="trash" size={18} />
            </button>
          </div>
          <div className="field-row">
            <label className="field inline" title="Badges the player has by now.">
              <span>Badges</span>
              <NumberField min={0} max={8} value={step.badges} onChange={(v) => e.updateStep(step.id, { badges: v })} />
            </label>
            <label className="field" title="The stop where this step starts.">
              <span>Starts at</span>
              <select value={sketch.journey.stepStarts[step.id] ?? ""} onChange={(ev) => e.setStepStart(step.id, ev.target.value === "" ? null : Number(ev.target.value))}>
                <option value="">Not on the journey</option>
                {stops.map((id, i) => (
                  <option key={i} value={i}>
                    {i + 1}. {byId.get(id)!.name}
                    {plan.places.get(id)?.stop !== i ? " (back through)" : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <fieldset className="checks hm-checks">
            <legend>HMs the player can use</legend>
            {HMS.map((h) => (
              <label key={h} className="check">
                <input type="checkbox" checked={step.hms.includes(h)} onChange={(ev) => e.toggleStepHm(step.id, h, ev.target.checked)} />
                {HM_LABELS[h]}
              </label>
            ))}
          </fieldset>
        </div>
      ))}
      <button className="secondary" onClick={() => e.addStep()}>
        Add a step
      </button>
    </details>
  );
}
