// Runs generation in a background thread (a Web Worker) so the editor never
// freezes, even for big maps on an iPad. The build inlines this file, so it
// works in the single-file app too.

import { generateRoute } from "../core/generate";
import type { EngineLimits, MapBlueprint } from "../core/model";

self.onmessage = (event: MessageEvent<{ id: number; map: MapBlueprint; limits: EngineLimits }>) => {
  const { id, map, limits } = event.data;
  try {
    const result = generateRoute(map, { limits });
    (self as unknown as Worker).postMessage({ id, result });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
