// Deterministic lazy generation: every object is a pure function of
// (seed, path). Small caches keep repeated lookups cheap but never change results.
import { YEAR } from './time';
import { rngFor, makeNoise } from './rng';
import { parsePath } from './path';
import { layoutTown } from './town';
import { SiteLife, ageAt, livingSeries, type Person, type SiteLifeSeed } from './life';
import type { DeltaStore } from './deltas';
import type {
  AnomalySummary,
  BodyKind,
  BodySummary,
  BodyView,
  DwellingKind,
  DwellingSummary,
  RecordChild,
  RecordData,
  RecordField,
  RecordLinks,
  SiteSummary,
  SiteView,
  SizeClass,
  StarClass,
  SystemSummary,
  SystemView,
  TownStyle,
  TrailItem,
  UniverseView,
} from './types';

export const BODY_W = 96;
export const BODY_H = 64;
export const SITE_N = 64;

const TAU = Math.PI * 2;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

function memo<T>(cache: Map<string, T>, key: string, cap: number, make: () => T): T {
  const hit = cache.get(key);
  if (hit !== undefined) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const v = make();
  cache.set(key, v);
  if (cache.size > cap) cache.delete(cache.keys().next().value as string);
  return v;
}

// -------------------------------------------------------------- universe

/** Systems shown on the universe map: a jittered grid, so they never overlap. Any index still generates. */
export const UNIVERSE_GRID = 7;
const UNIVERSE_SPAN = 240;

function universeTrail(seed: string): TrailItem {
  return { path: '', nameKey: rngFor(seed, 'u', 'name').u32(), nameKind: 'universe' };
}

export function genUniverse(seed: string, deltas: DeltaStore): UniverseView {
  const cell = UNIVERSE_SPAN / UNIVERSE_GRID;
  const systems: SystemSummary[] = [];
  for (let i = 0; i < UNIVERSE_GRID * UNIVERSE_GRID; i++) {
    const info = systemInfo(seed, i);
    const r = rngFor(seed, info.path, 'pos');
    const gx = i % UNIVERSE_GRID;
    const gy = Math.floor(i / UNIVERSE_GRID);
    systems.push({
      path: info.path,
      index: i,
      nameKey: info.nameKey,
      x: -UNIVERSE_SPAN / 2 + (gx + 0.5) * cell + r.range(-0.3, 0.3) * cell,
      y: -UNIVERSE_SPAN / 2 + (gy + 0.5) * cell + r.range(-0.3, 0.3) * cell,
      cls: info.cls,
      bodyCount: info.bodies.length,
      inspected: deltas.isInspected(info.path),
    });
  }
  const trail = universeTrail(seed);
  return { level: 'universe', path: '', nameKey: trail.nameKey, trail: [trail], systems };
}

// ---------------------------------------------------------------- systems

interface BodyMeta {
  path: string;
  index: number;
  nameKey: number;
  kind: BodyKind;
  orbit: number;
  period: number;
  phase: number;
  size: number;
  dayLength: number;
  /** Sidereal rotation period in ticks; negative = retrograde. The solar day (`dayLength`) is derived from it and `period`. */
  spin: number;
  siteTarget: number;
  anomalyCount: number;
}

interface SystemInfo {
  path: string;
  nameKey: number;
  cls: StarClass;
  starRadius: number;
  bodies: BodyMeta[];
}

const KIND_TABLES = {
  inner: { barren: 5, arid: 3, temperate: 1, frozen: 0, gaseous: 0 },
  mid: { barren: 1, arid: 2, temperate: 4, frozen: 1, gaseous: 1 },
  outer: { barren: 1, arid: 0, temperate: 0, frozen: 4, gaseous: 4 },
};

const SITE_TARGET: Record<BodyKind, [number, number]> = {
  temperate: [4, 9],
  arid: [2, 5],
  frozen: [1, 3],
  barren: [0, 2],
  gaseous: [0, 0],
};

const sysCache = new Map<string, SystemInfo>();

/** Relative star mass by class; the orbit period follows Kepler's third law. */
const STAR_MASS: Record<StarClass, number> = { dim: 0.6, mid: 1, bright: 1.7 };
/** Orbit (map units) at which a planet around a mass-1 star takes one standard year. */
const ORBIT_ONE_YEAR = 50;

/** Orbital period in ticks: grows with orbit^1.5, shrinks with the square root of the star's mass. */
export function orbitalPeriod(orbit: number, starMass: number): number {
  return Math.max(1, Math.round((YEAR * Math.pow(orbit / ORBIT_ONE_YEAR, 1.5)) / Math.sqrt(starMass)));
}

/** Time from one sunrise to the next, in ticks. A positive spin turns the same way as the orbit; a negative (retrograde)
 *  spin shortens the day. Spin equal to the period never sees a sunrise, so that returns the largest safe number
 *  (callers nudge spins away from it; this only keeps the function total). */
export function solarDay(spin: number, period: number): number {
  const rate = 1 / spin - 1 / period;
  return rate === 0 || !Number.isFinite(rate) ? Number.MAX_SAFE_INTEGER : Math.abs(1 / rate);
}

function systemInfo(seed: string, si: number): SystemInfo {
  return memo(sysCache, `${seed}|${si}`, 64, () => {
    const path = `s${si}`;
    const r = rngFor(seed, path, 'sys');
    const nameKey = r.u32();
    const cls = r.weighted({ dim: 4, mid: 4, bright: 1.5 }) as StarClass;
    const starRadius = { dim: 4, mid: 6, bright: 8 }[cls];
    const n = r.int(3, 8);
    const step = 84 / n;
    let orbit = r.range(14, 20);
    const bodies: BodyMeta[] = [];
    for (let i = 0; i < n; i++) {
      const bp = `${path}/b${i}`;
      const br = rngFor(seed, bp, 'meta');
      const sr = rngFor(seed, bp, 'spin'); // its own stream, so the rest of the world does not reshuffle
      const f = n > 1 ? i / (n - 1) : 0.5;
      const kind = br.weighted(f < 0.3 ? KIND_TABLES.inner : f < 0.6 ? KIND_TABLES.mid : KIND_TABLES.outer);
      const [lo, hi] = SITE_TARGET[kind];
      const period = orbitalPeriod(orbit, STAR_MASS[cls]);
      // Most worlds turn in 10 to 40 hours; some are slow (Venus-like, up to months); a few turn backwards.
      let spin = sr.chance(0.85) ? sr.range(10, 40) : sr.range(120, 3000);
      if (spin > period * 0.8 && spin < period * 1.25) spin = period * 0.6; // not locked to a sunless day
      spin = Math.round(spin); // whole ticks, so the stored spin reproduces the day exactly
      if (sr.chance(0.08)) spin = -spin;
      bodies.push({
        path: bp,
        index: i,
        nameKey: br.u32(),
        kind,
        orbit,
        period,
        phase: br.range(0, TAU),
        size: kind === 'gaseous' ? br.range(3.5, 5.5) : br.range(1.4, 2.8),
        // The comma keeps the draw the old independent day length used, so every draw after it is unchanged.
        dayLength: (br.int(18, 40), Math.max(1, Math.round(solarDay(spin, period)))),
        spin,
        siteTarget: br.int(lo, hi),
        anomalyCount: kind === 'gaseous' ? br.int(0, 1) : br.int(0, 3),
      });
      orbit += step * br.range(0.75, 1.15);
    }
    return { path, nameKey, cls, starRadius, bodies };
  });
}

export function genSystem(seed: string, si: number, deltas: DeltaStore): SystemView {
  const info = systemInfo(seed, si);
  const bodies: BodySummary[] = info.bodies.map((b) => ({
    path: b.path,
    index: b.index,
    nameKey: b.nameKey,
    kind: b.kind,
    orbit: b.orbit,
    period: b.period,
    phase: b.phase,
    size: b.size,
    siteCount: bodyCore(seed, si, b.index).sites.length,
    inspected: deltas.isInspected(b.path),
  }));
  return {
    level: 'system',
    path: info.path,
    nameKey: info.nameKey,
    trail: [universeTrail(seed), systemTrail(seed, si)],
    star: { cls: info.cls, radius: info.starRadius },
    bodies,
  };
}

// ----------------------------------------------------------------- bodies

type Base<T> = Omit<T, 'inspected'>;

interface BodyCore {
  meta: BodyMeta;
  cells: Uint8Array;
  sites: Base<SiteSummary>[];
  anomalies: Base<AnomalySummary>[];
}

const SEA: Record<BodyKind, number> = {
  temperate: 0.44,
  arid: 0.22,
  frozen: 0.34,
  barren: -1,
  gaseous: -1,
};

function classify(kind: BodyKind, h: number): number {
  const sea = SEA[kind];
  if (sea < 0) return h < 0.45 ? 3 : h < 0.6 ? 4 : h < 0.75 ? 5 : 6;
  if (h < sea - 0.12) return 0;
  if (h < sea) return 1;
  if (h < sea + 0.04) return 2;
  return h < 0.62 ? 3 : h < 0.74 ? 4 : h < 0.85 ? 5 : 6;
}

const bodyCache = new Map<string, BodyCore>();

function bodyCore(seed: string, si: number, bi: number): BodyCore {
  return memo(bodyCache, `${seed}|${si}|${bi}`, 32, () => {
    const meta = systemInfo(seed, si).bodies[bi];
    if (!meta) throw new Error(`No body ${bi} in system ${si}`);
    const W = BODY_W;
    const H = BODY_H;
    const r = rngFor(seed, meta.path, 'terrain');
    const noise = makeNoise(r.u32());
    const ox = r.range(0, 1000);
    const oy = r.range(0, 1000);
    const cells = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (meta.kind === 'gaseous') {
          const v = Math.floor((y / H) * 14 + (noise.fbm(ox + x / 30, oy + y / 5, 3) - 0.5) * 6);
          cells[y * W + x] = ((v % 7) + 7) % 7;
        } else {
          const h = clamp01((noise.fbm(ox + x / 22, oy + y / 22, 4) - 0.5) * 2 + 0.5);
          cells[y * W + x] = classify(meta.kind, h);
        }
      }
    }

    const sites: Base<SiteSummary>[] = [];
    const sr = rngFor(seed, meta.path, 'sites');
    for (let attempt = 0; attempt < 400 && sites.length < meta.siteTarget; attempt++) {
      const x = sr.int(4, W - 5);
      const y = sr.int(4, H - 5);
      const c = cells[y * W + x] as number;
      if (c < 2 || c > 4) continue;
      if (sites.some((s) => Math.hypot(s.x - x, s.y - y) < 9)) continue;
      const population =
        meta.kind === 'barren' ? sr.int(8, 60) : Math.round(Math.pow(10, sr.range(1.6, 3.9)));
      const size: SizeClass = population < 300 ? 'small' : population < 2000 ? 'medium' : 'large';
      const index = sites.length;
      sites.push({ path: `${meta.path}/t${index}`, index, nameKey: sr.u32(), x, y, size, population });
    }

    const anomalies: Base<AnomalySummary>[] = [];
    const ar = rngFor(seed, meta.path, 'anomalies');
    for (let attempt = 0; attempt < 100 && anomalies.length < meta.anomalyCount; attempt++) {
      const x = ar.int(2, W - 3);
      const y = ar.int(2, H - 3);
      if (meta.kind !== 'gaseous' && (cells[y * W + x] as number) < 1) continue;
      const index = anomalies.length;
      anomalies.push({ path: `${meta.path}/a${index}`, index, nameKey: ar.u32(), x, y });
    }
    return { meta, cells, sites, anomalies };
  });
}

export function bodySites(seed: string, si: number, bi: number): Base<SiteSummary>[] {
  return bodyCore(seed, si, bi).sites;
}

export function bodyCount(seed: string, si: number): number {
  return systemInfo(seed, si).bodies.length;
}

export function settledBodyIndexes(seed: string, si: number): number[] {
  return systemInfo(seed, si)
    .bodies.filter((b) => bodyCore(seed, si, b.index).sites.length > 0)
    .map((b) => b.index);
}

function systemTrail(seed: string, si: number): TrailItem {
  const info = systemInfo(seed, si);
  return { path: info.path, nameKey: info.nameKey, nameKind: 'system' };
}

function bodyTrail(seed: string, si: number, bi: number): TrailItem {
  const m = bodyCore(seed, si, bi).meta;
  return { path: m.path, nameKey: m.nameKey, nameKind: 'body', tag: m.kind };
}

export function genBody(seed: string, si: number, bi: number, deltas: DeltaStore): BodyView {
  const core = bodyCore(seed, si, bi);
  return {
    level: 'body',
    path: core.meta.path,
    nameKey: core.meta.nameKey,
    trail: [universeTrail(seed), systemTrail(seed, si), bodyTrail(seed, si, bi)],
    kind: core.meta.kind,
    w: BODY_W,
    h: BODY_H,
    cells: core.cells,
    dayLength: core.meta.dayLength,
    sites: core.sites.map((s) => ({ ...s, inspected: deltas.isInspected(s.path) })),
    anomalies: core.anomalies.map((a) => ({ ...a, inspected: deltas.isInspected(a.path) })),
  };
}

// ------------------------------------------------------------------ sites

interface SiteCore {
  body: BodyCore;
  site: Base<SiteSummary>;
  cells: Uint8Array;
  dwellings: Base<DwellingSummary>[];
  style: TownStyle;
}

const siteCache = new Map<string, SiteCore>();

function siteCore(seed: string, si: number, bi: number, ti: number): SiteCore {
  return memo(siteCache, `${seed}|${si}|${bi}|${ti}`, 32, () => {
    const body = bodyCore(seed, si, bi);
    const site = body.sites[ti];
    if (!site) throw new Error(`No site ${ti} on body ${bi}`);
    const layout = layoutTown(SITE_N, site.size, site.population, body.meta.kind, rngFor(seed, site.path, 'layout'));
    const dwellings: Base<DwellingSummary>[] = layout.buildings.map((b, index) => {
      const path = `${site.path}/d${index}`;
      return {
        path,
        index,
        nameKey: rngFor(seed, path, 'family').u32(),
        kind: b.kind,
        x: b.x,
        y: b.y,
        w: b.w,
        h: b.h,
        residents: b.residents,
      };
    });
    return { body, site, cells: layout.cells, dwellings, style: layout.style };
  });
}

export function genSite(seed: string, si: number, bi: number, ti: number, deltas: DeltaStore): SiteView {
  const core = siteCore(seed, si, bi, ti);
  const { site, body } = core;
  return {
    level: 'site',
    path: site.path,
    nameKey: site.nameKey,
    trail: [
      universeTrail(seed),
      systemTrail(seed, si),
      bodyTrail(seed, si, bi),
      { path: site.path, nameKey: site.nameKey, nameKind: 'site', tag: site.size },
    ],
    bodyKind: body.meta.kind,
    w: SITE_N,
    h: SITE_N,
    cells: core.cells,
    dwellings: core.dwellings.map((d) => ({ ...d, inspected: deltas.isInspected(d.path) })),
    dayLength: body.meta.dayLength,
    lon: site.x / BODY_W,
    population: site.population,
    size: site.size,
    style: core.style,
  };
}

// ---------------------------------------------------------------- records

/** Person names: high 16 bits = family (shared with the dwelling), low 16 = given. */
function personKey(seed: string, dwellingNameKey: number, personPath: string): number {
  const given = rngFor(seed, personPath, 'given').u32() & 0xffff;
  return ((((dwellingNameKey >>> 16) << 16) | given) >>> 0) as number;
}

/**
 * A household in family-tree order: each couple (or lone parent) followed by their children, indented, and then
 * those children's own children. The other parent of the children is flagged `partner`, so a housemate who is no
 * relation is not mistaken for one. Anyone whose parents are not at home is a root. Oldest first at every level.
 */
export function familyOrder(here: Person[], tick: number): { p: Person; indent: number; partner: boolean }[] {
  const ids = new Set(here.map((p) => p.id));
  const isChild = (p: Person) => (p.mother !== null && ids.has(p.mother)) || (p.father !== null && ids.has(p.father));
  const older = (a: Person, b: Person) => ageAt(b, tick) - ageAt(a, tick) || a.id - b.id;
  const out: { p: Person; indent: number; partner: boolean }[] = [];
  const placed = new Set<number>();
  const place = (p: Person, indent: number, partner = false): void => {
    if (placed.has(p.id)) return;
    placed.add(p.id);
    out.push({ p, indent, partner });
    const kids = here.filter((c) => (c.mother === p.id || c.father === p.id) && !placed.has(c.id)).sort(older);
    // The other parent of these children, if at home, goes straight after.
    for (const k of kids) {
      const otherId = p.sex === 'f' ? k.father : k.mother;
      const other = otherId === null ? undefined : here.find((q) => q.id === otherId);
      if (other && !placed.has(other.id) && !isChild(other)) {
        placed.add(other.id);
        out.push({ p: other, indent, partner: true });
      }
    }
    for (const k of kids) place(k, Math.min(indent + 1, 3));
  };
  for (const p of [...here].sort(older)) if (!isChild(p)) place(p, 0);
  for (const p of [...here].sort(older)) place(p, 0); // cycles cannot happen, but never drop anyone
  return out;
}

/** A person as a link in a record: their path names the dwelling they started in, wherever they live now. */
function personLink(seed: string, sc: SiteCore, p: Person, tick: number): RecordChild {
  const origin = sc.dwellings[p.origin]!;
  const path = `${origin.path}/p${p.local}`;
  return {
    path,
    nameKey: personKey(seed, origin.nameKey, path),
    nameKind: 'person',
    feature: 'inhabitants',
    meta: { sex: p.sex, age: ageAt(p, tick), dead: p.deathTick !== null },
  };
}

/** Everyone alive in a district at tick 0, for the life model. */
export function siteLifeSeed(seed: string, si: number, bi: number, ti: number): SiteLifeSeed {
  const sc = siteCore(seed, si, bi, ti);
  return {
    path: sc.site.path,
    dwellings: sc.dwellings.map((d) => ({
      path: d.path,
      kind: d.kind,
      residents: d.residents,
    })),
  };
}

const tick0Cache = new Map<string, SiteLife>();
/** The district as it is at tick 0, for records shown without a running district. Never advanced. */
function tick0Life(seed: string, si: number, bi: number, ti: number): SiteLife {
  return memo(tick0Cache, `${seed}|${si}|${bi}|${ti}`, 16, () => new SiteLife(seed, siteLifeSeed(seed, si, bi, ti)));
}

/** Time-dependent state a record can reflect. Without it, records show the world at tick 0. */
export interface LiveContext {
  tick: number;
  life: SiteLife | null;
}

const ROLES = ['laborer', 'artisan', 'trader', 'keeper', 'scholar', 'guard'] as const;
const TRAITS = ['curious', 'stoic', 'cheerful', 'wary', 'bold', 'patient', 'restless', 'generous'] as const;
const MOODS = ['content', 'tense', 'weary', 'elated'] as const;

export function genRecord(seed: string, path: string, deltas: DeltaStore, live?: LiveContext): RecordData {
  const segs = parsePath(path);
  const last = segs[segs.length - 1];
  if (!last) throw new Error('Empty path');
  const si = segs.find((s) => s.k === 's')?.i ?? 0;
  const bi = segs.find((s) => s.k === 'b')?.i ?? 0;
  const ti = segs.find((s) => s.k === 't')?.i ?? 0;
  const inspected = deltas.isInspected(path);
  const num = (label: string, value: number, feature?: RecordField['feature']): RecordField => ({
    label,
    value,
    feature,
  });

  switch (last.k) {
    case 's': {
      const info = systemInfo(seed, si);
      const bodies = info.bodies;
      const settled = bodies.filter((b) => bodyCore(seed, si, b.index).sites.length > 0).length;
      return {
        path,
        kind: 'system',
        nameKey: info.nameKey,
        nameKind: 'system',
        inspected,
        fields: [
          { label: 'star', value: info.cls, vocab: 'star' },
          num('bodies', bodies.length),
          num('settled', settled),
        ],
        children: bodies.map((b) => ({ path: b.path, nameKey: b.nameKey, nameKind: 'body', tag: b.kind })),
      };
    }
    case 'b': {
      const core = bodyCore(seed, si, last.i);
      const m = core.meta;
      const children: RecordChild[] = [
        ...core.sites.map((s): RecordChild => ({ path: s.path, nameKey: s.nameKey, nameKind: 'site', tag: s.size })),
        ...core.anomalies.map(
          (a): RecordChild => ({ path: a.path, nameKey: a.nameKey, nameKind: 'anomaly', feature: 'anomalies' }),
        ),
      ];
      return {
        path,
        kind: 'body',
        nameKey: m.nameKey,
        nameKind: 'body',
        tag: m.kind,
        inspected,
        fields: [
          { label: 'kind', value: m.kind, vocab: 'body' },
          num('orbit', Math.round(m.orbit * 10) / 10),
          num('period', m.period),
          num('dayLength', m.dayLength),
          num('sites', core.sites.length),
          num('anomalies', core.anomalies.length, 'anomalies'),
        ],
        children,
      };
    }
    case 't': {
      const sc = siteCore(seed, si, bi, last.i);
      const life = live?.life ?? null;
      const residents = life ? life.living : sc.dwellings.reduce((n, d) => n + d.residents, 0);
      return {
        path,
        kind: 'site',
        nameKey: sc.site.nameKey,
        nameKind: 'site',
        tag: sc.site.size,
        inspected,
        fields: [
          { label: 'size', value: sc.site.size, vocab: 'size' },
          { label: 'layout', value: sc.style, vocab: 'layout' },
          num('population', life ? Math.max(0, sc.site.population + life.net) : sc.site.population),
          num('dwellings', sc.dwellings.length),
          num('residents', residents, 'inhabitants'),
          ...(life ? [num('births', life.totals.births, 'inhabitants'), num('deaths', life.totals.deaths, 'inhabitants')] : []),
        ],
        children: [],
        charts: life ? [{ label: 'population', points: livingSeries(life, null, sc.site.population - life.initial) }] : undefined,
      };
    }
    case 'd': {
      const sc = siteCore(seed, si, bi, ti);
      const d = sc.dwellings[last.i];
      if (!d) throw new Error(`No dwelling ${last.i}`);
      const r = rngFor(seed, d.path, 'record');
      const condition = r.int(20, 100);
      const output = Math.round(r.range(0, 100) * (d.kind === 'works' ? 1 : d.kind === 'shop' ? 0.7 : 0.3));
      const life = live?.life ?? null;
      const L = life ?? tick0Life(seed, si, bi, ti); // without a running district: the people as they start
      const T = life ? live!.tick : 0;
      const children: RecordChild[] = familyOrder(L.residents(last.i), T).map(({ p, indent, partner }) => ({
        ...personLink(seed, sc, p, T),
        indent,
        ...(partner ? { partner } : {}),
      }));
      return {
        path,
        kind: 'dwelling',
        nameKey: d.nameKey,
        nameKind: 'dwelling',
        tag: d.kind,
        inspected,
        fields: [
          { label: 'kind', value: d.kind, vocab: 'dwelling' },
          num('residents', children.length, 'inhabitants'),
          num('condition', condition),
          num('output', output, 'economy'),
        ],
        children,
        charts: life ? [{ label: 'residents', points: livingSeries(life, last.i) }] : undefined,
      };
    }
    case 'p': {
      const sc = siteCore(seed, si, bi, ti);
      const dwelling = segs.find((s) => s.k === 'd');
      const d = dwelling ? sc.dwellings[dwelling.i] : undefined;
      if (!d) throw new Error('Person without dwelling');
      const r = rngFor(seed, path, 'record');
      r.int(1, 82); // the draw that used to give the age; kept so traits and mood do not shift
      // Without a running district, the person as they start (tick 0), from the same model.
      const L = live?.life ?? tick0Life(seed, si, bi, ti);
      const T = live?.life ? live.tick : 0;
      const me = L.person(dwelling!.i, last.i);
      const age = me ? ageAt(me, T) : 0;
      // Always draw, so traits and mood stay put as the age (and so the role) changes over time.
      const rolePick = r.pick(ROLES);
      const wealthRoll = r.int(0, 100);
      const role = age < 14 ? 'child' : age > 66 ? 'elder' : rolePick;
      const people = (ps: Person[]): RecordChild[] => ps.map((p) => personLink(seed, sc, p, T));
      const links: RecordLinks[] = [];
      if (me) {
        const group = (label: string, items: RecordChild[]) => items.length > 0 && links.push({ label, items });
        if (me.deathTick === null) {
          const home = sc.dwellings[me.residence]!;
          group('residence', [{ path: home.path, nameKey: home.nameKey, nameKind: 'dwelling', tag: home.kind }]);
        }
        group('mother', people(me.mother === null ? [] : [L.people[me.mother]!]));
        group('father', people(me.father === null ? [] : [L.people[me.father]!]));
        group('offspring', people(L.people.filter((p) => p.mother === me.id || p.father === me.id)));
      }
      return {
        path,
        kind: 'person',
        nameKey: personKey(seed, d.nameKey, path),
        nameKind: 'person',
        links,
        inspected,
        fields: [
          num('age', age),
          ...(me ? [{ label: 'sex', value: me.sex, vocab: 'sex' }] : []),
          ...(me?.deathTick != null ? [{ label: 'status', value: 'deceased', vocab: 'state' }] : []),
          { label: 'role', value: role, vocab: 'role' },
          { label: 'trait', value: r.pick(TRAITS), vocab: 'trait' },
          { label: 'mood', value: r.pick(MOODS), vocab: 'mood' },
          num('wealth', age < 14 ? 0 : wealthRoll, 'economy'),
        ],
        children: [],
      };
    }
    case 'a': {
      const core = bodyCore(seed, si, bi);
      const a = core.anomalies[last.i];
      if (!a) throw new Error(`No anomaly ${last.i}`);
      const r = rngFor(seed, path, 'record');
      return {
        path,
        kind: 'anomaly',
        nameKey: a.nameKey,
        nameKind: 'anomaly',
        inspected,
        fields: [num('strength', r.int(1, 100)), num('depth', r.int(1, 900))],
        children: [],
      };
    }
  }
}
