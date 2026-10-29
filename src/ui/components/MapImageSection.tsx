// A map's reference image (Paint tab): a picture or PDF page laid over the map, faded,
// to trace. See ReferenceImageSection for the controls.

import { useState } from "react";
import { store, useStore } from "../store";
import { NumberField } from "./NumberField";
import { ReferenceImageSection, fitWhenReady } from "./ReferenceImageSection";

/** A GBA metatile is 16 × 16 pixels: a game or Porymap screenshot has 16 pixels per metatile. */
const PIXELS_PER_METATILE = 16;

export function MapImageSection() {
  const s = useStore();
  const map = s.currentMap;
  const [distance, setDistance] = useState(10);
  if (!map) return null;
  const u = map.underlay;
  const calibrating = s.refMode === "calibrate";
  const points = s.refCalibration.length;

  return (
    <ReferenceImageSection
      image={u}
      slot="map"
      where="the map"
      summary="Reference image"
      intro="Lay a picture or PDF page over this map, faded, and trace it: a screenshot of a real map, or your own drawing."
      onReady={() => store.imageLoaded()}
      onLoad={(image, isNew) => {
        store.setMapImage(image);
        if (isNew)
          fitWhenReady("map", () => store.currentMap?.underlay, (pic) => {
            const m = store.currentMap;
            if (m?.underlay) store.updateMapImage({ scale: m.width / pic.width });
          });
      }}
      onPatch={(patch) => store.updateMapImage(patch)}
      onRemove={() => store.setMapImage(null)}
      onRotate={(deg, pic) => store.rotateMapImage(deg, pic.width, pic.height)}
      onFit={(pic) => store.updateMapImage({ x: 0, y: 0, rotation: 0, scale: map.width / pic.width })}
      moving={s.refMode === "move"}
      onToggleMove={() => store.setRefMode("move")}
      onStartCalibration={() => store.setRefMode("calibrate")}
      scaleExtras={() =>
        u?.kind === "image" ? (
          <button
            className="secondary"
            title="For a screenshot of the game or Porymap: 16 pixels make one metatile, so it lines up cell for cell."
            onClick={() => store.updateMapImage({ scale: 1 / PIXELS_PER_METATILE, rotation: 0, x: Math.round(u.x), y: Math.round(u.y) })}
          >
            1 metatile = 16 px
          </button>
        ) : null
      }
      calibration={
        calibrating && (
          <div className="calibrate-box">
            <p className="hint">
              {points < 2
                ? `Tap ${points === 0 ? "a point" : "a second point"} on the image whose distance you know (say, two corners of a building).`
                : "How far apart are A and B, in metatiles?"}
            </p>
            <div className="field-row wrap">
              {points === 2 && (
                <>
                  <NumberField min={1} max={1024} value={distance} onChange={setDistance} aria-label="Distance in metatiles" />
                  <button className="primary" onClick={() => store.applyRefCalibration(distance)}>
                    Set scale
                  </button>
                </>
              )}
              <button className="secondary" onClick={() => store.setRefMode(null)}>
                Cancel
              </button>
            </div>
          </div>
        )
      }
    />
  );
}
