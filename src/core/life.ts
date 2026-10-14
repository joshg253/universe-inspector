// Births, deaths, aging and moving house inside one settlement district.
//
// A pure function of (seed, site, week): the same world comes out no matter when or in what order you look at
// it. Looking at a district folds the weeks it has missed (fast-forward); watching it advances one week at a
// time and reports what happened. Nothing here is stored.
//
// People keep one identity for life: their path is `<dwelling they started in>/p<n>`. Where they live now is a
// separate fact (`residence`), so moving house never changes who they are or breaks a link to them.
import { hash32 } from './rng';
import { WEEK, YEAR } from './time';
import type { SiteView } from './types';

// Standard units (see time.ts); kept under the old names for the callers that count ages and weeks.
export const TICKS_PER_YEAR = YEAR;
export const TICKS_PER_WEEK = WEEK;

const ADULT = 18;
const FERTILE_MAX = 50; // women: no births from this age on
const MALE_FERTILE_MAX = 70;
/** How many people a building of `cells` cells holds: a couple of rooms plus one person per two cells, never over ten. */
export function capacityOf(cells: number): number {
  return Math.min(10, 2 + Math.floor(cells / 2));
}
/** A grown child still at home in a full house moves out this many times faster. */
const CROWDED_LEAVE = 4;
/** A home full for this many weeks in a row takes one more cell of free ground beside it. */
const EXPAND_AFTER_WEEKS = 13;
/** A home that took a cell finishes any notch in its outline at one cell per this many weeks, full or not. */
const FINISH_EVERY_WEEKS = 4;
/** The largest a home grows: 16 cells, where capacity reaches its cap of 10. */
const MAX_HOME_AREA = 16;
/** District grid codes a home may grow onto (CELL.ground, CELL.green in town.ts); roads, plaza and water stay. */
const FREE_CELLS = [0, 3];
const BIRTH_PER_WEEK = 0.12 / 52; // per fertile woman (before her own fertility) living with an eligible man; tuned so districts stay roughly level
const TWINS = 0.02;
/** Chance per week that a partner moves in from elsewhere when a fertile woman has no eligible man in the building. */
const MOVE_IN_PER_WEEK = 0.3 / 52;
const LEAVE_MIN = 18;
const LEAVE_MAX = 30;
const LEAVE_PER_WEEK = 0.5 / 52; // a young adult still at home moves out
const PREFER_MATCH = 0.8; // chance they pick a household with someone they could pair with
/** Chance that a young adult leaving home founds a household with a pairable peer in a vacant home. */
const FOUND_HOUSEHOLD = 0.6;
const FOUND_MAX_AGE = 35;
/** Per vacant home per week: a household arrives from outside and moves in. Scales with vacancy, so it self-limits. */
const HOUSEHOLD_PER_VACANT_WEEK = 0.012 / 52;
/** Chance per week, for each full home that cannot grow, that a reserve plot is started. */
const BUILD_PER_PRESSED_WEEK = 0.3 / 52;

export type Sex = 'f' | 'm';

export interface Person {
  /** Index in SiteLife.people. */
  id: number;
  /** Dwelling whose path names this person (where they started, were born, or arrived) and their index there. */
  origin: number;
  local: number;
  sex: Sex;
  birthTick: number;
  /** When they entered the district: birth, arrival, or their (negative) birth for the original residents. */
  since: number;
  deathTick: number | null;
  /** A mother is not fertile again before this tick (spacing between births varies). */
  restUntil: number;
  /** Parents' ids. Null for the original residents and for adults who moved in (unknown); set for the children of
   *  an arriving household as well as for people born in the district. */
  mother: number | null;
  father: number | null;
  /** Dwelling index they live in now. */
  residence: number;
  /** Set once they have left the family home. Adults with no parent on record (original residents, arrivals) start with
   *  it set; so do not their children, nor an original's children at home. */
  left: boolean;
  /** Moves after arriving, in order. */
  moves: { tick: number; to: number }[];
}

export interface LifeEvent {
  tick: number;
  kind: 'birth' | 'death' | 'arrival';
  dwelling: number;
  /** People involved (a household that moved in). */
  n?: number;
}

/** Deterministic float in [0, 1) from small integers; no strings, so folding thousands of weeks stays cheap. */
function roll(base: number, a: number, b: number, salt: number): number {
  let x = base ^ Math.imul(a + 0x9e3779b9, 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 15), 0x2c1b3c6d);
  x ^= Math.imul(b + 1, 0xc2b2ae35);
  x = Math.imul(x ^ (x >>> 13), 0x297a2d39);
  x ^= Math.imul(salt + 7, 0x27d4eb2f);
  x ^= x >>> 16;
  x = Math.imul(x, 0x85ebca6b);
  x ^= x >>> 13;
  return (x >>> 0) / 4294967296;
}

/** Whole years lived at `tick` (frozen at death). */
export function ageAt(p: Person, tick: number): number {
  const end = p.deathTick ?? tick;
  return Math.max(0, Math.floor((end - p.birthTick) / TICKS_PER_YEAR));
}

/** Where they lived at a given tick. */
export function residenceAt(p: Person, tick: number): number {
  let r = p.origin;
  for (const m of p.moves) {
    if (m.tick > tick) break;
    r = m.to;
  }
  return r;
}

/** Parent, child or sibling, as far as the simulation has recorded it. */
function isKin(a: Person, b: Person): boolean {
  return (
    a.mother === b.id ||
    a.father === b.id ||
    b.mother === a.id ||
    b.father === a.id ||
    (a.mother !== null && a.mother === b.mother) ||
    (a.father !== null && a.father === b.father)
  );
}

/** Could these two have a child together? An adult man up to 70, a woman from 18 to under 50, not close kin. */
function canPair(a: Person, b: Person, tick: number): boolean {
  if (a.sex === b.sex) return false;
  const f = a.sex === 'f' ? a : b;
  const m = a.sex === 'm' ? a : b;
  const fa = ageAt(f, tick);
  const ma = ageAt(m, tick);
  return fa >= ADULT && fa < FERTILE_MAX && ma >= ADULT && ma <= MALE_FERTILE_MAX && !isKin(f, m);
}

/** Weekly chance of dying at a given age, before personal frailty and the year's luck. */
function deathChance(age: number): number {
  const infant = age < 1 ? 0.03 : 0; // the first year is the riskiest of childhood
  return (0.001 + infant + 1.2e-7 * age ** 3) / 52;
}

/** Constitution, fixed for life. Fertility: about 1 in 12 are infertile, the rest 0.4-1.8x. Frailty: 0.4-1.6x. */
function fertility(base: number, id: number): number {
  const r = roll(base, 0, id, 12);
  return r < 0.08 ? 0 : 0.4 + 1.4 * ((r - 0.08) / 0.92);
}
function frailty(base: number, id: number): number {
  return 0.4 + 1.2 * roll(base, 0, id, 13);
}

/** The year's luck for the whole district: now and then an epidemic or famine year, sometimes a kind one. */
function seasonOf(base: number, week: number): { deaths: number; births: number } {
  const r = roll(base, Math.floor(week / 52), 0, 14);
  if (r < 0.008) return { deaths: 80, births: 0.2 }; // a plague year: a third or more of the district dies
  if (r < 0.06) return { deaths: 3, births: 0.7 };
  if (r > 0.9) return { deaths: 0.8, births: 1.15 };
  return { deaths: 1, births: 1 };
}

/**
 * The district's fortune, 1 normal. About a quarter of places go into decline some time in the first 700 years (the soil
 * wears out, the ore or the forest is gone): fortune halves every 25 to 85 years from then, so households stop arriving,
 * births fall, and the place fades. Not tied to a resource yet: a stand-in for the economy.
 */
function fortuneOf(base: number, week: number): number {
  if (roll(base, 0, 0, 29) >= 0.25) return 1;
  const startYear = 100 + Math.floor(roll(base, 0, 1, 29) * 600);
  const half = 25 + roll(base, 0, 2, 29) * 60;
  const years = week / 52;
  if (years <= startYear) return 1;
  // 2^-t from basic arithmetic only (exactly rounded, the same in every engine): halve per whole half-life, then a straight
  // line across the rest.
  const t = (years - startYear) / half;
  const n = Math.min(60, Math.floor(t));
  let p = 1;
  for (let i = 0; i < n; i++) p *= 0.5;
  return p * (1 - (t - Math.floor(t)) / 2);
}

export interface SiteLifeSeed {
  path: string;
  /** `residents` is how many people live there at tick 0; who they are and how they are related comes from the model. */
  dwellings: {
    path: string;
    kind: string;
    residents: number;
    x: number;
    y: number;
    w: number;
    h: number;
    /** The week it is finished; absent or 0: standing from the start; -1: held in reserve until the town needs it. Until then nobody lives there and it does not grow. */
    built?: number;
    /** The parcel it stands on; a home grows only inside it. Absent: no bound. */
    plot?: { x: number; y: number; w: number; h: number };
  }[];
  /** The district grid (side n, one terrain code per cell), so a home can find free ground to grow into. */
  grid: { n: number; cells: Uint8Array };
}

export interface Cell {
  x: number;
  y: number;
}

export class SiteLife {
  /** Last week that has been simulated. */
  week = 0;
  /** Everyone who has ever lived in the district, in id order (the dead stay, so links to them keep working). */
  readonly people: Person[] = [];
  /** People alive at tick 0. */
  readonly initial: number;
  private readonly base: number;
  private readonly kinds: string[];
  /** The people alive now, in id order. The fold walks this instead of everyone who ever lived, so a long run costs
   *  time in proportion to the living, not to the dead that pile up. */
  private alive: Person[] = [];
  /** byOrigin[d][n] = id of the person whose path is `<dwelling d>/p<n>`. */
  private readonly byOrigin: number[][];
  /** Cells each dwelling has gained beyond its rectangle (homes that stayed full), in the order they were added. */
  private readonly extra: Cell[][];
  private readonly area: number[];
  private readonly origin: { x: number; y: number; w: number; h: number }[];
  /** The week each dwelling is finished (-1: a reserve plot, given a week when homes are full and cannot grow). */
  private readonly builtWeek: number[];
  /** Buildings that fell into ruin (empty for years in a place in decline); never rebuilt. */
  private readonly ruinedWeek: number[];
  /** Reserve plots the town's need has started (not the ones scheduled at layout). */
  private readonly started: boolean[];
  /** Consecutive weeks a standing home has been empty. */
  private readonly emptyWeeks: number[];
  private readonly plot: ({ x: number; y: number; w: number; h: number } | undefined)[];
  /** 1 where any building stands. */
  private readonly occ: Uint8Array;
  private readonly grid: { n: number; cells: Uint8Array };
  /** Consecutive weeks each dwelling has been full. */
  private readonly fullWeeks: number[];
  /** Homes that cannot grow any more (no free cell, or at the size cap): never tried again, since cells only fill. */
  private readonly boxedIn: boolean[];
  /** Weeks until a home that just grew fills the next notch of its outline (0: none pending). */
  private readonly finish: number[];

  constructor(seed: string, data: SiteLifeSeed) {
    this.base = hash32(`${seed}|${data.path}|life`);
    this.kinds = data.dwellings.map((d) => d.kind);
    this.byOrigin = data.dwellings.map(() => []);
    this.extra = data.dwellings.map(() => []);
    this.area = data.dwellings.map((d) => d.w * d.h);
    this.grid = data.grid;
    this.occ = new Uint8Array(data.grid.n * data.grid.n);
    this.origin = data.dwellings.map((d) => ({ x: d.x, y: d.y, w: d.w, h: d.h }));
    this.plot = data.dwellings.map((d) => d.plot);
    this.builtWeek = data.dwellings.map((d) => d.built ?? 0);
    for (const d of data.dwellings) this.paintRect(d);
    this.ruinedWeek = data.dwellings.map(() => -1);
    this.started = data.dwellings.map(() => false);
    this.emptyWeeks = data.dwellings.map(() => 0);
    this.fullWeeks = data.dwellings.map(() => 0);
    this.boxedIn = data.dwellings.map(() => false);
    this.finish = data.dwellings.map(() => 0);
    data.dwellings.forEach((d, di) => this.populate(di, d.kind, d.residents));
    this.initial = this.people.length;
  }

  /**
   * The people living in one dwelling at tick 0. Homes hold households (a couple with children, a single parent, an
   * older parent with grown children, three generations, a step-parent family, or housemates; a shop holds its keeper's
   * household); works and the hall have no one. Parents
   * are only ever people inside the same dwelling, so there are no ancestors before tick 0, and every parent was an
   * adult (and a mother under 50) when each child was born.
   */
  private populate(di: number, kind: string, n: number): void {
    if (n <= 0) return;
    const base = this.base;
    const r = (k: number) => roll(base, 0x10000 + di, k, 40);
    const between = (lo: number, hi: number, k: number) => lo + Math.floor(r(k) * (Math.max(lo, hi) - lo + 1));
    const bday = (age: number, id: number) => -(age * TICKS_PER_YEAR + Math.floor(roll(base, 0, id, 4) * TICKS_PER_YEAR));
    const mk = (age: number, sex: Sex | null, mother: number | null = null, father: number | null = null): Person => {
      const id = this.people.length;
      const birthTick = bday(age, id);
      return this.add({
        origin: di,
        sex: sex ?? (roll(base, 0, id, 3) < 0.5 ? 'f' : 'm'),
        birthTick,
        since: birthTick,
        mother,
        father,
        left: mother === null && father === null, // grown-up original residents have a home of their own
      });
    };
    const lives = kind === 'home' || kind === 'shop'; // a shop's keeper lives above it: a household like any other
    if (!lives || n === 1) {
      for (let i = 0; i < n; i++) mk(lives ? between(19, 85, 1) : between(18, 64, 2 + i), null);
      return;
    }
    // Children's ages: distinct values at least two years apart (so siblings are at least a year apart whatever their
    // birthdays), taken from lo..hi, oldest first. Twins are a live-sim thing; starting children are singletons.
    const spaced = (count: number, lo: number, hi: number): number[] => {
      const slots = Math.max(1, Math.floor((hi - lo) / 2) + 1);
      const pool = Array.from({ length: slots }, (_, i) => i);
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(r(40 + i) * (i + 1));
        [pool[i], pool[j]] = [pool[j]!, pool[i]!];
      }
      return Array.from({ length: count }, (_, i) => lo + 2 * pool[i % slots]!).sort((a, b) => b - a);
    };
    const shape = r(0);
    if (shape >= 0.9) {
      for (let i = 0; i < n; i++) mk(between(18, 60, 2 + i), null); // housemates
      return;
    }
    if (shape >= 0.75 && shape < 0.8 && n >= 4) {
      // Three generations: a grandmother or grandfather, their grown daughter, and her children (father not at home).
      const gAge = between(62, 88, 20);
      const g = mk(gAge, r(21) < 0.75 ? 'f' : 'm');
      const midAge = between(Math.max(ADULT + 3 + 2 * (n - 2), gAge - 48), Math.min(gAge - ADULT - 1, 55), 22);
      const mid = mk(midAge, 'f', g.sex === 'f' ? g.id : null, g.sex === 'm' ? g.id : null);
      mid.left = false;
      const lo = Math.max(0, midAge - 48);
      const hi = Math.max(lo, Math.min(midAge - ADULT - 1, 40));
      let youngest = -Infinity;
      for (const age of spaced(n - 2, lo, hi)) youngest = Math.max(youngest, mk(age, null, mid.id, null).birthTick);
      mid.restUntil = youngest + 52 * TICKS_PER_WEEK;
      return;
    }
    // Parents' ages, then the children's ages inside the window where both were adults at the birth and the mother
    // under 50 (a year's margin each side, since ages are whole years and birthdays are spread through the year).
    const couple = shape < 0.7 && n >= 2;
    const kids = n - (couple ? 2 : 1);
    const kidWindow = (momAge: number, dadAge: number | null): [number, number] => [
      Math.max(0, momAge - 48),
      Math.min(momAge - ADULT - 1, dadAge === null ? Infinity : dadAge - ADULT - 1, 40),
    ];
    let momAge = between(20, 60, 3);
    let lo = 0;
    let hi = 0;
    if (kids > 0) {
      // Older mothers for more children, so they fit (two years apart at the least).
      momAge = Math.max(momAge, ADULT + 3 + 2 * kids);
    }
    const dadAge = couple ? Math.max(ADULT + 1, momAge + between(0, 14, 4) - 4) : null;
    [lo, hi] = kidWindow(momAge, dadAge);
    if (hi < lo) lo = hi = Math.max(0, hi);
    // One parent on their own: an older man or woman, or (less often) a father. A grown child can be well along.
    const lone = !couple;
    let parent: Person;
    let other: Person | null = null;
    if (lone) {
      const soloAge = kids > 0 ? between(momAge, 85, 5) : between(19, 85, 5);
      const sex: Sex = r(6) < 0.75 ? 'f' : 'm';
      parent = mk(soloAge, sex);
      [lo, hi] = sex === 'f' ? kidWindow(soloAge, null) : [Math.max(0, soloAge - 69), Math.min(soloAge - ADULT - 1, 45)];
      if (hi < lo) lo = hi = Math.max(0, hi);
      momAge = soloAge;
    } else {
      parent = mk(momAge, 'f');
      other = mk(dadAge!, 'm');
    }
    // A step-parent: the partner is not the children's father.
    const step = couple && kids > 0 && r(7) < 0.2;
    let youngest = -Infinity;
    for (const age of spaced(kids, lo, hi)) {
      const mother: number | null = parent.sex === 'f' ? parent.id : null;
      let father: number | null = parent.sex === 'm' ? parent.id : other ? other.id : null;
      if (step) father = null;
      const kid = mk(age, null, mother, father);
      youngest = Math.max(youngest, kid.birthTick);
    }
    if (kids > 0 && parent.sex === 'f') parent.restUntil = youngest + 52 * TICKS_PER_WEEK;
  }

  private add(p: Pick<Person, 'origin' | 'sex' | 'birthTick' | 'since' | 'mother' | 'father' | 'left'>): Person {
    const list = this.byOrigin[p.origin]!;
    const person: Person = {
      ...p,
      id: this.people.length,
      local: list.length,
      deathTick: null,
      restUntil: -Infinity,
      residence: p.origin,
      moves: [],
    };
    this.people.push(person);
    this.alive.push(person);
    list.push(person.id);
    return person;
  }

  /** Cells a home has grown into beyond its original rectangle. */
  extension(dwelling: number): readonly Cell[] {
    return this.extra[dwelling]!;
  }

  /** The district's cells as laid out (footpaths of buildings finished later included). */
  get layoutCells(): Uint8Array {
    return this.grid.cells;
  }

  /** The week a dwelling is finished now: -1 while it is a reserve nobody has started. */
  builtWeekOf(dwelling: number): number {
    return this.builtWeek[dwelling]!;
  }

  /** How many dwellings stood at the given week (history: reserve plots count from the week they were finished). */
  standingAt(week: number): number {
    let n = 0;
    for (let d = 0; d < this.builtWeek.length; d++) {
      const w = this.builtWeek[d]!;
      if (w >= 0 && w <= week && !(this.ruinedWeek[d]! >= 0 && this.ruinedWeek[d]! <= week)) n++;
    }
    return n;
  }

  /** Whether a dwelling stands at the given week. */
  isBuilt(dwelling: number, week: number = this.week): boolean {
    const w = this.builtWeek[dwelling]!;
    return w >= 0 && w <= week && this.ruinedWeek[dwelling]! < 0; // -1: held in reserve until the town needs it
  }

  /** People a dwelling holds at most right now; none for works and the hall. */
  capacity(dwelling: number): number {
    const k = this.kinds[dwelling];
    if (k !== 'home' && k !== 'shop') return 0;
    return capacityOf(this.area[dwelling]!);
  }

  private paintRect(r: { x: number; y: number; w: number; h: number }): void {
    const n = this.grid.n;
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) this.occ[y * n + x] = 1;
  }

  /** Whether a cell has another building on any of its eight neighbors (buildings never join). */
  private touchesOther(key: number, mine: Set<number>): boolean {
    const n = this.grid.n;
    const x = key % n;
    const y = Math.floor(key / n);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
        const k = ny * n + nx;
        if (this.occ[k] && !mine.has(k)) return true;
      }
    }
    return false;
  }

  /**
   * Add one cell to a home (a full one, or with `notchOnly` one finishing its outline): a free ground or garden cell that touches it on a side and no other building at all.
   * The shape stays compact: a cell that would close an open cell in on three sides (by this home or any other building)
   * is never taken, and the rest are ranked: a cell inside the home's bounding box (a notch) first, otherwise the one that
   * leaves the box most square, then least widened, then most sides touched. One of the best is rolled from (week, dwelling). Homes are
   * processed in index order, so the earlier one wins a cell both want. Returns whether it grew.
   */
  private expand(d: number, week: number, notchOnly = false): boolean {
    if (this.area[d]! >= MAX_HOME_AREA) return false;
    const n = this.grid.n;
    const own = this.origin[d]!;
    const mine = new Set<number>();
    for (let y = own.y; y < own.y + own.h; y++) for (let x = own.x; x < own.x + own.w; x++) mine.add(y * n + x);
    for (const c of this.extra[d]!) mine.add(c.y * n + c.x);
    const pl = this.plot[d];
    const cand = new Set<number>();
    for (const k of mine) {
      const x = k % n;
      const y = Math.floor(k / n);
      for (const [nx, ny] of [[x, y - 1], [x - 1, y], [x + 1, y], [x, y + 1]] as const) {
        if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
        const nk = ny * n + nx;
        if (pl && (nx < pl.x || ny < pl.y || nx >= pl.x + pl.w || ny >= pl.y + pl.h)) continue; // never past its plot
        if (!mine.has(nk) && !this.occ[nk] && FREE_CELLS.includes(this.grid.cells[nk]!) && !this.touchesOther(nk, mine)) cand.add(nk);
      }
    }
    const around = (k: number): number[] => {
      const x = k % n;
      const y = Math.floor(k / n);
      const out: number[] = [];
      for (const [nx, ny] of [[x, y - 1], [x - 1, y], [x + 1, y], [x, y + 1]] as const) {
        if (nx >= 0 && ny >= 0 && nx < n && ny < n) out.push(ny * n + nx);
      }
      return out;
    };
    // The bounding box of the home as it stands; a candidate is scored by how much it widens the box (not at all: it fills
    // a notch), how square the box stays, and how many sides it touches.
    let x0 = n;
    let y0 = n;
    let x1 = -1;
    let y1 = -1;
    for (const k of mine) {
      x0 = Math.min(x0, k % n);
      x1 = Math.max(x1, k % n);
      y0 = Math.min(y0, Math.floor(k / n));
      y1 = Math.max(y1, Math.floor(k / n));
    }
    const ranked: { k: number; g: number; s: number; a: number }[] = [];
    for (const k of [...cand].sort((p, q) => p - q)) {
      // A pocket is an open cell this one would close in on three sides, by the home itself or by any other building.
      let pocket = false;
      for (const f of around(k)) {
        if (mine.has(f) || this.occ[f]) continue;
        if (around(f).filter((q) => q === k || mine.has(q) || this.occ[q]).length >= 3) pocket = true;
      }
      if (pocket) continue;
      const x = k % n;
      const y = Math.floor(k / n);
      const w = Math.max(x1, x) - Math.min(x0, x) + 1;
      const h = Math.max(y1, y) - Math.min(y0, y) + 1;
      ranked.push({
        k,
        g: w * h - (x1 - x0 + 1) * (y1 - y0 + 1),
        s: around(k).filter((q) => mine.has(q)).length,
        a: Math.max(w, h) / Math.min(w, h),
      });
    }
    if (notchOnly) {
      for (let i = ranked.length - 1; i >= 0; i--) if (ranked[i]!.g > 0) ranked.splice(i, 1);
    }
    if (ranked.length === 0) return false;
    // A cell inside the box (a notch) first; otherwise the one that leaves the box most square, then the one that widens it
    // least, then the one touching most sides.
    const order = (p: (typeof ranked)[number], q: (typeof ranked)[number]) =>
      Number(p.g > 0) - Number(q.g > 0) || p.a - q.a || p.g - q.g || q.s - p.s || p.k - q.k;
    ranked.sort(order);
    const top = ranked[0]!;
    const list = ranked.filter((r) => r.g === top.g && r.s === top.s && r.a === top.a).map((r) => r.k);
    const pick = list[Math.floor(roll(this.base, week, d, notchOnly ? 26 : 25) * list.length)]!;
    this.extra[d]!.push({ x: pick % n, y: Math.floor(pick / n) });
    this.occ[pick] = 1;
    this.area[d]!++;
    this.finish[d] = FINISH_EVERY_WEEKS;
    return true;
  }

  person(dwelling: number, local: number): Person | undefined {
    const id = this.byOrigin[dwelling]?.[local];
    return id === undefined ? undefined : this.people[id];
  }

  /** Living people whose home is this dwelling right now. */
  residents(dwelling: number): Person[] {
    return this.alive.filter((p) => p.residence === dwelling);
  }

  /** Fold forward to `week` (no-op if already there). Weeks only ever move forward. */
  advanceTo(week: number, onEvent?: (e: LifeEvent) => void): void {
    for (let w = this.week + 1; w <= week; w++) this.step(w, onEvent);
    if (week > this.week) this.week = week;
  }

  /** Simulate the week that ends at tick week * TICKS_PER_WEEK. */
  private step(week: number, onEvent?: (e: LifeEvent) => void): void {
    const tick = week * TICKS_PER_WEEK;
    const base = this.base;
    const emit = (kind: LifeEvent['kind'], dwelling: number, n?: number) => onEvent?.({ tick, kind, dwelling, n });
    const season = seasonOf(base, week);
    // Crowding: a district that has outgrown its starting population births and receives fewer; one that has shrunk,
    // more. Keeps long runs from running away to the building cap or dying out.
    const fortune = fortuneOf(base, week);
    const crowd = Math.max(0.2, Math.min(1.3, 1 + (this.initial - this.living) / Math.max(1, this.initial))) * fortune;

    // Deaths.
    const home: Person[][] = this.kinds.map(() => []);
    for (const p of this.alive) {
      if (roll(base, week, p.id, 1) < deathChance(ageAt(p, tick)) * frailty(base, p.id) * season.deaths * (2 - fortune)) {
        p.deathTick = tick;
        emit('death', p.residence);
      } else {
        home[p.residence]!.push(p);
      }
    }
    this.alive = this.alive.filter((p) => p.deathTick === null);

    // Living children under 18 that a person has in a given household; a parent does not walk out on them.
    const dependents = (p: Person, group: Person[]) =>
      group.some((c) => (c.mother === p.id || c.father === p.id) && ageAt(c, tick) < ADULT);

    // Young adults leave the family home, preferring a household with someone they could pair with.
    for (const p of this.alive) {
      if (p.left) continue;
      const age = ageAt(p, tick);
      if (age < LEAVE_MIN || age > LEAVE_MAX) continue;
      const here = home[p.residence]!;
      if (dependents(p, here)) continue;
      const withParent = here.some((q) => q.id === p.mother || q.id === p.father);
      const crowded = p.mother === null && here.length >= 3; // no mother on record (a lone father's children): leave a crowded home
      if (!withParent && !crowded) continue;
      const full = here.length >= this.capacity(p.residence);
      if (roll(base, week, p.id, 10) >= LEAVE_PER_WEEK * (full ? CROWDED_LEAVE : 1)) continue;
      // A couple founds a household: they take a vacant home together.
      const vacantNow: number[] = [];
      home.forEach((g, d) => {
        if (this.kinds[d] === 'home' && this.isBuilt(d, week) && g.length === 0) vacantNow.push(d);
      });
      if (vacantNow.length > 0 && roll(base, week, p.id, 30) < FOUND_HOUSEHOLD) {
        const peers = this.alive.filter(
          (q) =>
            !q.left &&
            q.id !== p.id &&
            ageAt(q, tick) >= ADULT &&
            ageAt(q, tick) <= FOUND_MAX_AGE &&
            canPair(p, q, tick) &&
            !dependents(q, home[q.residence]!),
        );
        if (peers.length > 0) {
          const q = peers[Math.floor(roll(base, week, p.id, 31) * peers.length)]!;
          const dest = vacantNow[Math.floor(roll(base, week, p.id, 32) * vacantNow.length)]!;
          for (const m of [p, q]) {
            home[m.residence] = home[m.residence]!.filter((x) => x.id !== m.id);
            home[dest]!.push(m);
            m.residence = dest;
            m.left = true;
            m.moves.push({ tick, to: dest });
          }
          continue;
        }
      }
      const open: number[] = [];
      home.forEach((g, d) => {
        if (d !== p.residence && this.kinds[d] === 'home' && this.isBuilt(d, week) && g.length < this.capacity(d)) open.push(d);
      });
      if (open.length === 0) continue;
      const matches = open.filter((d) => home[d]!.some((q) => canPair(p, q, tick)));
      const pool = matches.length > 0 && roll(base, week, p.id, 11) < PREFER_MATCH ? matches : open;
      const dest = pool[Math.floor(roll(base, week, p.id, 9) * pool.length)]!;
      home[p.residence] = here.filter((q) => q.id !== p.id);
      home[dest]!.push(p);
      p.residence = dest;
      p.left = true;
      p.moves.push({ tick, to: dest });
    }

    // Births: a woman of childbearing age and an eligible man in the same building.
    home.forEach((group, d) => {
      const men = group.filter((p) => p.sex === 'm' && ageAt(p, tick) >= ADULT && ageAt(p, tick) <= MALE_FERTILE_MAX);
      if (men.length === 0 && !group.some((p) => p.sex === 'f')) return;
      const cap = this.capacity(d);
      let count = group.length;
      for (const f of [...group]) {
        if (count >= cap) break;
        if (f.sex !== 'f') continue;
        const age = ageAt(f, tick);
        if (age < ADULT || age >= FERTILE_MAX || tick < f.restUntil) continue;
        if (roll(base, week, f.id, 2) >= BIRTH_PER_WEEK * fertility(base, f.id) * season.births * crowd) continue;
        const partners = men.filter((m) => !isKin(f, m));
        if (partners.length === 0) {
          // No eligible man in the building: sometimes a partner moves in from elsewhere.
          if (roll(base, week, f.id, 6) < MOVE_IN_PER_WEEK / BIRTH_PER_WEEK) {
            const years = 20 + Math.floor(roll(base, week, f.id, 7) * 20);
            const born = tick - years * TICKS_PER_YEAR - Math.floor(roll(base, week, f.id, 8) * TICKS_PER_YEAR);
            const man = this.add({ origin: d, sex: 'm', birthTick: born, since: tick, mother: null, father: null, left: true });
            men.push(man);
            group.push(man);
            count++;
            emit('arrival', d);
          }
          continue;
        }
        const father = partners[Math.floor(roll(base, week, f.id, 5) * partners.length)]!;
        // Spacing varies from about 9 to 25 months before she can conceive again.
        f.restUntil = tick + (40 + Math.floor(roll(base, week, f.id, 15) * 65)) * TICKS_PER_WEEK;
        const babies = roll(base, week, f.id, 16) < TWINS && count + 1 < cap ? 2 : 1;
        for (let k = 0; k < babies; k++) {
          const baby = this.add({
            origin: d,
            sex: roll(base, week, this.people.length, 3) < 0.5 ? 'f' : 'm',
            birthTick: tick,
            since: tick,
            mother: f.id,
            father: father.id,
            left: false,
          });
          group.push(baby);
          count++;
          emit('birth', d);
        }
      }
    });

    // A home that has stayed full extends into free ground beside it, and one that has grown finishes the notches of its outline.
    home.forEach((g, d) => {
      if (this.kinds[d] !== 'home' || !this.isBuilt(d, week)) return;
      // One cell a week at most: a home that finished a notch this week does not also take a full-home cell.
      if (this.finish[d]! > 0 && --this.finish[d]! === 0 && this.expand(d, week, true)) return;
      if (g.length < this.capacity(d)) this.fullWeeks[d] = 0;
      else if (!this.boxedIn[d] && ++this.fullWeeks[d]! >= EXPAND_AFTER_WEEKS) {
        if (this.expand(d, week)) this.fullWeeks[d] = 0;
        else this.boxedIn[d] = true;
      }
    });

    // Need: when homes that are full and cannot grow any more outnumber what is being built, a reserve plot is started (a home
    // first, nearest the center first) and finished some weeks on.
    let pressed = 0;
    let underway = 0;
    home.forEach((g, d) => {
      if (this.started[d] && this.builtWeek[d]! > week) underway++;
      else if (this.kinds[d] === 'home' && this.boxedIn[d] && g.length >= this.capacity(d)) pressed++;
    });
    if (pressed > underway && roll(base, week, 0, 24) < pressed * BUILD_PER_PRESSED_WEEK) {
      let pick = -1;
      for (let d = 0; d < this.builtWeek.length && pick < 0; d++) if (this.builtWeek[d] === -1 && this.kinds[d] === 'home') pick = d;
      for (let d = 0; d < this.builtWeek.length && pick < 0; d++) if (this.builtWeek[d] === -1) pick = d;
      if (pick >= 0) this.builtWeek[pick] = week + 20 + Math.floor(roll(base, week, 1, 27) * 32);
      if (pick >= 0) this.started[pick] = true;
    }

    // A home finished this week is built because someone needs it: a household arrives with it.
    home.forEach((g, d) => {
      if ((this.kinds[d] !== 'home' && this.kinds[d] !== 'shop') || this.builtWeek[d] !== week || g.length > 0) return; // a shop gets its keeper's household
      this.arrive(d, week, tick, emit);
      home[d] = this.alive.filter((p) => p.residence === d);
    });

    // A place in decline: homes that stay empty for years fall into ruin, and when it is nearly gone so do the workplaces.
    home.forEach((g, d) => {
      if (!this.isBuilt(d, week) || this.kinds[d] === 'hall') return;
      if (this.kinds[d] === 'home') this.emptyWeeks[d] = g.length === 0 ? this.emptyWeeks[d]! + 1 : 0;
      const gone = this.kinds[d] === 'home' ? this.emptyWeeks[d]! > 52 * 8 && fortune < 0.5 : g.length === 0 && fortune < 0.15;
      if (gone && roll(base, week, d, 28) < 1 / (52 * 4)) this.ruinedWeek[d] = week;
    });

    // Households arriving from outside into vacant homes. The more homes stand empty, the likelier one fills.
    const vacant: number[] = [];
    home.forEach((g, d) => {
      if (this.kinds[d] === 'home' && this.isBuilt(d, week) && g.length === 0) vacant.push(d);
    });
    if (vacant.length > 0 && roll(base, week, 0, 20) < vacant.length * HOUSEHOLD_PER_VACANT_WEEK * crowd) {
      this.arrive(vacant[Math.floor(roll(base, week, 1, 21) * vacant.length)]!, week, tick, emit);
    }
  }

  /** A household from outside: a single adult, a couple, or a couple with one to three children. */
  private arrive(d: number, week: number, tick: number, emit: (kind: LifeEvent['kind'], dwelling: number, n?: number) => void): void {
    const base = this.base;
    const r = (k: number) => roll(base, week, d * 16 + k, 22);
    // One tick earlier than 'now' at the very least, so an arriving infant is never mistaken for a birth here.
    const born = (age: number, k: number) =>
      tick - 1 - age * TICKS_PER_YEAR - Math.floor(roll(base, week, d * 16 + k, 23) * TICKS_PER_YEAR);
    const kind = r(0);
    const mk = (sex: Sex, age: number, k: number, parents?: [number, number]) =>
      this.add({
        origin: d,
        sex,
        birthTick: born(age, k),
        since: tick,
        mother: parents ? parents[0] : null,
        father: parents ? parents[1] : null,
        left: !parents, // an arriving adult has left their parents' home; their children have not
      });
    let size = 1;
    if (kind < 0.25) {
      mk(r(1) < 0.5 ? 'f' : 'm', 20 + Math.floor(r(2) * 40), 1);
    } else {
      const momAge = 20 + Math.floor(r(3) * 30);
      const dadAge = 20 + Math.floor(r(4) * 35);
      const mom = mk('f', momAge, 2);
      const dad = mk('m', dadAge, 3);
      size = 2;
      if (kind >= 0.6) {
        // Children are never older than their parents' age minus ADULT, so both were adults at the birth.
        const kidMax = Math.min(14, momAge - ADULT - 1, dadAge - ADULT - 1); // -1: birthdays are spread through the year
        const kids = Math.min(1 + Math.floor(r(5) * 3), Math.max(0, this.capacity(d) - 2)); // what fits
        let youngest = -Infinity;
        for (let i = 0; i < kids; i++) {
          const kid = mk(r(6 + i) < 0.5 ? 'f' : 'm', Math.floor(r(9 + i) * (kidMax + 1)), 4 + i, [mom.id, dad.id]);
          youngest = Math.max(youngest, kid.birthTick);
          size++;
        }
        mom.restUntil = youngest + 52 * TICKS_PER_WEEK; // not fertile again straight away after the youngest
      }
    }
    emit('arrival', d, size);
  }

  get living(): number {
    return this.alive.length;
  }

  /** Births and deaths since tick 0. */
  get totals(): { births: number; deaths: number } {
    let births = 0;
    let deaths = 0;
    for (const p of this.people) {
      // Born here: not the starting children (born before tick 0) nor the children of an arriving household.
      if (p.mother !== null && p.birthTick === p.since && p.since > 0) births++;
      if (p.deathTick !== null) deaths++;
    }
    return { births, deaths };
  }

  /** Births plus arrivals minus deaths so far in the simulated district. */
  get net(): number {
    return this.living - this.initial;
  }
}

export interface SeriesPoint {
  t: number;
  v: number;
}

/**
 * How many people were alive over time, for the whole district or the residents of one dwelling. Rebuilt from
 * birth, death and move ticks, so history is available however late you look. Empty until a week has run.
 */
export function livingSeries(life: SiteLife, dwelling: number | null, offset = 0, points = 96): SeriesPoint[] {
  const count = (week: number): number => {
    const t = week * TICKS_PER_WEEK;
    let v = 0;
    for (const p of life.people) {
      if (p.since > t || (p.deathTick !== null && p.deathTick <= t)) continue;
      if (dwelling === null || residenceAt(p, t) === dwelling) v++;
    }
    return v + offset;
  };
  return sampleSeries(life.week, count, points);
}

/** A district measure over time: standing dwellings, or births and deaths per year (the rate over each stretch). */
export function districtSeries(life: SiteLife, kind: 'dwellings' | 'births' | 'deaths', points = 96): SeriesPoint[] {
  const count = (week: number): number => {
    const t = week * TICKS_PER_WEEK;
    if (kind === 'dwellings') return life.standingAt(week);
    let n = 0;
    for (const p of life.people) {
      if (kind === 'births' ? p.mother !== null && p.since > 0 && p.birthTick === p.since && p.birthTick <= t : p.deathTick !== null && p.deathTick <= t) n++;
    }
    return n;
  };
  return kind === 'dwellings' ? sampleSeries(life.week, count, points) : rateSeries(life.week, count, points);
}

/** A running total turned into a rate: events per year over each stretch of a fixed grid, at least 4 weeks long so one event is not scaled into a spike (a final stretch under 4 weeks is left out). */
function rateSeries(W: number, total: (week: number) => number, points: number): SeriesPoint[] {
  if (W < 1) return [];
  const n = Math.max(2, Math.floor(points));
  let step = 4;
  while (step * (n - 1) < W) step *= 2;
  const out: SeriesPoint[] = [];
  let from = 0;
  let was = total(0);
  for (let end = step; ; end += step) {
    const to = Math.min(end, W);
    if (to - from >= 4 || (to - from > 0 && out.length === 0)) {
      const now = total(to);
      out.push({ t: to * TICKS_PER_WEEK, v: Math.round(((now - was) * 520) / (to - from)) / 10 });
      was = now;
      from = to;
    }
    if (to >= W) break;
  }
  return out;
}

/** Samples `count(week)` on the fixed grid described below. Empty until a week has run. */
function sampleSeries(W: number, count: (week: number) => number, points: number): SeriesPoint[] {
  if (W < 1) return [];
  // Points sit on a fixed grid (a power-of-two number of weeks apart) and each one is the average headcount over the
  // bucket it closes, so a finished stretch of the line does not change as time advances (until the spacing doubles,
  // when the whole line is resampled once): a one-week dip does not flicker in and out of the sampling. The first and
  // last points are exact, so the ends match the live headcount.
  const n = Math.max(2, Math.floor(points));
  let step = 1;
  while (step * (n - 1) < W) step *= 2;
  const out: SeriesPoint[] = [{ t: 0, v: count(0) }];
  for (let k = 1; k * step < W; k++) {
    const samples = Math.min(4, step);
    let sum = 0;
    for (let q = 0; q < samples; q++) sum += count((k - 1) * step + 1 + Math.floor((q * step) / samples));
    out.push({ t: k * step * TICKS_PER_WEEK, v: Math.round(sum / samples) });
  }
  out.push({ t: W * TICKS_PER_WEEK, v: count(W) });
  return out;
}

/**
 * The cells with the footpath of each building that is finished later: laid down once it stands, otherwise put back to what
 * the cell was (a path is carved at layout for buildings not standing yet). Always starts from layout cells, never a view's.
 */
export function visibleCells(cells: Uint8Array, dwellings: { built: boolean; track?: number[] }[]): Uint8Array {
  let out = cells;
  for (const d of dwellings) {
    if (d.built || !d.track) continue;
    if (out === cells) out = cells.slice();
    for (const e of d.track) out[e >> 3] = e & 7;
  }
  return out;
}

/** The district view with live headcounts and footprints (homes grow). The settlement's population is the people living now. */
export function applyLife(view: SiteView, life: SiteLife): SiteView {
  const counts = new Array<number>(view.dwellings.length).fill(0);
  for (const p of life.people) if (p.deathTick === null) counts[p.residence]!++;
  const dwellings = view.dwellings.map((d, i) => ({ ...d, extra: [...life.extension(i)], capacity: life.capacity(i), built: life.isBuilt(i), builtWeek: life.builtWeekOf(i), residents: counts[i] ?? d.residents }));
  return { ...view, population: life.living, cells: visibleCells(life.layoutCells, dwellings), dwellings };
}
