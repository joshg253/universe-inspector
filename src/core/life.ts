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
  if (r < 0.06) return { deaths: 3, births: 0.7 };
  if (r > 0.9) return { deaths: 0.8, births: 1.15 };
  return { deaths: 1, births: 1 };
}

export interface SiteLifeSeed {
  path: string;
  /** `residents` is how many people live there at tick 0; who they are and how they are related comes from the model. */
  dwellings: { path: string; kind: string; residents: number; x: number; y: number; w: number; h: number }[];
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
  /** 1 where any building stands. */
  private readonly occ: Uint8Array;
  private readonly grid: { n: number; cells: Uint8Array };
  /** Consecutive weeks each dwelling has been full. */
  private readonly fullWeeks: number[];
  /** Homes that cannot grow any more (no free cell, or at the size cap): never tried again, since cells only fill. */
  private readonly boxedIn: boolean[];

  constructor(seed: string, data: SiteLifeSeed) {
    this.base = hash32(`${seed}|${data.path}|life`);
    this.kinds = data.dwellings.map((d) => d.kind);
    this.byOrigin = data.dwellings.map(() => []);
    this.extra = data.dwellings.map(() => []);
    this.area = data.dwellings.map((d) => d.w * d.h);
    this.grid = data.grid;
    this.occ = new Uint8Array(data.grid.n * data.grid.n);
    this.origin = data.dwellings.map((d) => ({ x: d.x, y: d.y, w: d.w, h: d.h }));
    for (const d of data.dwellings) this.paintRect(d);
    this.fullWeeks = data.dwellings.map(() => 0);
    this.boxedIn = data.dwellings.map(() => false);
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
   * Add one cell to a full home: a free ground or garden cell that touches it on a side and no other building at all. The candidates are listed in
   * a fixed scan order and one is rolled from (week, dwelling). Homes are processed in index order, so the earlier
   * one wins a cell both want. Returns whether it grew.
   */
  private expand(d: number, week: number): boolean {
    if (this.area[d]! >= MAX_HOME_AREA) return false;
    const n = this.grid.n;
    const own = this.origin[d]!;
    const mine = new Set<number>();
    for (let y = own.y; y < own.y + own.h; y++) for (let x = own.x; x < own.x + own.w; x++) mine.add(y * n + x);
    for (const c of this.extra[d]!) mine.add(c.y * n + c.x);
    const cand = new Set<number>();
    for (const k of mine) {
      const x = k % n;
      const y = Math.floor(k / n);
      for (const [nx, ny] of [[x, y - 1], [x - 1, y], [x + 1, y], [x, y + 1]] as const) {
        if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
        const nk = ny * n + nx;
        if (!mine.has(nk) && !this.occ[nk] && FREE_CELLS.includes(this.grid.cells[nk]!) && !this.touchesOther(nk, mine)) cand.add(nk);
      }
    }
    if (cand.size === 0) return false;
    const list = [...cand].sort((a, b) => a - b);
    const pick = list[Math.floor(roll(this.base, week, d, 25) * list.length)]!;
    this.extra[d]!.push({ x: pick % n, y: Math.floor(pick / n) });
    this.occ[pick] = 1;
    this.area[d]!++;
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
    const crowd = Math.max(0.2, Math.min(1.3, 1 + (this.initial - this.living) / Math.max(1, this.initial)));

    // Deaths.
    const home: Person[][] = this.kinds.map(() => []);
    for (const p of this.alive) {
      if (roll(base, week, p.id, 1) < deathChance(ageAt(p, tick)) * frailty(base, p.id) * season.deaths) {
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
        if (this.kinds[d] === 'home' && g.length === 0) vacantNow.push(d);
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
        if (d !== p.residence && this.kinds[d] === 'home' && g.length < this.capacity(d)) open.push(d);
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

    // A home that has stayed full extends into free ground beside it.
    home.forEach((g, d) => {
      if (this.kinds[d] !== 'home') return;
      if (g.length < this.capacity(d)) this.fullWeeks[d] = 0;
      else if (!this.boxedIn[d] && ++this.fullWeeks[d]! >= EXPAND_AFTER_WEEKS) {
        if (this.expand(d, week)) this.fullWeeks[d] = 0;
        else this.boxedIn[d] = true;
      }
    });

    // Households arriving from outside into vacant homes. The more homes stand empty, the likelier one fills.
    const vacant: number[] = [];
    home.forEach((g, d) => {
      if (this.kinds[d] === 'home' && g.length === 0) vacant.push(d);
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
  const W = life.week;
  if (W < 1) return [];
  const count = (week: number): number => {
    const t = week * TICKS_PER_WEEK;
    let v = 0;
    for (const p of life.people) {
      if (p.since > t || (p.deathTick !== null && p.deathTick <= t)) continue;
      if (dwelling === null || residenceAt(p, t) === dwelling) v++;
    }
    return v + offset;
  };
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

/** The district view with live headcounts and footprints (homes grow). The settlement's summary population moves by the district's net change. */
export function applyLife(view: SiteView, life: SiteLife): SiteView {
  const counts = new Array<number>(view.dwellings.length).fill(0);
  for (const p of life.people) if (p.deathTick === null) counts[p.residence]!++;
  return {
    ...view,
    population: Math.max(0, view.population + life.net),
    dwellings: view.dwellings.map((d, i) => ({ ...d, extra: [...life.extension(i)], capacity: life.capacity(i), residents: counts[i] ?? d.residents })),
  };
}
