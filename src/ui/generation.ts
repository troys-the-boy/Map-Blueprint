// Starts generation in the background worker, falling back to the main thread
// if the browser can't create one.

import type { GenerateResult } from "../core/generate";
import { generateRoute } from "../core/generate";
import type { EngineLimits, MapBlueprint } from "../core/model";
import GenWorker from "./genWorker?worker&inline";

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (r: GenerateResult) => void; reject: (e: Error) => void }>();

function getWorker(): Worker | null {
  if (worker) return worker;
  try {
    worker = new GenWorker();
    worker.onmessage = (event: MessageEvent<{ id: number; result?: GenerateResult; error?: string }>) => {
      const job = pending.get(event.data.id);
      if (!job) return;
      pending.delete(event.data.id);
      if (event.data.result) job.resolve(event.data.result);
      else job.reject(new Error(event.data.error ?? "Generation failed"));
    };
    worker.onerror = () => {
      // The worker itself broke: fail anything waiting, and stop using it.
      for (const job of pending.values()) job.reject(new Error("The background generator stopped unexpectedly."));
      pending.clear();
      worker = null;
    };
    return worker;
  } catch {
    return null;
  }
}

export function runGenerate(map: MapBlueprint, limits: EngineLimits): Promise<GenerateResult> {
  const w = getWorker();
  if (!w) return Promise.resolve(generateRoute(map, { limits }));
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, map, limits });
  });
}
