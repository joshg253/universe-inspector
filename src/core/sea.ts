// Sea lanes: boat routes between coastal settlements and out to fishing grounds. Pure functions of the sites and the water layer
// (no draws, fixed neighbor order, ties by index), so a lane is the same whenever it is looked at.
import { WATER_SALT } from './resources';

/** Cells away from a settlement its boats can put out from. */
const PORT_REACH = 2;
/** A route longer than this many cells is not run. */
export const SEA_MAX = 90;
/** How far from its port a boat fishes, in cells of water. */
export const FISH_REACH = 18;
/** Deep cells in the 5x5 around a spot for it to count as a fishing ground. */
const GROUND_MIN = 8;
const NB8 = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]] as const;

export interface SeaRoute {
  /** indexes into the planet's sites */
  a: number;
  b: number;
  /** flat [x, y, ...] over salt water, from a's port to b's */
  path: number[];
}

export interface FishingGround {
  site: number;
  x: number;
  y: number;
  /** deep cells in the 5x5 around it: how rich it is */
  rich: number;
  path: number[];
}

interface Search {
  dist: Int32Array;
  from: Int32Array;
}

/** Breadth-first over salt water (8-way, fixed order) from `start`, no farther than `max` steps. */
function sail(salt: Uint8Array, W: number, H: number, start: number, max: number): Search {
  const dist = new Int32Array(W * H).fill(-1);
  const from = new Int32Array(W * H).fill(-1);
  const queue = [start];
  dist[start] = 0;
  for (let q = 0; q < queue.length; q++) {
    const cur = queue[q]!;
    if (dist[cur]! >= max) continue;
    const x = cur % W;
    const y = (cur - x) / W;
    for (const [dx, dy] of NB8) {
      const xx = x + dx;
      const yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      const k = yy * W + xx;
      if (!salt[k] || dist[k] >= 0) continue;
      dist[k] = dist[cur]! + 1;
      from[k] = cur;
      queue.push(k);
    }
  }
  return { dist, from };
}

function trace(s: Search, to: number, W: number): number[] {
  const cells: number[] = [];
  for (let k = to; k >= 0; k = s.from[k]!) cells.push(k);
  return cells.reverse().flatMap((k) => [k % W, Math.floor(k / W)]);
}

/** The salt-water cell a settlement's boats leave from: the nearest within PORT_REACH (ring by ring, scan order), or -1 inland. */
export function portCell(water: Uint8Array, W: number, H: number, x: number, y: number): number {
  for (let r = 1; r <= PORT_REACH; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const xx = x + dx;
        const yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        if (water[yy * W + xx] === WATER_SALT) return yy * W + xx;
      }
    }
  }
  return -1;
}

/**
 * The planet's sea lanes. Ports are settlements with salt water within PORT_REACH. In each connected stretch of sea the ports are
 * joined by a minimum spanning tree over the length of the shortest water path (ties by index), and each port also gets a lane out to
 * the richest deep-water spot within FISH_REACH, if one exists. Whether a port has a dock yet is the caller's age gate.
 */
export function seaLanes(
  sites: { x: number; y: number }[],
  water: Uint8Array,
  cells: Uint8Array,
  W: number,
  H: number,
): { routes: SeaRoute[]; fishing: FishingGround[] } {
  const salt = new Uint8Array(W * H);
  for (let i = 0; i < salt.length; i++) if (water[i] === WATER_SALT) salt[i] = 1;
  const port = sites.map((s) => portCell(water, W, H, s.x, s.y));
  const routes: SeaRoute[] = [];
  const fishing: FishingGround[] = [];
  const searches = new Map<number, Search>();
  const at = (i: number) => {
    let s = searches.get(i);
    if (!s) searches.set(i, (s = sail(salt, W, H, port[i]!, SEA_MAX)));
    return s;
  };
  const ports = port.map((p, i) => (p >= 0 ? i : -1)).filter((i) => i >= 0);

  const joined = new Set<number>();
  for (const root of ports) {
    if (joined.has(root)) continue;
    joined.add(root); // a new stretch of sea starts at the lowest unjoined port
    for (;;) {
      let bi = -1;
      let bj = -1;
      let best = Infinity;
      for (const i of ports) {
        if (!joined.has(i)) continue;
        for (const j of ports) {
          if (joined.has(j)) continue;
          const d = at(i).dist[port[j]!]!;
          if (d >= 0 && d < best) (best = d, bi = i, bj = j);
        }
      }
      if (bj < 0) break;
      joined.add(bj);
      routes.push({ a: bi, b: bj, path: trace(at(bi), port[bj]!, W) });
    }
  }

  for (const i of ports) {
    const s = at(i);
    let pick = -1;
    let rich = 0;
    for (let k = 0; k < s.dist.length; k++) {
      const d = s.dist[k]!;
      if (d < 3 || d > FISH_REACH || cells[k] !== 0) continue;
      const x = k % W;
      const y = (k - x) / W;
      let deep = 0;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < W && yy < H && salt[yy * W + xx] && cells[yy * W + xx] === 0) deep++;
        }
      }
      // richer first, then the nearer, then the lower index (the scan goes up, so strict comparisons keep the first)
      if (deep >= GROUND_MIN && (deep > rich || (deep === rich && d < s.dist[pick]!))) (pick = k, rich = deep);
    }
    if (pick >= 0) fishing.push({ site: i, x: pick % W, y: Math.floor(pick / W), rich, path: trace(s, pick, W) });
  }
  return { routes, fishing };
}
