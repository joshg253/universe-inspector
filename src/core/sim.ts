// The tick simulation. It never sees wall-clock time: speeds just call step()
// more or less often, so a seeded run is identical at any speed.
import { DeltaStore } from './deltas';
import { bodySites, settledBodyIndexes, siteLifeSeed } from './generate';
import { SiteLife, TICKS_PER_WEEK } from './life';
import { parsePath, sitePathOf } from './path';
import { hashFloat, rngFor } from './rng';
import type { Dyn, DwellingKind, EventKind, SimEvent, View } from './types';

const TAU = Math.PI * 2;
const frac = (x: number) => x - Math.floor(x);
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

const EVENT_WEIGHTS: Record<EventKind, number> = {
  birth: 0, // births and deaths come from the life model (core/life.ts), not from this random stream
  death: 0,
  arrival: 2,
  departure: 2,
  exchange: 3,
  mishap: 1,
  gathering: 1.5,
  discovery: 0.5,
};

export class Sim {
  tick = 0;
  focus = 0; // system index events are generated for (simulation LOD: only what you watch)
  deltas = new DeltaStore();
  /** Settlement whose births and deaths are reported as they happen. Others are folded forward when looked at. */
  watchSite: string | null = null;
  /** Bumped whenever a watched district's life state changed, so the host knows to refresh views and records. */
  lifeVersion = 0;
  private lives = new Map<string, SiteLife>();
  /** Most weeks the watched district folds per call (a host sets it so a late look never stalls; `catchUp` does the rest). */
  foldBudget = Infinity;

  constructor(public readonly seed: string) {}

  setFocusFromPath(path: string): void {
    const s = parsePath(path)[0];
    if (s && s.k === 's') this.focus = s.i;
    this.watchSite = sitePathOf(path);
    if (this.watchSite) this.lifeFor(this.watchSite, true);
  }

  /** Life state of a settlement, fast-forwarded to the current tick. Null above settlement level. */
  lifeFor(path: string, lazy = false): SiteLife | null {
    const sitePath = sitePathOf(path);
    if (!sitePath) return null;
    const life = this.lifeAt(sitePath);
    if (lazy && sitePath === this.watchSite) return life; // the watched district is folded in slices by `catchUp`
    life.advanceTo(Math.floor(this.tick / TICKS_PER_WEEK));
    return life;
  }

  /** Weeks a settlement's district still has to fold to reach the current week (all of them if it was never opened). */
  behindOf(sitePath: string): number {
    return Math.max(0, Math.floor(this.tick / TICKS_PER_WEEK) - (this.lives.get(sitePath)?.week ?? 0));
  }

  /** Weeks the watched district still has to fold to reach the current week. */
  watchedBehind(): number {
    const life = this.watchSite ? this.lives.get(this.watchSite) : undefined;
    return life ? Math.max(0, Math.floor(this.tick / TICKS_PER_WEEK) - life.week) : 0;
  }

  /** Whether the watched district is folded up to the current week. */
  watchedCurrent(): boolean {
    const life = this.watchSite ? this.lives.get(this.watchSite) : undefined;
    return !life || life.week >= Math.floor(this.tick / TICKS_PER_WEEK);
  }

  /**
   * One slice of folding for the watched district while it is behind (see `foldWatched` for which events are reported).
   */
  catchUp(): SimEvent[] {
    const events: SimEvent[] = [];
    if (!this.watchedCurrent()) this.foldWatched(events);
    return events;
  }

  /**
   * End a jump where the districts have got to: the clock goes back to the earliest week any of the given settlements has
   * folded. Nothing the watched district has folded is thrown away (it is at that week exactly).
   */
  stopAt(sitePaths: string[]): SimEvent[] {
    const weeks = sitePaths.map((p) => this.lives.get(p)?.week).filter((w): w is number => w !== undefined);
    if (weeks.length === 0) return [];
    const to = Math.min(...weeks) * TICKS_PER_WEEK;
    return to < this.tick ? this.goto(to) : [];
  }

  private lifeAt(sitePath: string): SiteLife {
    let life = this.lives.get(sitePath);
    if (!life) {
      const [s, b, t] = parsePath(sitePath);
      life = new SiteLife(this.seed, siteLifeSeed(this.seed, s!.i, b!.i, t!.i));
      if (this.lives.size >= 24) this.lives.delete(this.lives.keys().next().value as string);
      this.lives.set(sitePath, life);
    }
    return life;
  }

  /**
   * A district's headcount for a list of settlements. It folds the district forward by at most `budget` weeks per call, so
   * opening a planet late in a long run never stalls; `current` is false while the district is still catching up.
   */
  peekLiving(sitePath: string, budget: number): { living: number; current: boolean } {
    const life = this.lifeAt(sitePath);
    const now = Math.floor(this.tick / TICKS_PER_WEEK);
    if (life.week < now) life.advanceTo(Math.min(now, life.week + budget));
    return { living: life.living, current: life.week >= now };
  }

  step(): SimEvent[] {
    this.tick++;
    const events = this.eventsAt(this.tick);
    if (this.tick % TICKS_PER_WEEK === 0) this.foldWatched(events);
    return events;
  }

  /** Bring the watched district's people up to the current tick, reporting what happened. */
  private foldWatched(events: SimEvent[]): void {
    const site = this.watchSite;
    const life = site ? this.lives.get(site) : undefined;
    if (!site || !life) return;
    const [s, b, t] = parsePath(site);
    const nameKey = bodySites(this.seed, s!.i, b!.i)[t!.i]?.nameKey ?? 0;
    const now = Math.floor(this.tick / TICKS_PER_WEEK);
    const to = Math.min(now, life.week + this.foldBudget);
    // A slice that ends more than a year short of now is old history: folded, but not reported.
    life.advanceTo(to, now - to > 52 ? undefined : (e) => events.push({ tick: e.tick, kind: e.kind, path: site, nameKey, n: e.n ?? 1 }));
    this.lifeVersion++;
  }

  /**
   * Advance n ticks. A long jump (a year or a century in one press) moves the clock straight there and folds the
   * watched district's weeks, instead of making a background event for every skipped hour; the last stretch is
   * stepped normally so the log is not empty. The people end up exactly where stepping tick by tick would put them.
   */
  advance(n: number): SimEvent[] {
    const events: SimEvent[] = [];
    const tail = Math.min(n, n > 2000 ? 200 : n);
    const jump = n - tail;
    if (jump > 0) {
      this.tick += jump;
      this.foldWatched(events);
    }
    for (let i = 0; i < tail; i++) events.push(...this.step());
    return events;
  }

  /**
   * Move the clock to any tick. Going back drops the folded districts: they are refolded from tick 0 the next time they are
   * looked at, which gives the same people as a district watched all the way to that tick.
   */
  goto(tick: number): SimEvent[] {
    const to = Math.max(0, Math.floor(tick));
    if (to >= this.tick) return this.advance(to - this.tick);
    // Only a district folded past the target is dropped; the rest are not ahead of it and stay as they are.
    const week = Math.floor(to / TICKS_PER_WEEK);
    for (const [path, life] of this.lives) if (life.week > week) this.lives.delete(path);
    this.tick = to;
    if (this.watchSite) this.lifeFor(this.watchSite, true);
    this.lifeVersion++;
    return [];
  }

  private eventsAt(tick: number): SimEvent[] {
    const r = rngFor(this.seed, `ev/${this.focus}`, String(tick));
    if (!r.chance(0.4)) return [];
    const settled = settledBodyIndexes(this.seed, this.focus);
    if (settled.length === 0) return [];
    const bi = r.pick(settled);
    const sites = bodySites(this.seed, this.focus, bi);
    const site = r.pick(sites);
    return [{ tick, kind: r.weighted(EVENT_WEIGHTS), path: site.path, nameKey: site.nameKey, n: r.int(1, 9) }];
  }
}

// ------------------------------------------------------- per-tick view state

function darkness(phase: number): number {
  // phase 0.5 is local noon, 0 is midnight
  const sun = Math.cos(TAU * (phase - 0.5));
  return clamp01((0.15 - sun) / 0.5);
}

const LIT: Record<DwellingKind, [number, number]> = {
  // [day, night] probability that the building shows activity
  home: [0.1, 0.75],
  shop: [0.8, 0.15],
  works: [0.7, 0.35],
  mill: [0.7, 0.3],
  quarry: [0.7, 0.2],
  dock: [0.7, 0.4],
  farm: [0.7, 0.1],
  mine: [0.7, 0.3],
  warehouse: [0.6, 0.2],
  hall: [0.9, 0.9],
};

export function dynFor(view: View, tick: number, seed: string): Dyn {
  switch (view.level) {
    case 'universe':
      return { level: 'universe' };
    case 'system':
      return { level: 'system', angles: view.bodies.map((b) => b.phase + (tick / b.period) * TAU) };
    case 'body': {
      const night = new Uint8Array(view.w);
      const s = frac(tick / view.dayLength);
      for (let x = 0; x < view.w; x++) night[x] = Math.round(darkness(frac(s - x / view.w + 0.5)) * 255);
      return { level: 'body', night };
    }
    case 'site': {
      const s = frac(tick / view.dayLength);
      const phase = frac(s - view.lon + 0.5);
      const dark = darkness(phase);
      const isNight = dark > 0.5 ? 1 : 0;
      const day = Math.floor(tick / view.dayLength);
      const lit = new Uint8Array(view.dwellings.length);
      view.dwellings.forEach((d, i) => {
        const p = LIT[d.kind][isNight];
        lit[i] = hashFloat(seed, `${d.path}|lit|${day}|${isNight}`) < p ? 1 : 0;
      });
      return { level: 'site', daylight: 1 - dark, hour: Math.floor(phase * 24) % 24, lit };
    }
  }
}
