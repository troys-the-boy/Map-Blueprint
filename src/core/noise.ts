// Seeded 2D value noise: smooth random "hills" used to make natural-looking
// shapes (winding paths, tree edges, grass patches). Same seed → same noise.

import { Rng } from "./rng";

export class ValueNoise {
  private readonly size = 256;
  private readonly values: Float64Array;
  private readonly perm: Uint16Array;

  constructor(rng: Rng) {
    this.values = new Float64Array(this.size);
    for (let i = 0; i < this.size; i++) this.values[i] = rng.next();
    const order = rng.shuffle(Array.from({ length: this.size }, (_, i) => i));
    this.perm = new Uint16Array(this.size * 2);
    for (let i = 0; i < this.size * 2; i++) this.perm[i] = order[i % this.size];
  }

  private lattice(ix: number, iy: number): number {
    const m = this.size - 1;
    return this.values[this.perm[(this.perm[ix & m] + iy) & m]];
  }

  /** Smooth noise in [0, 1) at a point; features are about 1 unit apart. */
  at(x: number, y: number): number {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const a = this.lattice(x0, y0);
    const b = this.lattice(x0 + 1, y0);
    const c = this.lattice(x0, y0 + 1);
    const d = this.lattice(x0 + 1, y0 + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  }

  /** Several layers of noise added together (rougher detail on top of broad shapes), in [0, 1). */
  fractal(x: number, y: number, scale: number, octaves = 3): number {
    let sum = 0;
    let amp = 1;
    let total = 0;
    let freq = 1 / scale;
    for (let o = 0; o < octaves; o++) {
      sum += this.at(x * freq + o * 31.7, y * freq + o * 17.3) * amp;
      total += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / total;
  }
}
