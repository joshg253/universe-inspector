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
  /** Rivers as flat [x, y, ...] from source to mouth; their cells are in `water` as fresh. */
  rivers: number[][];
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
  height?: Float32Array,
): Resources {
  const n = W * H;
  const out: Resources = { water: new Uint8Array(n), soil: new Uint8Array(n), timber: new Uint8Array(n), stone: new Uint8Array(n), rivers: [] };
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

  if (height) out.rivers = carveRivers(out, cells, height, W, H, kind, noise);

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

/** Rivers a body of each kind gets (a stand-in): wet worlds many, dry and cold ones a few, rock and gas none. */
const RIVER_COUNT: Record<BodyKind, number> = { temperate: 7, arid: 2, frozen: 3, barren: 0, gaseous: 0 };
const RIVER_GAP = 14; // sources keep this far apart (Chebyshev)
const RIVER_STEPS = 220;
const RIVER_MIN = 8; // cells a river must run to count
const NB8 = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]] as const;

/**
 * Where water drains: a priority flood from every water cell and the map's edge, always taking the lowest cell next (ties by
 * index, so no engine-specific order), so each land cell points at the neighbor it drained to and every chain ends at water or
 * the edge: dips fill instead of trapping a river. -1 for the outlets themselves.
 */
function drainage(res: Resources, height: Float32Array, W: number, H: number): Int32Array {
  const n = W * H;
  const down = new Int32Array(n).fill(-1);
  const seen = new Uint8Array(n);
  const elev = new Float64Array(n);
  const heap: number[] = []; // cell indexes, ordered by (elev, index)
  const less = (p: number, q: number) => elev[p]! < elev[q]! || (elev[p] === elev[q] && p < q);
  const push = (i: number) => {
    let k = heap.push(i) - 1;
    while (k > 0) {
      const up = (k - 1) >> 1;
      if (!less(heap[k]!, heap[up]!)) break;
      [heap[k], heap[up]] = [heap[up]!, heap[k]!];
      k = up;
    }
  };
  const pop = (): number => {
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      for (let k = 0; ; ) {
        let m = k;
        for (const c of [2 * k + 1, 2 * k + 2]) if (c < heap.length && less(heap[c]!, heap[m]!)) m = c;
        if (m === k) break;
        [heap[k], heap[m]] = [heap[m]!, heap[k]!];
        k = m;
      }
    }
    return top;
  };
  for (let i = 0; i < n; i++) {
    const x = i % W;
    const y = (i - x) / W;
    if (res.water[i] !== WATER_NONE || x === 0 || y === 0 || x === W - 1 || y === H - 1) {
      seen[i] = 1;
      elev[i] = height[i]!;
      push(i);
    }
  }
  while (heap.length) {
    const cur = pop();
    const x = cur % W;
    const y = (cur - x) / W;
    for (const [dx, dy] of NB8) {
      const xx = x + dx;
      const yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      const k = yy * W + xx;
      if (seen[k]) continue;
      seen[k] = 1;
      down[k] = cur;
      elev[k] = Math.max(height[k]!, elev[cur]! + 1e-6);
      push(k);
    }
  }
  return down;
}

/**
 * Rivers: sources on the high, wet ground (best height + wetness first, ties by index, kept RIVER_GAP apart) follow the
 * drainage down until they meet water or the edge. Every cell becomes fresh water in `res.water`, after the lakes and seas are
 * told apart, so a river that reaches the sea stays fresh. Each is returned source first, as flat `[x, y, ...]` of its land
 * cells. No draws: a pure function of the height, the noise and the water.
 */
function carveRivers(res: Resources, cells: Uint8Array, height: Float32Array, W: number, H: number, kind: BodyKind, wet: (x: number, y: number) => number): number[][] {
  const out: number[][] = [];
  const want = RIVER_COUNT[kind];
  if (want === 0) return out;
  const cand: { i: number; score: number }[] = [];
  for (let i = 0; i < W * H; i++) {
    const c = cells[i] as number;
    if (c < 4 || res.water[i] !== WATER_NONE) continue;
    cand.push({ i, score: height[i]! * 0.6 + wet((i % W) / 9, Math.floor(i / W) / 9) * 0.4 });
  }
  cand.sort((p, q) => q.score - p.score || p.i - q.i);
  const down = drainage(res, height, W, H);
  const reach = (i: number): number => {
    let len = 0;
    for (let cur = i; len < RIVER_STEPS; len++) {
      const next = down[cur]!;
      if (next < 0 || res.water[next] !== WATER_NONE) break;
      cur = next;
    }
    return len;
  };
  const sources: number[] = [];
  for (const { i } of cand) {
    if (sources.length >= want) break;
    const x = i % W;
    const y = (i - x) / W;
    if (sources.some((s) => Math.max(Math.abs((s % W) - x), Math.abs(Math.floor(s / W) - y)) < RIVER_GAP)) continue;
    if (reach(i) < RIVER_MIN) continue; // too close to the sea or the edge to be a river
    sources.push(i);
  }
  const carved: number[] = [];
  const traced = new Set<number>();
  for (const src of sources) {
    const path = [src];
    traced.add(src);
    for (let cur = src, step = 0; step < RIVER_STEPS; step++) {
      const next = down[cur]!;
      if (next < 0 || res.water[next] !== WATER_NONE) break; // the map's edge, or a lake or the sea
      path.push(next);
      if (traced.has(next)) break; // joins a river already traced: it ends at the confluence
      traced.add(next);
      cur = next;
    }
    carved.push(...path);
    if (path.length >= 2) out.push(path.flatMap((k) => [k % W, Math.floor(k / W)]));
  }
  for (const k of carved) res.water[k] = WATER_FRESH;
  return out;
}

/** A founding town stands this close to water, and a coastal one this close to a fresh source (a stand-in for a road to one). */
export const SHORE = 1;
export const FRESH_HAUL = 8;

/** The kinds of water (`WATER_FRESH`, `WATER_SALT`) within `r` cells (Chebyshev) of (x, y). */
export function waterWithin(res: Resources, W: number, H: number, x: number, y: number, r: number): { fresh: boolean; salt: boolean } {
  let fresh = false;
  let salt = false;
  for (let yy = Math.max(0, y - r); yy <= Math.min(H - 1, y + r); yy++) {
    for (let xx = Math.max(0, x - r); xx <= Math.min(W - 1, x + r); xx++) {
      const w = res.water[yy * W + xx];
      if (w === WATER_FRESH) fresh = true;
      else if (w === WATER_SALT) salt = true;
    }
  }
  return { fresh, salt };
}

/** Whether a first settlement can stand at (x, y): fresh water on its doorstep, or the sea there and a fresh source within `FRESH_HAUL`. */
export function canFound(res: Resources, W: number, H: number, x: number, y: number): boolean {
  const here = waterWithin(res, W, H, x, y, SHORE);
  if (here.fresh) return true;
  return here.salt && waterWithin(res, W, H, x, y, FRESH_HAUL).fresh;
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
