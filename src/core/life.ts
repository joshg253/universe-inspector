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
import type { DwellingKind, DwellingSummary, SiteView } from './types';

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
/** A home full for this many weeks in a row takes one more cell of free ground beside it, if it is one of the few that ever grow. */
const EXPAND_AFTER_WEEKS = 52;
/** A full home that will not grow counts as pressed (the town needs another) after this many weeks. */
const PRESSED_AFTER_WEEKS = 13;
/** The share of homes that ever take a cell: building growth is rare, the rest stay as built and a full town builds more homes instead. */
const EXPAND_SHARE = 0.15;
/** A home stays compact: a cell is taken only if the home then fills at least this share of its bounding box (no L or S shapes snaking between buildings). */
const MIN_FILL = 0.75;
/** A home that took a cell finishes any notch in its outline at one cell per this many weeks, full or not. */
const FINISH_EVERY_WEEKS = 4;
/** The largest a home grows: 16 cells, where capacity reaches its cap of 10. */
const MAX_HOME_AREA = 16;
/** District grid codes a home may grow onto (CELL.ground, CELL.green in town.ts); roads, plaza and water stay. */
const FREE_CELLS = [0, 3];
/** A town appends homes only while no more than this share of its standing homes is empty. */
const EMPTY_SHARE = 0.6;
/** Least cells between the street lines laid in ground the grid gains (the gap widens with distance), and the base share of the rest that is green (in 3x3 patches). */
const STREET_GAP = 6;
const WATER = 4;
/** What a water cell costs a street joining the ring, against 1 for open ground (bridges only where nothing else reaches). */
const WATER_COST = 12;
const GREEN_PERCENT = 12;
/** The district grid grows by this many cells on every side when a growing town runs out of open ground, up to MAX_GRID (a stand-in cap). */
const GROW_STEP = 6;
export const MAX_GRID = 160;
/** A home empty this long is derelict: 10 years (stand-in; vacancies of a few years are normal in a living town). */
const DERELICT_WEEKS = 52 * 10;
/** A ruin is cleared, its ground freed, this many years after it fell: 20 to 50 (stand-in). */
const CLEAR_YEARS = [20, 30] as const;
/** A street cell with no occupied building within this many cells starts to wear (stand-in). */
const KEPT_UP_RADIUS = 4;
/** Idle years before the first wear step, per cell: 10 to 40; each further step takes half as long again (stand-in). */
const WEAR_YEARS = [10, 30] as const;
/** What a street cell becomes at each wear step (CELL codes in town.ts: road 1, plaza 2, green 3, track 5). */
const WEAR_STEPS: Record<number, number[]> = { 1: [5, 3], 2: [1, 5, 3], 5: [3] };
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
const WORK_PER_LAND = 0.05; // chance an appended building is a workplace, per point of the land's soil + timber + stone (0..9), at most WORK_MAX
const WORK_MAX = 0.35;
const HUNGRY_FARM = 0.7; // a hungry town on farmland makes its next appended building a farm this often

/** The age ladder: rungs 0..AGE_TOP, no skipping. Packs name them; core knows only the number. */
export const AGE_TOP = 5;
/** The rung both ends must have reached before a road joins two settlements of a planet (see `roadNet` in generate.ts). */
export const ROAD_AGE = 2;
/** The first rung each kind of building can be built in (absent: from the start). Buildings keep their kind, so towns are layered. */
export const UNLOCK_AGE: Record<string, number> = { mill: 1, quarry: 1, farm: 1, dock: 2, mine: 2, works: 3, warehouse: 3 };
/** A coastal settlement runs boats once its age allows a dock. */
export const SEA_AGE = UNLOCK_AGE.dock!;
/**
 * What a settlement needs standing (built, not ruined) before it leaves a rung for the next, by rung: people, shops, and
 * workplaces (a mill, quarry, farm, dock, mine, works or warehouse; `works` alone for the later rungs), and `fresh` buildings finished during the current
 * rung itself (the start rung counts what stood at tick 0), not only more from the older ages. A town that never gets them stalls there.
 */
export const AGE_NEEDS: { pop: number; shop: number; work: number; works: number; fresh: number }[] = [
  { pop: 12, shop: 1, work: 0, works: 0, fresh: 8 },
  { pop: 30, shop: 1, work: 1, works: 0, fresh: 6 },
  { pop: 70, shop: 2, work: 2, works: 0, fresh: 6 },
  { pop: 130, shop: 3, work: 3, works: 1, fresh: 8 },
  { pop: 220, shop: 4, work: 4, works: 2, fresh: 8 },
];
/** Chance per week that a workplace plot whose age has come is started. */
const WORKPLACE_PER_WEEK = 0.04;
/** People the land feeds without a farm (farmsteads, gardens, foraging), and how many each standing farm adds. Past that, farms come first. */
const FOOD_BASE = 40;
const FARM_FEEDS = 40;

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
  /** How well the surroundings feed the town, 0..1 (absent: plenty). Poor land slows births, arrivals and new building. */
  food?: number;
  /** What the land around offers, 0..3 each (absent: appended buildings are homes). Appended workplaces come from it. */
  around?: { soil: number; timber: number; stone: number };
  /** Whether the town may append dwellings and grow its grid when it runs out of plots (absent: it may not). */
  growable?: boolean;
  /** The grid's side cap when growable (absent: MAX_GRID). */
  maxGrid?: number;
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
  /** 0.55..1: how freely the district grows given its food (see `SiteLifeSeed.food`). */
  private readonly feed: number;
  private readonly around: SiteLifeSeed['around'];
  /** The rung the settlement starts at (from the seed). */
  private readonly ageStart: number;
  /** The week each rung above the start was reached, in order. */
  private readonly ageWeeks: number[] = [];
  private readonly kinds: string[];
  /** The people alive now, in id order. The fold walks this instead of everyone who ever lived, so a long run costs
   *  time in proportion to the living, not to the dead that pile up. */
  private alive: Person[] = [];
  /** byOrigin[d][n] = id of the person whose path is `<dwelling d>/p<n>`. */
  private readonly byOrigin: number[][];
  /** Cells each dwelling has gained beyond its rectangle (homes that stayed full), in the order they were added. */
  private readonly extra: Cell[][];
  /** The door and footpath of each home the town added (by dwelling index); the footpath is cells with the class each had before. */
  private readonly access = new Map<number, { door: { x: number; y: number; side: number }; track: { x: number; y: number; cls: number }[] }>();
  /** 1 where a seed plot's parcel lies (not yet cleared): appended homes keep to ground nobody holds. */
  private parcel: Uint8Array;
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
  private plot: ({ x: number; y: number; w: number; h: number } | undefined)[];
  /** 1 where any building stands. */
  private occ: Uint8Array;
  private grid: { n: number; cells: Uint8Array };
  /** Cells the grid has gained on the left and top: every coordinate in the seed is this much further in now. */
  private shiftX = 0;
  private shiftY = 0;
  private readonly growable: boolean;
  /** The week each ruin was cleared away (-1: not yet). Its ground is free again, its index stays. */
  private readonly clearedWeek: number[];
  /** Wear on the grid: 0 none, else the cell code it has become plus one. Applied over the layout's cells. */
  private worn: Uint8Array;
  /** Whole years each street cell has had no occupied building near it. */
  private idle: Uint8Array;
  private readonly maxGrid: number;
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
    this.grid = { n: data.grid.n, cells: data.grid.cells.slice() }; // a copy: the seed is shared, and streets are laid on this one
    this.growable = data.growable ?? false;
    this.maxGrid = data.maxGrid ?? MAX_GRID;
    this.around = data.around;
    this.feed = 0.55 + 0.45 * (data.food ?? 1);
    this.occ = new Uint8Array(data.grid.n * data.grid.n);
    this.origin = data.dwellings.map((d) => ({ x: d.x, y: d.y, w: d.w, h: d.h }));
    this.plot = data.dwellings.map((d) => d.plot);
    this.ageStart = Math.floor(roll(this.base, 0, 0, 50) * 2);
    // A workplace whose age has not come is a reserve plot until it does, whatever week the layout gave it.
    this.builtWeek = data.dwellings.map((d) => ((UNLOCK_AGE[d.kind] ?? 0) > this.ageStart ? -1 : d.built ?? 0));
    for (const d of data.dwellings) this.paintRect(d);
    this.ruinedWeek = data.dwellings.map(() => -1);
    this.clearedWeek = data.dwellings.map(() => -1);
    this.parcel = new Uint8Array(data.grid.n * data.grid.n);
    for (const d of data.dwellings) {
      const p = d.plot;
      if (p) for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) this.parcel[y * data.grid.n + x] = 1;
    }
    this.worn = new Uint8Array(data.grid.n * data.grid.n);
    this.idle = new Uint8Array(data.grid.n * data.grid.n);
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

  /** Wear on the streets: 0 none, else the cell code it has become plus one (see `wornCells`). */
  get wear(): Uint8Array {
    return this.worn;
  }

  /** Standing but empty for years. */
  isDerelict(dwelling: number): boolean {
    return this.isBuilt(dwelling) && this.kinds[dwelling] === 'home' && this.emptyWeeks[dwelling]! >= DERELICT_WEEKS;
  }

  /** Fallen to ruin and not yet cleared away. */
  isRuin(dwelling: number): boolean {
    return this.ruinedWeek[dwelling]! >= 0 && this.clearedWeek[dwelling]! < 0;
  }

  /** A ruin that has been cleared: nothing is drawn there and its ground is free. */
  isCleared(dwelling: number): boolean {
    return this.clearedWeek[dwelling]! >= 0;
  }

  /** Dwellings now, counting the ones appended after layout. */
  get dwellingCount(): number {
    return this.kinds.length;
  }

  /** Whether a building or its yard holds the cell (x, y), in the grid's current coordinates (see `offset`). */
  occupiedAt(x: number, y: number): boolean {
    return this.occ[y * this.grid.n + x] !== 0;
  }

  /** Side of the grid now (it only grows, up to MAX_GRID). */
  get gridSize(): number {
    return this.grid.n;
  }

  /** How far the seed's coordinates have moved right and down as the grid grew on the left and top. */
  get offset(): Cell {
    return { x: this.shiftX, y: this.shiftY };
  }

  kindOf(dwelling: number): string {
    return this.kinds[dwelling]!;
  }

  /** A dwelling's rectangle in the grid's current coordinates (see `offset`). */
  rectOf(dwelling: number): { x: number; y: number; w: number; h: number } {
    return { ...this.origin[dwelling]! };
  }

  /** The district's cells as laid out (footpaths of buildings finished later included). */
  get layoutCells(): Uint8Array {
    return this.grid.cells;
  }

  /** The settlement's age rung at a week: the start rung from the seed, one more for each rung's needs met by then. */
  ageAt(week: number): number {
    let n = 0;
    while (n < this.ageWeeks.length && this.ageWeeks[n]! <= week) n++;
    return this.ageStart + n;
  }

  /** The next rung is reached once what the current one needs is standing. */
  private advanceAge(week: number): void {
    const rung = this.ageStart + this.ageWeeks.length;
    if (rung >= AGE_TOP) return;
    const need = AGE_NEEDS[rung]!;
    let shop = 0;
    let work = 0;
    let works = 0;
    let fresh = 0;
    const since = this.ageWeeks.length > 0 ? this.ageWeeks[this.ageWeeks.length - 1]! : -1; // finished after the rung was reached
    this.kinds.forEach((k, d) => {
      if (!this.isBuilt(d, week)) return;
      if (k !== 'hall' && this.builtWeek[d]! > since) fresh++;
      if (k === 'shop') shop++;
      else if (k === 'works') (works++, work++);
      else if (k !== 'home' && k !== 'hall') work++;
    });
    if (this.living >= need.pop && shop >= need.shop && work >= need.work && works >= need.works && fresh >= need.fresh) this.ageWeeks.push(week);
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

  /** People a dwelling holds at most right now; none for workplaces and the hall. */
  capacity(dwelling: number): number {
    const k = this.kinds[dwelling];
    if (k !== 'home' && k !== 'shop') return 0;
    return capacityOf(this.area[dwelling]!);
  }

  /** Add GROW_STEP open cells on every side; everything keeps its place relative to the town. False at the cap. */
  private growGrid(): boolean {
    const old = this.grid.n;
    const p = Math.min(GROW_STEP, Math.floor((this.maxGrid - old) / 2));
    if (p < 1) return false;
    const n = old + 2 * p;
    const cells = new Uint8Array(n * n);
    const occ = new Uint8Array(n * n);
    for (let y = 0; y < old; y++) {
      cells.set(this.grid.cells.subarray(y * old, (y + 1) * old), (y + p) * n + p);
      occ.set(this.occ.subarray(y * old, (y + 1) * old), (y + p) * n + p);
    }
    const worn = new Uint8Array(n * n);
    const idle = new Uint8Array(n * n);
    for (let y = 0; y < old; y++) {
      worn.set(this.worn.subarray(y * old, (y + 1) * old), (y + p) * n + p);
      idle.set(this.idle.subarray(y * old, (y + 1) * old), (y + p) * n + p);
    }
    // The new ring is town, not bare ground: irregular streets that thin out toward the edge, green patches, and the river. All pure
    // in the seed's own coordinates, so a line or patch is the same however the grid grew.
    const seedN = old - 2 * this.shiftX;
    const c = seedN / 2;
    const base = this.base;
    const lineSet = (axis: number): Set<number> => {
      const out = new Set<number>();
      for (const dir of [1, -1]) {
        for (let pos = c, i = 0; Math.abs(pos - c) < this.maxGrid; i++) {
          pos += dir * (STREET_GAP + (hash32(`${base}|gap|${axis}|${dir}|${i}`) % 4) + Math.floor(Math.abs(pos - c) / 6));
          out.add(Math.round(pos));
        }
      }
      return out;
    };
    const lines = [lineSet(0), lineSet(1)];
    /** Whether a street line of one axis passes the cell: it wobbles a cell either way every 8 cells and, far out, has more gaps. */
    const street = (axis: number, along: number, across: number): boolean => {
      for (let w = -1; w <= 1; w++) {
        const x0 = across - w;
        if (!lines[axis]!.has(x0)) continue;
        const seg = Math.floor(along / 8);
        const h = hash32(`${base}|wob|${axis}|${x0}|${seg}`);
        if (h % 3 - 1 !== w) continue;
        if (Math.floor(h / 3) % 100 >= Math.min(60, Math.max(0, (Math.abs(x0 - c) - 24) * 2))) return true; // gaps grow with distance
      }
      return false;
    };
    const inner = (v: number) => v >= p && v < p + old;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (inner(x) && inner(y)) continue;
        const sx = x - this.shiftX - p;
        const sy = y - this.shiftY - p;
        const at = y * n + x;
        if (street(0, sy, sx) || street(1, sx, sy)) cells[at] = 1;
        else {
          const far = Math.max(0, Math.hypot(sx - c, sy - c) - seedN / 2);
          if (hash32(`${base}|green|${Math.floor(sx / 3)}|${Math.floor(sy / 3)}`) % 100 < GREEN_PERCENT + Math.min(20, Math.floor(far / 3))) cells[at] = 3;
        }
      }
    }
    // A river that reaches the old edge runs on through the ring, keeping the heading it came in with and turning now and then (one
    // course for the whole width).
    const old0 = this.grid.cells;
    for (let side = 0; side < 4; side++) {
      const at = (j: number, depth = 0) => old0[side < 2 ? (side === 0 ? depth : old - 1 - depth) * old + j : j * old + (side === 2 ? depth : old - 1 - depth)];
      for (let i = 0; i < old; i++) {
        if (at(i) !== WATER) continue;
        let j = i;
        while (j < old && at(j) === WATER) j++;
        // the heading: where the river was a few cells in, against where it is at the edge
        const mid = (i + j - 1) / 2;
        let back = -1;
        for (let t = 0; t < old; t++) if (at(t, 5) === WATER && (back < 0 || Math.abs(t - mid) < Math.abs(back - mid))) back = t;
        let vel = back < 0 ? 0 : Math.max(-1, Math.min(1, Math.round((mid - back) / 3)));
        let drift = 0;
        for (let k = 1; k <= p; k++) {
          const h = hash32(`${base}|river|${side}|${i - (side < 2 ? this.shiftX : this.shiftY)}|${k}`);
          if (h % 3 === 0) vel = (Math.floor(h / 3) % 3) - 1;
          drift += vel;
          for (let t = i; t < j; t++) {
            const along = t + p + drift;
            const x = side < 2 ? along : side === 2 ? p - k : p + old - 1 + k;
            const y = side >= 2 ? along : side === 0 ? p - k : p + old - 1 + k;
            if (x >= 0 && y >= 0 && x < n && y < n) cells[y * n + x] = WATER;
          }
        }
        i = j;
      }
    }
    // A footpath that links two separate streets is one of them: it becomes a road (one that only reaches a single street stays a footpath).
    {
      const road = new Int32Array(n * n).fill(-1);
      let roads = 0;
      const flood = (k: number, mark: Int32Array, id: number, take: (v: number, i: number) => boolean): number[] => {
        const list = [k];
        mark[k] = id;
        for (let q = 0; q < list.length; q++) {
          const cx = list[q]! % n;
          const cy = (list[q]! - cx) / n;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const xx = cx + dx;
              const yy = cy + dy;
              if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
              const nb = yy * n + xx;
              if (mark[nb]! < 0 && take(cells[nb]!, nb)) (mark[nb] = id, list.push(nb));
            }
          }
        }
        return list;
      };
      for (let k = 0; k < n * n; k++) if (road[k]! < 0 && (cells[k] === 1 || cells[k] === 2) && !worn[k]) flood(k, road, roads++, (v, i) => (v === 1 || v === 2) && !worn[i]);
      const seen = new Int32Array(n * n).fill(-1);
      let paths = 0;
      for (let k = 0; k < n * n; k++) {
        if (seen[k]! >= 0 || cells[k] !== 5 || worn[k]) continue;
        const group = flood(k, seen, paths++, (v, i) => v === 5 && !worn[i]);
        const touched = new Set<number>();
        for (const g of group) {
          const gx = g % n;
          const gy = (g - gx) / n;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const xx = gx + dx;
            const yy = gy + dy;
            if (xx >= 0 && yy >= 0 && xx < n && yy < n && road[yy * n + xx]! >= 0) touched.add(road[yy * n + xx]!);
          }
        }
        if (touched.size >= 2) for (const g of group) (cells[g] = 1, worn[g] = 0, idle[g] = 0);
      }
    }
    // Every street piece in the ring is joined to the network (a street always meets another at one end at least): the piece cheapest
    // to reach is linked first, over free ground, and across water only where nothing else reaches (WATER_COST per cell, so one bridge
    // serves a whole bank, not one per block).
    {
      const isRoad = (k: number) => (cells[k] === 1 || cells[k] === 2 || cells[k] === 5) && !worn[k]; // footpaths count: they are streets people walk; a worn-away one is grass
      const comp = new Int32Array(n * n).fill(-1);
      const members: number[][] = [];
      const inRing: boolean[] = [];
      for (let k = 0; k < n * n; k++) {
        if (comp[k] >= 0 || !isRoad(k)) continue;
        const id = members.length;
        const list = [k];
        comp[k] = id;
        let ring = false;
        for (let q = 0; q < list.length; q++) {
          const cur = list[q]!;
          const cx = cur % n;
          const cy = (cur - cx) / n;
          if (!inner(cx) || !inner(cy)) ring = true;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const xx = cx + dx;
              const yy = cy + dy;
              if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
              const nb = yy * n + xx;
              if (comp[nb]! < 0 && isRoad(nb)) (comp[nb] = id, list.push(nb));
            }
          }
        }
        members.push(list);
        inRing.push(ring);
      }
      let main = -1;
      members.forEach((list, id) => {
        if (list.some((k) => cells[k] === 2) && main < 0) main = id; // the plaza's network
      });
      if (main < 0) members.forEach((list, id) => (main < 0 || list.length > members[main]!.length) && (main = id));
      const left = new Set<number>();
      inRing.forEach((r, id) => r && id !== main && left.add(id));
      const NB4 = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;
      while (main >= 0 && left.size > 0) {
        const dist = new Int32Array(n * n).fill(-1);
        const from = new Int32Array(n * n).fill(-1);
        const buckets: number[][] = [[]];
        for (const k of members[main]!) (dist[k] = 0, buckets[0]!.push(k));
        let hit = -1;
        for (let d = 0; d < buckets.length && hit < 0; d++) {
          for (const cur of buckets[d] ?? []) {
            if (dist[cur] !== d) continue; // a longer way found since
            if (comp[cur]! >= 0 && left.has(comp[cur]!)) {
              hit = cur;
              break;
            }
            const cx = cur % n;
            const cy = (cur - cx) / n;
            for (const [dx, dy] of NB4) {
              const xx = cx + dx;
              const yy = cy + dy;
              if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
              const nb = yy * n + xx;
              if (occ[nb]) continue;
              const nd = d + (cells[nb] === WATER ? WATER_COST : cells[nb] === 5 ? 0 : 1); // footpaths are free: they are the way people already go
              if (dist[nb]! >= 0 && dist[nb]! <= nd) continue;
              dist[nb] = nd;
              from[nb] = cur;
              (buckets[nd] ??= []).push(nb);
            }
          }
        }
        if (hit < 0) break; // walled in by buildings
        const joined = comp[hit]!;
        for (let k = hit; k >= 0 && dist[k] !== 0; k = from[k]!) if ((cells[k] !== 1 && cells[k] !== 2) || worn[k]) (cells[k] = 1, worn[k] = 0, idle[k] = 0); // a footpath on the way becomes a road, a worn street is mended
        for (const k of members[joined]!) comp[k] = main;
        members[main]!.push(...members[joined]!);
        left.delete(joined);
      }
    }
    const parcel = new Uint8Array(n * n);
    for (let y = 0; y < old; y++) parcel.set(this.parcel.subarray(y * old, (y + 1) * old), (y + p) * n + p);
    this.parcel = parcel;
    for (const a of this.access.values()) {
      a.door.x += p;
      a.door.y += p;
      for (const c of a.track) (c.x += p, c.y += p);
    }
    this.grid = { n, cells };
    this.occ = occ;
    this.worn = worn;
    this.idle = idle;
    for (const o of this.origin) (o.x += p, o.y += p);
    this.plot = this.plot.map((pl) => (pl ? { x: pl.x + p, y: pl.y + p, w: pl.w, h: pl.h } : pl)); // copies: the seed's plots are shared
    for (const list of this.extra) for (const c of list) (c.x += p, c.y += p);
    this.shiftX += p;
    this.shiftY += p;
    return true;
  }

  /** The open w x h rectangle nearest the middle of the grid with a free ring around it (buildings never touch), or undefined. */
  private openSpot(w: number, h: number): Cell | undefined {
    const n = this.grid.n;
    const mid = n / 2;
    let best: Cell | undefined;
    let bestD = Infinity;
    for (let y = 1; y + h < n; y++) {
      for (let x = 1; x + w < n; x++) {
        const d = Math.hypot(x + w / 2 - mid, y + h / 2 - mid);
        if (d >= bestD) continue;
        let ok = true;
        for (let yy = y - 1; yy <= y + h && ok; yy++) {
          for (let xx = x - 1; xx <= x + w && ok; xx++) {
            const k = yy * n + xx;
            const inside = xx >= x && xx < x + w && yy >= y && yy < y + h;
            if (this.occ[k] || this.parcel[k] || (inside && !FREE_CELLS.includes(this.grid.cells[k]!))) ok = false;
          }
        }
        if (ok) (best = { x, y }, bestD = d);
      }
    }
    return best;
  }

  /**
   * Start a new building on open ground (growing the grid if there is none), finished some weeks on. Mostly a home; where the land offers
   * soil, timber or stone, sometimes a farm, mill or quarry (a hungry town on farmland leans to a farm). Returns whether one was started.
   */
  private appendHome(week: number, age: number, hungry: boolean): boolean {
    const w = roll(this.base, week, 0, 31) < 0.5 ? 2 : 3;
    const h = roll(this.base, week, 1, 31) < 0.6 ? 2 : 3;
    let at = this.openSpot(w, h);
    while (!at && this.growGrid()) at = this.openSpot(w, h);
    if (!at) return false;
    this.kinds.push(this.appendedKind(week, age, hungry));
    this.area.push(w * h);
    this.origin.push({ x: at.x, y: at.y, w, h });
    this.plot.push(undefined);
    this.extra.push([]);
    this.byOrigin.push([]);
    this.builtWeek.push(week + 20 + Math.floor(roll(this.base, week, 2, 31) * 32));
    this.ruinedWeek.push(-1);
    this.clearedWeek.push(-1);
    this.started.push(true);
    this.emptyWeeks.push(0);
    this.fullWeeks.push(0);
    this.boxedIn.push(false);
    this.finish.push(0);
    this.paintRect({ x: at.x, y: at.y, w, h });
    this.connect(this.kinds.length - 1, { x: at.x, y: at.y, w, h });
    return true;
  }

  private appendedKind(week: number, age: number, hungry: boolean): string {
    const land = this.around;
    if (!land) return 'home';
    const total = land.soil + land.timber + land.stone;
    if (hungry && land.soil > 0 && roll(this.base, week, 0, 37) < HUNGRY_FARM) return (UNLOCK_AGE.farm ?? 0) <= age ? 'farm' : 'home';
    if (total === 0 || roll(this.base, week, 1, 37) >= Math.min(WORK_MAX, WORK_PER_LAND * total)) return 'home';
    let at = roll(this.base, week, 2, 37) * total;
    const kind = (at -= land.soil) < 0 ? 'farm' : (at -= land.timber) < 0 ? 'mill' : 'quarry';
    return (UNLOCK_AGE[kind] ?? 0) <= age ? kind : 'home';
  }

  /**
   * Give a new building its door and a footpath to the nearest street, path or plaza over open ground (breadth first from the cells beside
   * it, fixed side and cell order). With none reachable the door faces south and there is no path.
   */
  private connect(dwelling: number, r: { x: number; y: number; w: number; h: number }): void {
    const n = this.grid.n;
    const cells = this.grid.cells;
    const NB4 = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const; // north, east, south, west
    const street = (k: number) => (cells[k] === 1 || cells[k] === 2) && !this.worn[k]; // standing streets only: the paths of buildings not standing are not drawn
    const seen = new Uint8Array(n * n);
    const from = new Int32Array(n * n).fill(-1);
    const doorAt = new Map<number, { x: number; y: number; side: number }>();
    const queue: number[] = [];
    const edge: { x: number; y: number; side: number }[] = [];
    for (let x = r.x; x < r.x + r.w; x++) edge.push({ x, y: r.y, side: 0 });
    for (let y = r.y; y < r.y + r.h; y++) edge.push({ x: r.x + r.w - 1, y, side: 1 });
    for (let x = r.x; x < r.x + r.w; x++) edge.push({ x, y: r.y + r.h - 1, side: 2 });
    for (let y = r.y; y < r.y + r.h; y++) edge.push({ x: r.x, y, side: 3 });
    for (const e of edge) {
      const nx = e.x + NB4[e.side]![0];
      const ny = e.y + NB4[e.side]![1];
      if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
      const k = ny * n + nx;
      if (this.occ[k] || seen[k]) continue;
      if (street(k)) {
        this.access.set(dwelling, { door: e, track: [] }); // already on a street
        return;
      }
      if (FREE_CELLS.includes(cells[k]!)) (seen[k] = 1, doorAt.set(k, e), queue.push(k));
    }
    for (let q = 0; q < queue.length; q++) {
      const cur = queue[q]!;
      const cx = cur % n;
      const cy = (cur - cx) / n;
      for (const [dx, dy] of NB4) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
        const k = ny * n + nx;
        if (seen[k] || this.occ[k]) continue;
        if (street(k)) {
          const track: { x: number; y: number; cls: number }[] = [];
          let c = cur;
          for (;;) {
            track.push({ x: c % n, y: Math.floor(c / n), cls: cells[c]! });
            cells[c] = 5;
            if (from[c]! < 0) break;
            c = from[c]!;
          }
          this.access.set(dwelling, { door: doorAt.get(c)!, track });
          return;
        }
        if (FREE_CELLS.includes(cells[k]!)) (seen[k] = 1, from[k] = cur, queue.push(k));
      }
    }
  }

  /** The door and footpath of a home the town added (the footpath as cells and the class each had before), if it has them. */
  accessOf(dwelling: number): { door: { x: number; y: number; side: number }; track: readonly { x: number; y: number; cls: number }[] } | undefined {
    return this.access.get(dwelling);
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
  private expand(d: number, week: number, notchOnly = false, probe = false): boolean {
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
      if ((mine.size + 1) / (w * h) < MIN_FILL) continue;
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
    if (probe) return true; // there is room; take nothing
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
    this.advanceAge(week);
    const age = this.ageAt(week);
    // Crowding: a district that has outgrown its starting population births and receives fewer; one that has shrunk,
    // more. Keeps long runs from running away to the building cap or dying out.
    const fortune = fortuneOf(base, week);
    const crowd = Math.max(0.2, Math.min(1.3, 1 + (this.initial - this.living) / Math.max(1, this.initial))) * fortune * this.feed;

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
      else if (!this.boxedIn[d]) {
        const grows = roll(this.base, 0, d, 36) < EXPAND_SHARE;
        const waited = ++this.fullWeeks[d]!;
        if (waited < PRESSED_AFTER_WEEKS) return;
        // One that will not grow, or has no room to, is pressed now; the rest wait their year for the cell.
        if (grows && waited < EXPAND_AFTER_WEEKS) {
          if (!this.expand(d, week, false, true)) this.boxedIn[d] = true;
        } else if (grows && this.expand(d, week)) this.fullWeeks[d] = 0;
        else this.boxedIn[d] = true;
      }
    });

    // Need: when homes that are full and cannot grow any more outnumber what is being built, a reserve plot is started (a home
    // first, nearest the center first) and finished some weeks on.
    let pressed = 0;
    let underway = 0;
    let emptyHomes = 0;
    let standingHomes = 0;
    home.forEach((g, d) => {
      if (this.kinds[d] === 'home' && this.isBuilt(d, week)) (standingHomes++, g.length === 0 && emptyHomes++);
      if (this.started[d] && this.builtWeek[d]! > week) underway++;
      else if (this.kinds[d] === 'home' && this.boxedIn[d] && g.length >= this.capacity(d)) pressed++;
    });
    // Food: a town the land cannot feed wants a farm before anything but a home.
    let farms = 0;
    for (let d = 0; d < this.kinds.length; d++) if (this.kinds[d] === 'farm' && this.isBuilt(d, week)) farms++;
    const hungry = this.living > FOOD_BASE + FARM_FEEDS * farms;
    let startedNow = false;
    // A town with too many homes standing empty appends no more.
    const roomy = emptyHomes > standingHomes * EMPTY_SHARE;
    if (pressed > underway && roll(base, week, 0, 24) < pressed * BUILD_PER_PRESSED_WEEK * this.feed) {
      let pick = -1;
      for (let d = 0; d < this.builtWeek.length && pick < 0; d++) if (this.builtWeek[d] === -1 && this.kinds[d] === 'home') pick = d;
      // Once no home is left in reserve, an ungated kind (a shop) goes next, unless a hungry town has a farm waiting; gated workplaces
      // follow their own line below.
      const farmWaits = hungry && this.kinds.some((k, d) => k === 'farm' && this.builtWeek[d] === -1 && !this.started[d] && (UNLOCK_AGE.farm ?? 0) <= age);
      for (let d = 0; d < this.builtWeek.length && pick < 0 && !farmWaits; d++) if (this.builtWeek[d] === -1 && !(this.kinds[d]! in UNLOCK_AGE)) pick = d;
      if (pick >= 0) this.builtWeek[pick] = week + 20 + Math.floor(roll(base, week, 1, 27) * 32);
      if (pick >= 0) this.started[pick] = true;
      startedNow = pick >= 0;
      // No reserve left: a growing town appends a home (and widens its grid if the ground is used up).
      if (pick < 0 && !farmWaits && !roomy && this.growable) startedNow = this.appendHome(week, age, hungry);
    }

    // A workplace whose age has come is started now and then, one at a time. A town the land cannot feed starts a farm first;
    // otherwise the one nearest the center (lowest index) goes.
    if (underway === 0 && !startedNow && roll(base, week, 0, 51) < WORKPLACE_PER_WEEK * this.feed) {
      let pick = -1;
      for (let d = 0; d < this.builtWeek.length; d++) {
        const unlock = UNLOCK_AGE[this.kinds[d]!] ?? 0;
        if (this.builtWeek[d] !== -1 || this.started[d] || unlock === 0 || unlock > age) continue;
        if (pick < 0) pick = d;
        if (!hungry || this.kinds[d] === 'farm') {
          if (hungry) pick = d;
          break;
        }
      }
      if (pick >= 0) {
        this.builtWeek[pick] = week + 20 + Math.floor(roll(base, week, 2, 27) * 32);
        this.started[pick] = true;
      }
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
    if (week % 52 === 0) this.yearlyDecay(week);

    // Households arriving from outside into vacant homes. The more homes stand empty, the likelier one fills.
    const vacant: number[] = [];
    home.forEach((g, d) => {
      if (this.kinds[d] === 'home' && this.isBuilt(d, week) && g.length === 0) vacant.push(d);
    });
    if (vacant.length > 0 && roll(base, week, 0, 20) < vacant.length * HOUSEHOLD_PER_VACANT_WEEK * crowd) {
      this.arrive(vacant[Math.floor(roll(base, week, 1, 21) * vacant.length)]!, week, tick, emit);
    }
  }

  /** Once a year: ruins are cleared after a few decades, and streets with nobody near them wear a step (an occupied one is mended). */
  private yearlyDecay(week: number): void {
    const base = this.base;
    for (let d = 0; d < this.kinds.length; d++) {
      const r = this.ruinedWeek[d]!;
      if (r < 0 || this.clearedWeek[d]! >= 0) continue;
      if (week - r < 52 * (CLEAR_YEARS[0] + Math.floor(roll(base, d, 0, 34) * CLEAR_YEARS[1]))) continue;
      this.clearedWeek[d] = week;
      const n = this.grid.n;
      const own = this.origin[d]!;
      for (let y = own.y; y < own.y + own.h; y++) for (let x = own.x; x < own.x + own.w; x++) this.occ[y * n + x] = 0;
      for (const c of this.extra[d]!) this.occ[c.y * n + c.x] = 0;
      const pl = this.plot[d];
      if (pl) for (let y = pl.y; y < pl.y + pl.h; y++) for (let x = pl.x; x < pl.x + pl.w; x++) this.parcel[y * n + x] = 0;
    }
    const n = this.grid.n;
    const kept = new Uint8Array(n * n);
    const living = new Set<number>();
    for (const p of this.alive) living.add(p.residence);
    for (let d = 0; d < this.kinds.length; d++) {
      if (!this.isBuilt(d, week)) continue;
      const k = this.kinds[d]!;
      // A home or shop is kept up by who lives there; a workplace or the hall by the town having anyone at all.
      if (k === 'home' || k === 'shop' ? !living.has(d) : this.living === 0) continue;
      const o = this.origin[d]!;
      for (let y = Math.max(0, o.y - KEPT_UP_RADIUS); y < Math.min(n, o.y + o.h + KEPT_UP_RADIUS); y++) {
        for (let x = Math.max(0, o.x - KEPT_UP_RADIUS); x < Math.min(n, o.x + o.w + KEPT_UP_RADIUS); x++) kept[y * n + x] = 1;
      }
    }
    for (let i = 0; i < n * n; i++) {
      const seq = WEAR_STEPS[this.grid.cells[i]!];
      if (!seq) continue;
      if (kept[i]) {
        this.idle[i] = 0;
        this.worn[i] = 0;
        continue;
      }
      if (this.idle[i]! < 255) this.idle[i]!++;
      const first = WEAR_YEARS[0] + Math.floor(roll(base, (i % n) - this.shiftX, Math.floor(i / n) - this.shiftY, 33) * WEAR_YEARS[1]);
      let steps = 0;
      while (steps < seq.length && this.idle[i]! >= first * (1 + 0.5 * steps)) steps++;
      this.worn[i] = steps > 0 ? seq[steps - 1]! + 1 : 0;
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

/** The average age (years, one decimal) of the people living over time, on the same grid as `livingSeries`. A stretch with nobody alive is NaN: a gap, so the line is not drawn across it. */
export function meanAgeSeries(life: SiteLife, points = 96): SeriesPoint[] {
  const mean = (week: number): number => {
    const t = week * TICKS_PER_WEEK;
    let n = 0;
    let sum = 0;
    for (const p of life.people) {
      if (p.since > t || (p.deathTick !== null && p.deathTick <= t)) continue;
      n++;
      sum += Math.max(0, Math.floor((t - p.birthTick) / TICKS_PER_YEAR));
    }
    return n === 0 ? NaN : sum / n; // nobody alive: a gap in the line (NaN), not an age of 0
  };
  return sampleSeries(life.week, mean, points, (v) => Math.round(v * 10) / 10);
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
function sampleSeries(W: number, count: (week: number) => number, points: number, round = Math.round): SeriesPoint[] {
  if (W < 1) return [];
  // Points sit on a fixed grid (a power-of-two number of weeks apart) and each one is the average headcount over the
  // bucket it closes, so a finished stretch of the line does not change as time advances (until the spacing doubles,
  // when the whole line is resampled once): a one-week dip does not flicker in and out of the sampling. The first and
  // last points are exact, so the ends match the live headcount.
  const n = Math.max(2, Math.floor(points));
  let step = 1;
  while (step * (n - 1) < W) step *= 2;
  const out: SeriesPoint[] = [{ t: 0, v: round(count(0)) }];
  for (let k = 1; k * step < W; k++) {
    const samples = Math.min(4, step);
    let sum = 0;
    let seen = 0;
    for (let q = 0; q < samples; q++) {
      const c = count((k - 1) * step + 1 + Math.floor((q * step) / samples));
      if (Number.isFinite(c)) (sum += c, seen++); // a sample with no value (NaN) is left out of the bucket's average
    }
    out.push({ t: k * step * TICKS_PER_WEEK, v: seen > 0 ? round(sum / seen) : NaN });
  }
  out.push({ t: W * TICKS_PER_WEEK, v: round(count(W)) });
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
    for (const e of d.track) if (out[e >> 3] === 5) out[e >> 3] = e & 7; // a footpath that became a road stays one
  }
  return out;
}

/** The district view with live headcounts and footprints (homes grow). The settlement's population is the people living now. */
/**
 * The cells with wear applied (see `SiteLife.wear`). Returns the input when nothing is worn. A cell `visibleCells` put back (the
 * footpath of a building not standing) is left alone: it is not a path yet, so it cannot wear.
 */
export function wornCells(cells: Uint8Array, wear: Uint8Array, layout: Uint8Array): Uint8Array {
  let out = cells;
  for (let i = 0; i < wear.length; i++) {
    if (!wear[i] || cells[i] !== layout[i]) continue;
    if (out === cells) out = cells.slice();
    out[i] = wear[i]! - 1;
  }
  return out;
}

export function applyLife(
  view: SiteView,
  life: SiteLife,
  /** The name key and inspected flag of a dwelling the town added after layout, by path. */
  meta: (path: string) => { nameKey: number; inspected: boolean } = () => ({ nameKey: 0, inspected: false }),
): SiteView {
  const counts = new Array<number>(life.dwellingCount).fill(0);
  for (const p of life.people) if (p.deathTick === null) counts[p.residence]!++;
  const { x: ox, y: oy } = life.offset;
  const n = life.gridSize;
  const seeded = view.dwellings.length;
  const state = (i: number) => ({
    extra: [...life.extension(i)],
    capacity: life.capacity(i),
    built: life.isBuilt(i),
    decay: life.isCleared(i) ? ('cleared' as const) : life.isRuin(i) ? ('ruin' as const) : life.isDerelict(i) ? ('derelict' as const) : undefined,
    builtWeek: life.builtWeekOf(i),
    residents: counts[i]!,
  });
  const dwellings: DwellingSummary[] = view.dwellings.map((d, i) => ({
    ...d,
    ...state(i),
    ...life.rectOf(i),
    door: { ...d.door, x: d.door.x + ox, y: d.door.y + oy },
    // a cell index of the layout's grid, moved into the grown one
    track: d.track?.map((e) => {
      const k = e >> 3;
      return (((Math.floor(k / view.w) + oy) * n + (k % view.w) + ox) << 3) | (e & 7);
    }),
  }));
  for (let i = seeded; i < life.dwellingCount; i++) {
    const r = life.rectOf(i);
    const path = `${view.path}/d${i}`;
    const a = life.accessOf(i);
    dwellings.push({
      path,
      index: i,
      kind: life.kindOf(i) as DwellingKind,
      ...r,
      ...meta(path),
      plot: -1,
      door: a?.door ?? { x: r.x, y: r.y + r.h - 1, side: 2 },
      track: a && a.track.length > 0 ? a.track.map((c) => ((c.y * n + c.x) << 3) | c.cls) : undefined,
      ...state(i),
    });
  }
  const plots = view.plots.map((p) => ({ ...p, x: p.x + ox, y: p.y + oy }));
  return { ...view, w: n, h: n, population: life.living, cells: wornCells(visibleCells(life.layoutCells, dwellings), life.wear, life.layoutCells), dwellings, plots };
}
