// Births, deaths, aging and moving house inside one settlement district.
//
// A pure function of (seed, site, week): the same world comes out no matter when or in what order you look at
// it. Looking at a district folds the weeks it has missed (fast-forward); watching it advances one week at a
// time and reports what happened. Nothing here is stored.
//
// People keep one identity for life: their path is `<dwelling they started in>/p<n>`. Where they live now is a
// separate fact (`residence`), so moving house never changes who they are or breaks a link to them.
import { hash32 } from './rng';
import type { SiteView } from './types';

export const TICKS_PER_YEAR = 8760; // 1 tick = 1 hour
export const TICKS_PER_WEEK = 168;

const ADULT = 18;
const FERTILE_MAX = 50; // women: no births from this age on
const MALE_FERTILE_MAX = 70;
const MAX_OCCUPANTS = 10;
const BIRTH_PER_WEEK = 0.12 / 52; // per fertile woman (before her own fertility) living with an eligible man; tuned so districts stay roughly level
const TWINS = 0.02;
/** Chance per week that a partner moves in from elsewhere when a fertile woman has no eligible man in the building. */
const MOVE_IN_PER_WEEK = 0.3 / 52;
const LEAVE_MIN = 18;
const LEAVE_MAX = 30;
const LEAVE_PER_WEEK = 0.5 / 52; // a young adult still at home moves out
const PREFER_MATCH = 0.8; // chance they pick a household with someone they could pair with

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
  /** Parents' ids. Null for the original residents and for people who moved in (unknown). */
  mother: number | null;
  father: number | null;
  /** Dwelling index they live in now. */
  residence: number;
  /** Set once they have left the family home (or arrived from outside). */
  left: boolean;
  /** Moves after arriving, in order. */
  moves: { tick: number; to: number }[];
}

export interface LifeEvent {
  tick: number;
  kind: 'birth' | 'death' | 'arrival';
  dwelling: number;
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
  dwellings: { path: string; kind: string; ages: number[] }[];
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
  /** byOrigin[d][n] = id of the person whose path is `<dwelling d>/p<n>`. */
  private readonly byOrigin: number[][];

  constructor(seed: string, data: SiteLifeSeed) {
    this.base = hash32(`${seed}|${data.path}|life`);
    this.kinds = data.dwellings.map((d) => d.kind);
    this.byOrigin = data.dwellings.map(() => []);
    data.dwellings.forEach((d, di) => {
      d.ages.forEach((age) => {
        const id = this.people.length;
        // Spread birthdays through the year so everyone does not age on the same tick.
        const birthTick = -(age * TICKS_PER_YEAR + Math.floor(roll(this.base, 0, id, 4) * TICKS_PER_YEAR));
        this.add({
          origin: di,
          sex: roll(this.base, 0, id, 3) < 0.5 ? 'f' : 'm',
          birthTick,
          since: birthTick,
          mother: null,
          father: null,
          left: false,
        });
      });
    });
    this.initial = this.people.length;
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
    list.push(person.id);
    return person;
  }

  person(dwelling: number, local: number): Person | undefined {
    const id = this.byOrigin[dwelling]?.[local];
    return id === undefined ? undefined : this.people[id];
  }

  /** Living people whose home is this dwelling right now. */
  residents(dwelling: number): Person[] {
    return this.people.filter((p) => p.deathTick === null && p.residence === dwelling);
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
    const emit = (kind: LifeEvent['kind'], dwelling: number) => onEvent?.({ tick, kind, dwelling });
    const season = seasonOf(base, week);

    // Deaths.
    const home: Person[][] = this.kinds.map(() => []);
    for (const p of this.people) {
      if (p.deathTick !== null) continue;
      if (roll(base, week, p.id, 1) < deathChance(ageAt(p, tick)) * frailty(base, p.id) * season.deaths) {
        p.deathTick = tick;
        emit('death', p.residence);
      } else {
        home[p.residence]!.push(p);
      }
    }

    // Young adults leave the family home, preferring a household with someone they could pair with.
    for (const p of this.people) {
      if (p.deathTick !== null || p.left) continue;
      const age = ageAt(p, tick);
      if (age < LEAVE_MIN || age > LEAVE_MAX) continue;
      const here = home[p.residence]!;
      const withParent = here.some((q) => q.id === p.mother || q.id === p.father);
      const crowded = p.mother === null && here.length >= 3; // original residents: no parents on record
      if (!withParent && !crowded) continue;
      if (roll(base, week, p.id, 10) >= LEAVE_PER_WEEK) continue;
      const open: number[] = [];
      home.forEach((g, d) => {
        if (d !== p.residence && this.kinds[d] === 'home' && g.length < MAX_OCCUPANTS) open.push(d);
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
      let count = group.length;
      for (const f of [...group]) {
        if (count >= MAX_OCCUPANTS) break;
        if (f.sex !== 'f') continue;
        const age = ageAt(f, tick);
        if (age < ADULT || age >= FERTILE_MAX || tick < f.restUntil) continue;
        if (roll(base, week, f.id, 2) >= BIRTH_PER_WEEK * fertility(base, f.id) * season.births) continue;
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
        const babies = roll(base, week, f.id, 16) < TWINS && count + 1 < MAX_OCCUPANTS ? 2 : 1;
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
  }

  get living(): number {
    let n = 0;
    for (const p of this.people) if (p.deathTick === null) n++;
    return n;
  }

  /** Births and deaths since tick 0. */
  get totals(): { births: number; deaths: number } {
    let births = 0;
    let deaths = 0;
    for (const p of this.people) {
      if (p.mother !== null) births++; // newborns only: original residents and adults who moved in have no mother on record
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
  const end = life.week * TICKS_PER_WEEK;
  if (end < TICKS_PER_WEEK) return [];
  const n = Math.min(points, life.week + 1);
  const out: SeriesPoint[] = [];
  for (let i = 0; i < n; i++) {
    const t = Math.round((end * i) / (n - 1));
    let v = 0;
    for (const p of life.people) {
      if (p.since > t || (p.deathTick !== null && p.deathTick <= t)) continue;
      if (dwelling === null || residenceAt(p, t) === dwelling) v++;
    }
    out.push({ t, v: v + offset });
  }
  return out;
}

/** The district view with live headcounts. The settlement's summary population moves by the district's net change. */
export function applyLife(view: SiteView, life: SiteLife): SiteView {
  const counts = new Array<number>(view.dwellings.length).fill(0);
  for (const p of life.people) if (p.deathTick === null) counts[p.residence]!++;
  return {
    ...view,
    population: Math.max(0, view.population + life.net),
    dwellings: view.dwellings.map((d, i) => ({ ...d, residents: counts[i] ?? d.residents })),
  };
}
