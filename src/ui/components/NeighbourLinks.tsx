// Buttons at the edges of the map canvas to open the connected maps (the
// stitched view draws them faded beyond the edges).

import { useStore } from "../store";

const SIDE: Record<string, { cls: string; arrow: string; word: string }> = {
  up: { cls: "top", arrow: "↑", word: "north" },
  down: { cls: "bottom", arrow: "↓", word: "south" },
  left: { cls: "left", arrow: "←", word: "west" },
  right: { cls: "right", arrow: "→", word: "east" },
};

export function NeighbourLinks() {
  const s = useStore();
  const map = s.currentMap;
  if (!map || !s.prefs.overlays.neighbours || !map.connections.length) return null;
  const groups = new Map<string, Array<{ id: string; name: string }>>();
  for (const c of map.connections) {
    const n = s.region.maps.find((m) => m.id === c.map);
    if (!n || !SIDE[c.direction]) continue;
    (groups.get(c.direction) ?? groups.set(c.direction, []).get(c.direction)!).push({ id: n.id, name: n.name });
  }
  return (
    <>
      {[...groups].map(([dir, list]) => (
        <div key={dir} className={`nb-links ${SIDE[dir].cls}`}>
          {list.map((n) => (
            <button key={n.id} className="nb-link" title={`Open ${n.name}, connected to the ${SIDE[dir].word}`} onClick={() => s.openMap(n.id)}>
              {SIDE[dir].arrow} {n.name}
            </button>
          ))}
        </div>
      ))}
    </>
  );
}
