// Planet resources: what each cell of a body offers. Pure functions of the terrain and a noise field, so a settlement reads its
// surroundings the same way whenever it is looked at. Ids only (`soil`, `fresh`); packs name them.
import type { BodyKind } from './types';

/** Land resources shown as planet layers. Water is its own layer (none / fresh / salt). */
export const LAYERS = ['water', 'soil', 'timber', 'stone'] as const;
export type Layer = (typeof LAYERS)[number];

export const WATER_NONE = 0;
export const WATER_FRESH = 1;
export const WATER_SALT = 2;

/** A water body of at least this many cells is a sea; smaller ones are lakes and ponds. */
const SALT_MIN = 90;

export interface Resources {
  /** 0 none, 1 fresh, 2 salt */
  water: Uint8Array;
  /** 0..3 per cell: none, scarce, fair, plentiful (soil, timber, stone) */
  soil: Uint8Array;
  timber: Uint8Array;
  stone: Uint8Array;
}

const level = (v: number): number => (v < 0.2 ? 0 : v < 0.45 ? 1 : v < 0.7 ? 2 : 3);

/**
 * `cells` are terrain classes 0..6 (deep water .. summit), `noise` a smooth 0..1 field and `grain` a second one, both sampled
 * by cell. Gas giants have no surface, so they hold nothing.
 */
export function buildResources(
  cells: Uint8Array,
  W: number,
  H: number,
  kind: BodyKind,
  noise: (x: number, y: number) => number,
  grain: (x: number, y: number) => number,
): Resources {
  const n = W * H;
  const out: Resources = { water: new Uint8Array(n), soil: new Uint8Array(n), timber: new Uint8Array(n), stone: new Uint8Array(n) };
  if (kind === 'gaseous') return out;

  // Connected water (cells 0 and 1), four-way: big bodies are salt, small ones fresh.
  const seen = new Uint8Array(n);
  const stack: number[] = [];
  for (let i = 0; i < n; i++) {
    if (seen[i] || (cells[i] as number) > 1) continue;
    const comp: number[] = [];
    seen[i] = 1;
    stack.push(i);
    while (stack.length) {
      const j = stack.pop()!;
      comp.push(j);
      const x = j % W;
      const y = (j - x) / W;
      const next = [x > 0 ? j - 1 : -1, x < W - 1 ? j + 1 : -1, y > 0 ? j - W : -1, y < H - 1 ? j + W : -1];
      for (const k of next) {
        if (k < 0 || seen[k] || (cells[k] as number) > 1) continue;
        seen[k] = 1;
        stack.push(k);
      }
    }
    const v = comp.length >= SALT_MIN ? WATER_SALT : WATER_FRESH;
    for (const j of comp) out.water[j] = v;
  }

  // How much of each the body can give: soil needs a temperate or arid climate, timber wants wet ground.
  const soilK = kind === 'temperate' ? 1 : kind === 'arid' ? 0.4 : kind === 'frozen' ? 0.25 : 0;
  const woodK = kind === 'temperate' ? 1 : kind === 'frozen' ? 0.35 : kind === 'arid' ? 0.12 : 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const c = cells[i] as number;
      if (c <= 1) continue;
      const a = noise(x / 9, y / 9);
      const b = grain(x / 7, y / 7);
      const low = c === 2 ? 0.7 : c === 3 ? 1 : c === 4 ? 0.45 : 0;
      out.soil[i] = level(soilK * low * (0.45 + a * 0.9));
      out.timber[i] = level(woodK * (c === 3 ? 1 : c === 4 ? 0.8 : c === 2 ? 0.2 : 0.1) * (0.2 + b * 1.1));
      out.stone[i] = level((c === 4 ? 0.45 : c === 5 ? 0.9 : c === 6 ? 1 : c === 3 ? 0.12 : 0) * (0.35 + b * 1.0));
    }
  }
  return out;
}

export interface Surroundings {
  /** 0..3: none, scarce, fair, plentiful */
  fresh: number;
  salt: number;
  soil: number;
  timber: number;
  stone: number;
  /** Fish live in open water, more in the sea. */
  fish: number;
}

const REACH = 5;

/** What lies within `REACH` cells of (x, y). */
export function surroundings(res: Resources, W: number, H: number, x: number, y: number): Surroundings {
  let fresh = 0;
  let salt = 0;
  let soil = 0;
  let timber = 0;
  let stone = 0;
  let total = 0;
  for (let dy = -REACH; dy <= REACH; dy++) {
    for (let dx = -REACH; dx <= REACH; dx++) {
      const xx = x + dx;
      const yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      const i = yy * W + xx;
      total++;
      if (res.water[i] === WATER_FRESH) fresh++;
      else if (res.water[i] === WATER_SALT) salt++;
      soil += res.soil[i]!;
      timber += res.timber[i]!;
      stone += res.stone[i]!;
    }
  }
  const t = Math.max(1, total);
  const share = (n: number) => (n === 0 ? 0 : n < t * 0.04 ? 1 : n < t * 0.15 ? 2 : 3);
  const mean = (s: number) => level(s / (t * 3) * 1.6);
  return {
    fresh: share(fresh),
    salt: share(salt),
    soil: mean(soil),
    timber: mean(timber),
    stone: mean(stone),
    fish: Math.min(3, share(fresh + salt * 2)),
  };
}

/** How well the surroundings can feed a town, 0..1: farmland first, then fish and fresh water. */
export function foodSupply(s: Surroundings): number {
  return Math.min(1, (0.5 * s.soil + 0.3 * s.fish + 0.2 * Math.max(s.fresh, s.salt * 0.6)) / 3);
}

/** How good a place with water is to settle, 0..1: more water, then food ground. Used as an acceptance chance for a site. */
export function appeal(s: Surroundings): number {
  const water = Math.max(s.fresh, s.salt * 0.8);
  return Math.min(1, 0.12 + 0.22 * water + 0.1 * s.soil + 0.05 * s.timber + 0.03 * s.stone);
}

/** Chance a district has a river through it: fresh water close by makes one likely; a coast alone gives a creek. */
export function riverChance(s: Surroundings): number {
  if (s.fresh > 0) return [0, 0.35, 0.6, 0.85][s.fresh]!;
  return s.salt > 0 ? 0.15 : 0;
}
