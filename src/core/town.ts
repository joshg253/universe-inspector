// Town layout: street network, plaza and hall, an optional river, then buildings packed along the streets.
// Pure function of the rng it is given (so of seed + path). No theme words: it emits ids and cell codes.
import { makeNoise, type Rng } from './rng';
import type { BodyKind, DwellingKind, SizeClass, TownStyle } from './types';

/** Cell codes of the district grid. Buildings are not in the grid; they are listed separately. */
export const CELL = { ground: 0, road: 1, plaza: 2, green: 3, water: 4, track: 5 } as const;

export interface TownBuilding {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: DwellingKind;
  residents: number;
  /** Index into `TownLayout.plots` of the plot it stands on (-1 for the hall). */
  plot: number;
  /** The entrance: a cell of the building's rectangle on its edge, and which side it faces (0 north, 1 east, 2 south, 3 west). */
  door: { x: number; y: number; side: number };
  /** The week it is finished: 0 stands from the start, later is a plot cleared and built on as the years go. */
  built: number;
}

/** A parcel of ground: one building stands on it (with its yard), or none yet. Parcels never overlap. */
export interface TownPlot {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Index into `TownLayout.buildings` of what stands there, -1 while vacant. */
  building: number;
}

export interface TownLayout {
  style: TownStyle;
  cells: Uint8Array;
  buildings: TownBuilding[];
  plots: TownPlot[];
}

const STYLE_WEIGHTS: Record<SizeClass, Record<TownStyle, number>> = {
  small: { village: 5, organic: 3, grid: 1, radial: 0 },
  medium: { village: 1, organic: 3, grid: 3, radial: 1 },
  large: { village: 0, organic: 2, grid: 4, radial: 3 },
};

const FOOTPRINTS: [number, number, number][] = [
  [2, 2, 40],
  [3, 2, 20],
  [2, 3, 20],
  [3, 3, 10],
  [4, 3, 4],
  [3, 4, 4],
  [2, 1, 6],
];

const DENSITY: Record<SizeClass, number> = { small: 0.5, medium: 0.65, large: 0.8 };
const HALL: Record<SizeClass, [number, number]> = { small: [3, 3], medium: [4, 3], large: [4, 4] };

export function layoutTown(N: number, size: SizeClass, population: number, bodyKind: BodyKind, r: Rng): TownLayout {
  const cells = new Uint8Array(N * N);
  const occ = new Uint8Array(N * N); // 1 where a building stands
  const noise = makeNoise(r.u32());
  const c = N / 2;
  const cx = Math.floor(c);
  const cy = Math.floor(c);
  // Town radius grows with population: about 7 cells for an outpost to about 21 for a metropolis.
  const R = Math.max(7, Math.min(N / 2 - 4, 5 + 5.5 * (Math.log10(Math.max(10, population)) - 1)));
  const style = r.weighted(STYLE_WEIGHTS[size]) as TownStyle;

  const inB = (x: number, y: number) => x >= 0 && y >= 0 && x < N && y < N;
  const dist = (x: number, y: number) => Math.hypot(x + 0.5 - c, y + 0.5 - c);
  /** The town's ragged boundary. */
  const inside = (x: number, y: number) => dist(x, y) < R * (0.82 + 0.36 * noise.fbm(x / 7 + 3, y / 7 + 9, 3));

  const put = (x: number, y: number, v: number, clip = true) => {
    if (!inB(x, y) || (clip && !inside(x, y))) return;
    cells[y * N + x] = v;
  };
  const line = (x0: number, y0: number, x1: number, y1: number, clip = true) => {
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    for (;;) {
      put(x0, y0, CELL.road, clip);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x0 += sx;
      }
      if (e2 < dx) {
        err += dx;
        y0 += sy;
      }
    }
  };
  /** A two-cell-wide street. */
  const avenue = (x0: number, y0: number, x1: number, y1: number) => {
    line(x0, y0, x1, y1);
    if (Math.abs(x1 - x0) >= Math.abs(y1 - y0)) line(x0, y0 + 1, x1, y1 + 1);
    else line(x0 + 1, y0, x1 + 1, y1);
  };
  const lo = Math.floor(c - R) - 1;
  const hi = Math.ceil(c + R) + 1;

  // ---- streets
  if (style === 'grid') {
    const spots = (mid: number): number[] => {
      const out = [mid];
      for (let p = mid - r.int(5, 8); p > lo; p -= r.int(5, 8)) out.push(p);
      for (let p = mid + r.int(5, 8); p < hi; p += r.int(5, 8)) out.push(p);
      return out;
    };
    for (const x of spots(cx)) {
      if (x === cx) avenue(x, lo, x, hi);
      else line(x, lo + r.int(0, 4), x, hi - r.int(0, 4));
    }
    for (const y of spots(cy)) {
      if (y === cy) avenue(lo, y, hi, y);
      else line(lo + r.int(0, 4), y, hi - r.int(0, 4), y);
    }
  } else if (style === 'radial') {
    const TAU = Math.PI * 2;
    for (let rad = 4 + r.int(0, 2); rad < R + 2; rad += r.int(5, 7)) {
      const steps = Math.ceil(TAU * rad * 2);
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * TAU;
        put(Math.round(c + Math.cos(a) * rad - 0.5), Math.round(c + Math.sin(a) * rad - 0.5), CELL.road);
      }
    }
    const spokes = r.int(6, 10);
    const a0 = r.range(0, TAU / spokes);
    for (let k = 0; k < spokes; k++) {
      const a = a0 + (k * TAU) / spokes;
      line(cx, cy, Math.round(c + Math.cos(a) * (R + 1)), Math.round(c + Math.sin(a) * (R + 1)));
    }
  } else if (style === 'organic') {
    const horiz = r.chance(0.5);
    const amp = r.range(2, 5);
    const wave = r.range(5, 9);
    const phase = r.range(0, 6.28);
    const at = (t: number): [number, number] => {
      const off = Math.round(amp * Math.sin(t / wave + phase));
      return horiz ? [cx + t, cy + off] : [cx + off, cy + t];
    };
    let prev = at(lo - cx);
    for (let t = lo - cx + 1; t <= hi - cx; t++) {
      const p = at(t);
      avenue(prev[0], prev[1], p[0], p[1]);
      prev = p;
    }
    const lane = (sx: number, sy: number, dx: number, dy: number, len: number, depth: number) => {
      let x = sx;
      let y = sy;
      for (let i = 0; i < len; i++) {
        x += dx;
        y += dy;
        if (r.chance(0.2)) {
          // wander sideways
          if (dx === 0) x += r.chance(0.5) ? 1 : -1;
          else y += r.chance(0.5) ? 1 : -1;
        }
        put(x, y, CELL.road);
        if (depth === 0 && i > 2 && r.chance(0.12)) lane(x, y, dy, dx, Math.floor((len - i) / 2) + 2, 1);
      }
    };
    for (let t = lo - cx + 2; t < hi - cx; t += r.int(4, 7)) {
      const [x, y] = at(t);
      const len = r.int(4, Math.max(5, Math.floor(R * 0.9)));
      if (r.chance(0.8)) lane(x, y, horiz ? 0 : 1, horiz ? 1 : 0, len, 0);
      if (r.chance(0.8)) lane(x, y, horiz ? 0 : -1, horiz ? -1 : 0, len, 0);
    }
  } else {
    // village: a crossroads and a few lanes
    const reach = Math.floor(R * 0.85);
    avenue(cx - reach, cy, cx + reach, cy);
    line(cx, cy - reach, cx, cy + reach);
    for (let k = r.int(2, 4); k > 0; k--) {
      const t = r.int(-reach + 2, reach - 2);
      const len = r.int(3, 7);
      if (r.chance(0.5)) line(cx + t, cy, cx + t, cy + (r.chance(0.5) ? len : -len));
      else line(cx, cy + t, cx + (r.chance(0.5) ? len : -len), cy + t);
    }
  }

  // ---- river: crosses the district, roads keep going over it (bridges)
  const riverChance = bodyKind === 'temperate' ? 0.45 : bodyKind === 'arid' ? 0.08 : 0;
  if (r.chance(riverChance)) {
    const vertical = r.chance(0.5);
    const base = c + (r.chance(0.5) ? 1 : -1) * r.int(7, 13);
    const amp = r.range(2, 5);
    const wave = r.range(6, 11);
    const phase = r.range(0, 6.28);
    const width = r.int(2, 3);
    for (let t = 0; t < N; t++) {
      const centre = Math.round(base + amp * Math.sin(t / wave + phase));
      for (let k = 0; k < width; k++) {
        const x = vertical ? centre + k : t;
        const y = vertical ? t : centre + k;
        if (inB(x, y) && cells[y * N + x] === CELL.ground) cells[y * N + x] = CELL.water;
      }
    }
  }

  // ---- plaza and hall at the centre, over whatever was there
  const [hw, hh] = HALL[size];
  const hx = cx - Math.floor(hw / 2);
  const hy = cy - Math.floor(hh / 2);
  const ring = size === 'large' ? 2 : 1;
  for (let y = hy - ring; y < hy + hh + ring; y++) for (let x = hx - ring; x < hx + hw + ring; x++) put(x, y, CELL.plaza, false);
  const buildings: TownBuilding[] = [{ x: hx, y: hy, w: hw, h: hh, kind: 'hall', residents: (r.int(0, 2), 0), plot: -1, door: { x: 0, y: 0, side: 0 }, built: 0 }]; // the draw is kept so every later one is unchanged
  for (let y = hy; y < hy + hh; y++) for (let x = hx; x < hx + hw; x++) occ[y * N + x] = 1;

  // ---- the whole district is plotted out: tiny plots downtown, larger toward the edge, huge ones beyond the town
  // Land is claimed in order of distance from the center, each plot sized by where it lies. Then each plot gets a building
  // (more often downtown), is cleared for one that comes later, or stays vacant; huge plots out in the country may hold a
  // farmstead. A building stands in the corner of its plot nearest the center, the rest of the plot is its yard.
  const plots: TownPlot[] = [];
  const owned = new Uint8Array(N * N); // 1 where a plot lies
  const farmSet = new Set<TownBuilding>();
  const claim = (px: number, py: number, pw: number, ph: number, bx: number, by: number, w: number, h: number, vacant: boolean, built = 0) => {
    for (let y = py; y < py + ph; y++) for (let x = px; x < px + pw; x++) owned[y * N + x] = 1;
    plots.push({ x: px, y: py, w: pw, h: ph, building: -1 });
    if (vacant) return;
    for (let y = by; y < by + h; y++) for (let x = bx; x < bx + w; x++) occ[y * N + x] = 1;
    buildings.push({ x: bx, y: by, w, h, kind: 'home', residents: 0, plot: plots.length - 1, door: { x: bx, y: by, side: 0 }, built });
  };
  /** When a building that is not there yet gets built: any year from the second on, most within a few centuries. */
  const buildWeek = () => 52 * (2 + Math.floor(-Math.log(1 - r.range(0, 0.99)) * 140));
  const footprint = (): [number, number] => {
    const total = FOOTPRINTS.reduce((n, f) => n + f[2], 0);
    let t = r.range(0, total);
    for (const [w, h, wt] of FOOTPRINTS) {
      t -= wt;
      if (t <= 0) return [w, h];
    }
    return [2, 2];
  };
  const dens = DENSITY[size];
  // Tiling: aligned blocks whose size grows with distance from the center (no draws); inside a block the free ground is
  // claimed row by row as rectangles. Slivers under 2 cells stay common ground.
  const ZONES: [number, number, number][] = [[0.45, 3, 3], [0.8, 4, 3], [1.15, 5, 4], [2, 8, 6], [Infinity, 14, 10]];
  const rects: { x: number; y: number; w: number; h: number; k: number }[] = [];
  const spare = (x: number, y: number) => inB(x, y) && cells[y * N + x] === CELL.ground && !occ[y * N + x] && !owned[y * N + x];
  let lower = 0;
  for (const [upTo, bw, bh] of ZONES) {
    const lo = lower * R;
    const hi = upTo * R;
    lower = upTo;
    for (let by = 0; by < N; by += bh) {
      for (let bx = 0; bx < N; bx += bw) {
        const d = dist(bx + bw / 2, by + bh / 2);
        if (d < lo || d >= hi) continue;
        const ex = Math.min(N, bx + bw);
        const ey = Math.min(N, by + bh);
        for (let y = by; y < ey; y++) {
          for (let x = bx; x < ex; x++) {
            if (!spare(x, y)) continue;
            let w = 1;
            while (x + w < ex && spare(x + w, y)) w++;
            let h = 1;
            for (let more = true; more && y + h < ey; ) {
              for (let xx = x; xx < x + w; xx++) if (!spare(xx, y + h)) more = false;
              if (more) h++;
            }
            if (w < 2 || h < 2) continue;
            for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) owned[yy * N + xx] = 1;
            rects.push({ x, y, w, h, k: dist(x + w / 2, y + h / 2) });
          }
        }
      }
    }
  }
  owned.fill(0); // claim() sets it again, plot by plot, in the order the buildings are decided
  rects.sort((p, q) => p.k - q.k);
  let farmsLeft = 3 + Math.round(R * 0.9);
  for (const { x, y, w: pw, h: ph, k: d } of rects) {
    const inTown = d < R + 2;
    let build = false;
    let farm = false;
    let later = 0;
    if (inTown) {
      const p = Math.max(0.12, Math.min(0.97, dens * (1.05 - 0.5 * Math.min(1, d / R))));
      if (r.chance(p)) {
        build = true;
        if (r.chance(0.35)) later = buildWeek();
      } else if (r.chance(0.5)) {
        build = true; // cleared now, built on some years on
        later = buildWeek();
      }
    } else if (farmsLeft > 0 && pw * ph >= 30 && r.chance(0.3)) {
      build = true;
      farm = true;
      farmsLeft--;
    }
    if (!build) {
      claim(x, y, pw, ph, x, y, 0, 0, true);
      continue;
    }
    const [fw, fh] = farm ? [r.chance(0.5) ? 2 : 3, r.chance(0.6) ? 2 : 3] : footprint();
    const w = Math.min(fw, pw);
    const h = Math.min(fh, ph);
    const bx = Math.max(x, Math.min(x + pw - w, Math.round(c - w / 2)));
    const by = Math.max(y, Math.min(y + ph - h, Math.round(c - h / 2)));
    claim(x, y, pw, ph, bx, by, w, h, false, later);
    if (farm) farmSet.add(buildings[buildings.length - 1]!);
  }

  // ---- what the buildings are, and who lives in them
  for (const b of buildings) {
    if (b.kind === 'hall') continue;
    if (farmSet.has(b)) {
      b.residents = b.built > 0 ? 0 : Math.min(r.int(2, 5), 2 + Math.floor((b.w * b.h) / 2)); // a farmstead's household, within capacity
      continue;
    }
    const area = b.w * b.h;
    const d = Math.min(1, dist(b.x + b.w / 2, b.y + b.h / 2) / R);
    b.kind = r.weighted({
      home: 70 - (area >= 9 ? 25 : 0),
      shop: 3 + 14 * (1 - d) + (area >= 6 ? 4 : 0),
      works: 5 + 16 * d + (area >= 9 ? 6 : 0),
    }) as DwellingKind;
    b.residents =
      b.kind === 'home'
        ? Math.max(1, Math.min(8, 1 + Math.floor(area * r.range(0.15, 0.55))))
        : b.kind === 'shop'
          ? r.int(0, 2) // the keeper's household lives above the shop
          : (r.int(0, 3), 0); // works and the hall are workplaces; nobody lives there (draw kept, see above)
    if (b.built > 0) b.residents = 0; // nobody lives in what is not built yet
  }

  // ---- gardens inside the town, fields outside it
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      if (cells[y * N + x] !== CELL.ground || occ[y * N + x]) continue;
      const n = noise.fbm(x / 4.5 + 11, y / 4.5 + 5, 2);
      if (n > (dist(x, y) < R * 1.05 ? 0.56 : 0.62)) cells[y * N + x] = CELL.green;
    }
  }

  // ---- footpaths and entrances. No draws: a pure walk over the finished town, so everything above is unchanged.
  const SIDES: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // north, east, south, west
  const open = (x: number, y: number) =>
    inB(x, y) && !occ[y * N + x] && (cells[y * N + x] === CELL.ground || cells[y * N + x] === CELL.green);
  const isStreet = (x: number, y: number) =>
    inB(x, y) && (cells[y * N + x] === CELL.road || cells[y * N + x] === CELL.plaza || cells[y * N + x] === CELL.track);
  /** The edge cells of a rectangle with the cell outside each, in a fixed scan order (north, east, south, west). */
  const edgeCells = (b: TownBuilding) => {
    const out: { x: number; y: number; side: number; ox: number; oy: number }[] = [];
    for (let x = b.x; x < b.x + b.w; x++) out.push({ x, y: b.y, side: 0, ox: x, oy: b.y - 1 });
    for (let y = b.y; y < b.y + b.h; y++) out.push({ x: b.x + b.w - 1, y, side: 1, ox: b.x + b.w, oy: y });
    for (let x = b.x; x < b.x + b.w; x++) out.push({ x, y: b.y + b.h - 1, side: 2, ox: x, oy: b.y + b.h });
    for (let y = b.y; y < b.y + b.h; y++) out.push({ x: b.x, y, side: 3, ox: b.x - 1, oy: y });
    return out;
  };
  // A building with no street cell beside it gets the shortest run of free cells to the nearest street (at most 40): over
  // land if any run exists, else with a bridge over the river (roads already cross it).
  const FLOOD = (b: TownBuilding, bridge: boolean): number[] | null => {
    const walk = (x: number, y: number) => open(x, y) || (bridge && inB(x, y) && !occ[y * N + x] && cells[y * N + x] === CELL.water);
    const parent = new Map<number, number>();
    let frontier: number[] = [];
    for (const e of edgeCells(b)) {
      const k = e.oy * N + e.ox;
      if (walk(e.ox, e.oy) && !parent.has(k)) {
        parent.set(k, -1);
        frontier.push(k);
      }
    }
    for (let depth = 0; depth < 40 && frontier.length > 0; depth++) {
      const next: number[] = [];
      for (const k of frontier) {
        const x = k % N;
        const y = Math.floor(k / N);
        if (SIDES.some(([dx, dy]) => isStreet(x + dx, y + dy))) {
          const run: number[] = [];
          for (let q = k; q >= 0; q = parent.get(q)!) run.push(q);
          return run;
        }
        for (const [dx, dy] of SIDES) {
          const nk = (y + dy) * N + (x + dx);
          if (walk(x + dx, y + dy) && !parent.has(nk)) {
            parent.set(nk, k);
            next.push(nk);
          }
        }
      }
      frontier = next;
    }
    return null;
  };
  for (const b of buildings) {
    if (edgeCells(b).some((e) => isStreet(e.ox, e.oy))) continue;
    const run = FLOOD(b, false) ?? FLOOD(b, true);
    if (run) for (const k of run) cells[k] = CELL.track; // a footpath or cart track, not a street: roads are not widened
  }
  // One that no path reaches (walled in by its neighbors) is not built.
  for (let i = buildings.length - 1; i >= 0; i--) {
    if (!edgeCells(buildings[i]!).some((e) => isStreet(e.ox, e.oy))) buildings.splice(i, 1);
  }
  buildings.forEach((b, i) => {
    if (b.plot >= 0) plots[b.plot]!.building = i;
  });
  // The entrance: the first edge cell facing the plaza, else the first facing a road, else the first facing open ground.
  for (const b of buildings) {
    const edge = edgeCells(b);
    const at = (e: { ox: number; oy: number }) => (inB(e.ox, e.oy) ? cells[e.oy * N + e.ox] : -1);
    const pick = edge.find((e) => at(e) === CELL.plaza) ?? edge.find((e) => at(e) === CELL.road) ?? edge.find((e) => at(e) === CELL.track) ?? edge.find((e) => inB(e.ox, e.oy)) ?? edge[0]!;
    b.door = { x: pick.x, y: pick.y, side: pick.side };
  }

  return { style, cells, buildings, plots };
}
