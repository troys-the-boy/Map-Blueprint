// Seeded random number generator.
//
// Every random choice in the tool goes through an Rng made from a seed, so the
// same seed + same inputs + same edits always give the same output. Never use
// Math.random() in core code.
//
// The algorithm is mulberry32: tiny, fast, and good enough for map generation
// (it is not meant for cryptography).

/** Seeds are unsigned 32-bit integers (0 … 4,294,967,295). */
export type Seed = number;

export const MAX_SEED = 0xffffffff;

/** Force any number into a valid seed (whole number, 0 … 2^32-1). */
export function normalizeSeed(seed: number): Seed {
  if (!Number.isFinite(seed)) return 0;
  return Math.floor(Math.abs(seed)) >>> 0;
}

/** Hash a string to a 32-bit number (FNV-1a). Used to derive child seeds by name. */
export function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export class Rng {
  private state: number;
  readonly seed: Seed;

  constructor(seed: Seed) {
    this.seed = normalizeSeed(seed);
    this.state = this.seed;
  }

  /** Next raw 32-bit value. */
  nextUint32(): number {
    // mulberry32
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }

  /** A float in [0, 1). */
  next(): number {
    return this.nextUint32() / 4294967296;
  }

  /** A whole number from min to max, both included. */
  int(min: number, max: number): number {
    if (max < min) throw new Error(`Rng.int: max (${max}) is less than min (${min})`);
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** A float from min (included) to max (excluded). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** True with the given probability (0 … 1). */
  chance(probability: number): boolean {
    return this.next() < probability;
  }

  /** One random element of a non-empty list. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error("Rng.pick: the list is empty");
    return items[Math.floor(this.next() * items.length)];
  }

  /** Shuffle a copy of the list (Fisher–Yates). */
  shuffle<T>(items: readonly T[]): T[] {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  /**
   * A new, independent Rng for a named sub-task, e.g. rng.fork("terrain").
   * The child depends only on this Rng's original seed and the label, not on how
   * many numbers have been drawn, so adding a random call in one stage never
   * changes the output of another stage.
   */
  fork(label: string): Rng {
    return new Rng(deriveSeed(this.seed, label));
  }
}

/** Combine a seed and a label into a new seed (used for stage retries and forks). */
export function deriveSeed(seed: Seed, label: string): Seed {
  let h = hashString(label) ^ normalizeSeed(seed);
  // One round of a 32-bit integer mix so nearby seeds give unrelated results.
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
