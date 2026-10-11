// Seeded randomness. Everything in the universe is a pure function of
// (universe seed, path, salt) so nothing has to be stored until it changes.

function fmix(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export function hash32(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return fmix(h);
}

export interface Rng {
  next(): number;
  u32(): number;
  range(lo: number, hi: number): number;
  int(lo: number, hi: number): number; // inclusive both ends
  chance(p: number): boolean;
  pick<T>(arr: readonly T[]): T;
  weighted<K extends string>(table: Record<K, number>): K;
}

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  return {
    next,
    u32: () => Math.floor(next() * 4294967296) >>> 0,
    range: (lo, hi) => lo + (hi - lo) * next(),
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    chance: (p) => next() < p,
    pick<T>(arr: readonly T[]): T {
      return arr[Math.floor(next() * arr.length)] as T;
    },
    weighted<K extends string>(table: Record<K, number>): K {
      const keys = Object.keys(table) as K[];
      let total = 0;
      for (const k of keys) total += table[k];
      let roll = next() * total;
      for (const k of keys) {
        roll -= table[k];
        if (roll < 0) return k;
      }
      return keys[keys.length - 1] as K;
    },
  };
}

/** RNG stream for one object in the universe. */
export function rngFor(universeSeed: string, path: string, salt = ''): Rng {
  return mulberry32(hash32(`${universeSeed}|${path}|${salt}`));
}

/** One-shot deterministic float in [0,1). */
export function hashFloat(universeSeed: string, key: string): number {
  return hash32(`${universeSeed}|${key}`) / 4294967296;
}

/** Lattice value noise: stateless, so any region can be generated on its own. */
export function makeNoise(seed: number) {
  const lat = (x: number, y: number): number => {
    let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ seed;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const noise = (x: number, y: number): number => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = smooth(x - x0);
    const fy = smooth(y - y0);
    const a = lat(x0, y0);
    const b = lat(x0 + 1, y0);
    const c = lat(x0, y0 + 1);
    const d = lat(x0 + 1, y0 + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
  const fbm = (x: number, y: number, octaves = 4): number => {
    let amp = 0.5;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += noise(x * freq, y * freq) * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm;
  };
  return { noise, fbm };
}
