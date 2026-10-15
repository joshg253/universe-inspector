// Core invariants, run with `npm test`. No browser needed: core/ has no DOM.
import assert from 'node:assert/strict';
import { DeltaStore } from '../src/core/deltas';
import { orbitalPeriod, solarDay, bodySites, genBody, genRecord, genSite, genSystem, genUniverse, settledBodyIndexes, siteLifeSeed } from '../src/core/generate';
import { districtSeries, SiteLife, type SiteLifeSeed, TICKS_PER_YEAR, TICKS_PER_WEEK, ageAt, capacityOf, livingSeries, meanAgeSeries, residenceAt, applyLife } from '../src/core/life';
import { viewLevel } from '../src/core/path';
import { layoutTown } from '../src/core/town';
import { rngFor } from '../src/core/rng';
import { Sim, dynFor } from '../src/core/sim';
import { packOf, PACKS } from '../src/packs';
import { spanLabel, speedTps } from '../src/core/protocol';

const json = (v: unknown) => JSON.stringify(v, (_k, x) => (x instanceof Uint8Array ? Array.from(x) : x));
const d = new DeltaStore();
let walked = 0;

// 1. Same seed, same universe. Different seed, different universe.
assert.equal(json(genSystem('alpha', 3, d)), json(genSystem('alpha', 3, d)));
assert.notEqual(json(genSystem('alpha', 3, d)), json(genSystem('beta', 3, d)));

// 2. Walk every level of several systems: nothing throws, counts agree.
for (const seed of ['alpha', 'beta', 'first-light']) {
  for (let si = 0; si < 6; si++) {
    const sys = genSystem(seed, si, d);
    assert.ok(sys.bodies.length >= 3);
    genRecord(seed, sys.path, d);
    for (const b of sys.bodies) {
      const body = genBody(seed, si, b.index, d);
      assert.equal(body.sites.length, b.siteCount, 'system summary matches body view');
      assert.equal(body.cells.length, body.w * body.h);
      genRecord(seed, body.path, d);
      for (const a of body.anomalies) genRecord(seed, a.path, d);
      for (const s of body.sites) {
        const site = genSite(seed, si, b.index, s.index, d);
        assert.ok(site.dwellings.some((x) => x.kind === 'hall'), 'every district has a hall');
        const lastSeen = new Set<string>();
        for (const dw of site.dwellings) {
          assert.ok(!lastSeen.has(dw.path));
          lastSeen.add(dw.path);
          const rec = genRecord(seed, dw.path, d);
          assert.equal(rec.children.length, dw.residents);
          for (const p of rec.children) genRecord(seed, p.path, d);
        }
        walked++;
      }
    }
  }
}
assert.ok(walked > 20, `walked ${walked} sites`);

// 3. The tick sim is deterministic and independent of how fast it is driven.
const run = (seed: string, ticks: number) => {
  const sim = new Sim(seed);
  const out: unknown[] = [];
  for (let i = 0; i < ticks; i++) out.push(...sim.step());
  return json(out);
};
assert.equal(run('alpha', 500), run('alpha', 500));
assert.notEqual(run('alpha', 500), run('beta', 500));

// 4. Per-tick view state has the right shape and day/night actually changes.
const view = genSite('alpha', 0, 1, 0, d);
const dyns = Array.from({ length: 60 }, (_, t) => dynFor(view, t, 'alpha'));
const daylights = dyns.map((x) => (x.level === 'site' ? x.daylight : -1));
assert.ok(Math.min(...daylights) < 0.2 && Math.max(...daylights) > 0.8, 'site sees both night and day');

// 5. Deltas only touch the flag; the baseline is untouched.
const before = json(genSystem('alpha', 0, new DeltaStore()));
const patched = new DeltaStore();
patched.patch('s0/b0', { inspected: true });
const after = genSystem('alpha', 0, patched);
assert.equal(after.bodies[0]!.inspected, true);
assert.equal(json({ ...after, bodies: after.bodies.map((b) => ({ ...b, inspected: false })) }), before);

// 6. Packs rename, never regenerate: same keys, different words.
const keys = genSystem('alpha', 0, d);
const names = Object.values(PACKS).map((p) => p.name('body', keys.bodies[0]!.nameKey, keys.bodies[0]!.kind));
assert.equal(new Set(names).size, names.length, 'packs name the same body differently');
assert.notEqual(packOf('scifi').t('body.temperate'), packOf('fantasy').t('body.temperate'));

// 7. The universe level: stable, every system on it generates, trails start at the universe.
const uni = genUniverse('alpha', d);
assert.equal(json(uni), json(genUniverse('alpha', d)));
assert.notEqual(json(uni), json(genUniverse('beta', d)));
assert.ok(uni.systems.length >= 40);
assert.equal(new Set(uni.systems.map((s) => s.path)).size, uni.systems.length);
assert.equal(uni.systems[3]!.bodyCount, genSystem('alpha', 3, d).bodies.length, 'universe summary matches system view');
assert.equal(genSystem('alpha', 3, d).trail[0]!.path, '', 'system trail starts at the universe');
assert.equal(viewLevel(''), 'universe');
assert.equal(viewLevel('s1/b2'), 'body');

// 7b. Towns must not depend on the engine's sort: run the layout under a sort that calls comparators in a different
// order (a bubble sort) and require the same result. Catches an rng used inside a comparator.
{
  const run = () =>
    ['small', 'medium', 'large'].map((size, i) =>
      json(layoutTown(64, size as 'small' | 'medium' | 'large', [40, 700, 5000][i]!, 'temperate', rngFor('alpha', `town/${size}`, 'layout'))),
    );
  const native = run();
  const nativeSort = Array.prototype.sort;
  Array.prototype.sort = function (this: unknown[], cmp?: (a: never, b: never) => number) {
    const f = cmp as (a: unknown, b: unknown) => number;
    for (let end = this.length - 1; end > 0; end--) {
      for (let j = 0; j < end; j++) {
        if (f(this[j], this[j + 1]) > 0) [this[j], this[j + 1]] = [this[j + 1], this[j]];
      }
    }
    return this;
  } as typeof Array.prototype.sort;
  let other: string[];
  try {
    other = run();
  } finally {
    Array.prototype.sort = nativeSort;
  }
  assert.deepEqual(other, native, 'town layout does not depend on how the engine orders sort comparisons');
}

// 8. Life: births, deaths, aging and moving house are a pure function of (seed, site, week).
{
  const seed = 'alpha';
  const bi = settledBodyIndexes(seed, 0)[0]!;
  const site = bodySites(seed, 0, bi)[0]!;
  const data = siteLifeSeed(seed, 0, bi, site.index);
  const WEEKS = 52 * 40;
  const snapshot = (l: SiteLife) => json([l.people, data.dwellings.map((_, i) => l.extension(i))]);

  // Folding in one jump equals stepping week by week (so viewing late equals watching all along).
  const stepped = new SiteLife(seed, data);
  for (let w = 1; w <= WEEKS; w++) stepped.advanceTo(w);
  const jumped = new SiteLife(seed, data);
  jumped.advanceTo(WEEKS);
  assert.equal(snapshot(stepped), snapshot(jumped));
  assert.notEqual(snapshot(stepped), snapshot(new SiteLife(seed, data)), 'time changes the district');

  // Something happens over 40 years.
  const { births, deaths } = stepped.totals;
  assert.ok(births > 0 && deaths > 0, `births ${births}, deaths ${deaths}`);
  assert.ok(stepped.people.some((p) => p.moves.length > 0), 'young adults move out');

  // Parentage: whoever is recorded as a parent has the right sex and was an adult at the birth; a child born in the
  // district has both, and a pair of parents are not close kin. (Starting households can have one parent on record.)
  for (const p of stepped.people.filter((q) => q.mother !== null || q.father !== null)) {
    const mom = p.mother === null ? null : stepped.people[p.mother]!;
    const dad = p.father === null ? null : stepped.people[p.father]!;
    if (mom) assert.equal(mom.sex, 'f');
    if (dad) assert.equal(dad.sex, 'm');
    if (mom) assert.ok((p.birthTick - mom.birthTick) / TICKS_PER_YEAR >= 18, 'the mother was an adult at the birth');
    if (mom) assert.ok((p.birthTick - mom.birthTick) / TICKS_PER_YEAR < 50, 'the mother was under 50 at the birth');
    if (dad) assert.ok((p.birthTick - dad.birthTick) / TICKS_PER_YEAR >= 18, 'the father was an adult at the birth');
    if (dad) assert.ok((p.birthTick - dad.birthTick) / TICKS_PER_YEAR < 71, 'the father was at most 70 at the birth');
    if (p.birthTick >= p.since && p.birthTick === p.since && p.since > 0) assert.ok(mom && dad, 'a birth here has both parents');
    if (!mom || !dad) continue;
    assert.ok(dad.mother !== mom.id && dad.father !== mom.id, "father is not the mother's child");
    assert.ok(mom.mother !== dad.id && mom.father !== dad.id, "mother is not the father's child");
    assert.ok(!(mom.mother !== null && mom.mother === dad.mother), 'parents are not siblings');
    assert.ok(!(mom.father !== null && mom.father === dad.father), 'parents are not half-siblings');
  }

  // Starting households: parents are only people in the same home, children are younger than both by 18 years or
  // more, and no one's parents exist before tick 0.
  const start = new SiteLife(seed, data);
  let withKids = 0;
  let strangers = 0;
  for (const p of start.people) {
    for (const par of [p.mother, p.father]) {
      if (par === null) continue;
      const q = start.people[par]!;
      assert.equal(q.origin, p.origin, 'a starting parent lives in the same home');
      assert.ok(q.local < p.local, 'parents come before their children');
    }
    if (p.mother !== null || p.father !== null) withKids++;
    const kd = data.dwellings[p.origin]!.kind;
    if (kd !== 'home' && kd !== 'shop' && (p.mother !== null || p.father !== null)) strangers++;
  }
  assert.ok(withKids > 0, 'some starting residents are children of others in the home');
  assert.equal(start.totals.births, 0, 'the starting children are not births here');
  data.dwellings.forEach((dw, di) => {
    if (dw.kind === 'works' || dw.kind === 'hall') assert.equal(dw.residents, 0, 'works and the hall start empty');
    // Starting siblings (same parents, not twins) are at least about a year apart.
    const born = start.residents(di).filter((q) => q.mother !== null || q.father !== null);
    const byParents = new Map<string, number[]>();
    for (const q of born) byParents.set(`${q.mother}/${q.father}`, [...(byParents.get(`${q.mother}/${q.father}`) ?? []), q.birthTick]);
    for (const ticks of byParents.values()) {
      ticks.sort((a, b) => a - b);
      for (let i = 1; i < ticks.length; i++) assert.ok(ticks[i]! - ticks[i - 1]! >= 40 * TICKS_PER_WEEK, 'starting siblings are spaced');
    }
  });
  // Records without a running district read the same household: sex, links and the list order.
  for (let di = 0; di < data.dwellings.length && di < 12; di++) {
    for (const q of start.residents(di)) {
      const rec = genRecord(seed, `${data.dwellings[q.origin]!.path}/p${q.local}`, new DeltaStore());
      assert.equal(rec.fields.find((f) => f.label === 'sex')?.value, q.sex, 'record sex matches the model');
      assert.equal((rec.links ?? []).some((l) => l.label === 'mother'), q.mother !== null, 'record links the mother');
      assert.equal((rec.links ?? []).some((l) => l.label === 'father'), q.father !== null, 'record links the father');
    }
  }
  let threeGen = 0;
  for (const s of [seed, 'beta', 'gamma', 'delta']) {
    const sb = settledBodyIndexes(s, 0);
    for (const b of sb) for (const st of bodySites(s, 0, b)) {
      const sd = siteLifeSeed(s, 0, b, st.index);
      const sl = new SiteLife(s, sd);
      sd.dwellings.forEach((_, di) => {
        const res = sl.residents(di);
        if (res.some((p) => p.mother !== null && res.some((g) => g.id === p.mother && g.mother !== null || g.id === p.mother && g.father !== null))) threeGen++;
      });
    }
  }
  assert.ok(threeGen > 0, 'some starting homes hold three generations');
  assert.equal(strangers, 0, 'works and the hall hold no families');

  // Everyone lives somewhere real, and no building is over capacity once settled.
  const occupancy = new Map<number, number>();
  for (const p of stepped.people) {
    assert.ok(p.residence >= 0 && p.residence < data.dwellings.length);
    if (p.deathTick === null) occupancy.set(p.residence, (occupancy.get(p.residence) ?? 0) + 1);
    if (p.moves.length > 0) assert.equal(data.dwellings[p.residence]!.kind === 'home' || p.residence === p.origin, true);
  }
  assert.ok(Math.max(...occupancy.values()) <= 10, 'no dwelling holds more than ten people');
  for (const [di, n] of occupancy) assert.ok(n <= stepped.capacity(di), 'no dwelling holds more than its footprint allows');
  assert.deepEqual([2, 4, 6, 9, 12, 100].map(capacityOf), [3, 4, 5, 6, 8, 10]);

  // Age goes up one per year, and the record without a running district shows the same age as the model at tick 0.
  const d0 = data.dwellings.findIndex((x) => x.residents > 0);
  const p0 = new SiteLife(seed, data).person(d0, 0)!;
  assert.equal(ageAt(p0, 5 * TICKS_PER_YEAR), ageAt(p0, 0) + 5);
  const rec0 = genRecord(seed, `${data.dwellings[d0]!.path}/p0`, new DeltaStore());
  assert.equal(rec0.fields.find((f) => f.label === 'age')!.value, ageAt(p0, 0));

  // Each zoom level has its own five speeds on one ladder: a year per second at the bottom of the universe's, an hour in a district's.
  assert.deepEqual([1, 2, 3, 4, 5].map((i) => spanLabel(speedTps(0, i))), ['1 year', '10 years', '100 years', '1,000 years', '10,000 years']);
  assert.deepEqual([1, 2, 3, 4, 5].map((i) => spanLabel(speedTps(1, i))), ['1 week', '1 month', '1 year', '10 years', '100 years']);
  assert.deepEqual([1, 2, 3, 4, 5].map((i) => spanLabel(speedTps(2, i))), ['1 day', '1 week', '1 month', '1 year', '10 years']);
  assert.deepEqual([1, 2, 3, 4, 5].map((i) => spanLabel(speedTps(3, i))), ['1 hour', '1 day', '1 week', '1 month', '1 year']);
  assert.equal(speedTps(1, 0), 0);
  assert.deepEqual([spanLabel(1), spanLabel(24), spanLabel(168), spanLabel(720), spanLabel(8760), spanLabel(8760 * 24)], ['1 hour', '1 day', '1 week', '1 month', '1 year', '24 years']);

  // A planet's year and day come from orbit and spin, not from a standard 8,760 or 24.
  assert.equal(orbitalPeriod(50, 1), TICKS_PER_YEAR, 'orbit 50 around a mass-1 star is one standard year');
  assert.ok(orbitalPeriod(80, 1) > orbitalPeriod(50, 1), 'outer worlds take longer');
  assert.ok(orbitalPeriod(50, 1.7) < orbitalPeriod(50, 0.6), 'a heavier star pulls the same orbit round faster');
  assert.equal(Math.round(solarDay(24, 1e12)), 24, 'a far orbit leaves the day at the spin');
  assert.ok(solarDay(5832, 5400) > 5832 * 5, 'spin close to the orbit makes a very long day');
  assert.ok(solarDay(-5832, 5400) < 5400, 'retrograde spin shortens the day (a day shorter than the year)');
  assert.equal(solarDay(5400, 5400), Number.MAX_SAFE_INTEGER, 'spin equal to the orbit is a day that never ends, not Infinity or NaN');
  // Across seeds and every body: the day is finite, at least a tick, and at most five years of that body (the longest
  // the spin nudge allows, just outside its window).
  for (const sd of ['alpha', 'beta', 'gamma']) {
    for (let si = 0; si < 12; si++) {
      for (const b of genSystem(sd, si, d).bodies) {
        const dl = genBody(sd, si, b.index, d).dayLength;
        assert.ok(Number.isFinite(dl) && dl >= 1 && dl <= 5 * b.period + 1, `solar day ${dl} for period ${b.period}`);
      }
    }
  }

  // A long jump (a century in one press) leaves the people exactly where stepping tick by tick does.
  {
    const a = new Sim(seed);
    a.setFocusFromPath(site.path);
    for (let i = 0; i < 3 * TICKS_PER_YEAR + 77; i++) a.step();
    const b = new Sim(seed);
    b.setFocusFromPath(site.path);
    b.advance(3 * TICKS_PER_YEAR + 77);
    assert.equal(b.tick, a.tick);
    assert.equal(json(b.lifeFor(site.path)!.people), json(a.lifeFor(site.path)!.people), 'jump equals stepping');
    assert.equal(b.lifeFor(site.path)!.week, a.lifeFor(site.path)!.week, 'the same week is folded');
    // Chained jumps (and small ones, which are stepped) land in the same place as one long one.
    const c = new Sim(seed);
    c.setFocusFromPath(site.path);
    c.advance(5000);
    c.advance(3);
    c.advance(3 * TICKS_PER_YEAR + 77 - 5003);
    assert.equal(c.tick, a.tick);
    assert.equal(json(c.lifeFor(site.path)!.people), json(a.lifeFor(site.path)!.people), 'chained jumps equal stepping');
  }

  // Rewinding (the time scrubber) gives the same people as a run that never went further.
  {
    const far = new Sim(seed);
    far.setFocusFromPath(site.path);
    far.advance(5 * TICKS_PER_YEAR);
    far.goto(2 * TICKS_PER_YEAR + 123);
    const near = new Sim(seed);
    near.setFocusFromPath(site.path);
    near.advance(2 * TICKS_PER_YEAR + 123);
    assert.equal(far.tick, near.tick);
    assert.equal(json(far.lifeFor(site.path)!.people), json(near.lifeFor(site.path)!.people), 'going back equals never having gone on');
    const same = json(far.lifeFor(site.path)!.people);
    far.goto(far.tick);
    assert.equal(json(far.lifeFor(site.path)!.people), same, 'going to the same tick changes nothing');
    // Graphs and the pyramid: a short run has no one-week spike in a rate, and the pyramid adds up to the living.
    const young = far.lifeFor(site.path)!;
    const rate = districtSeries(young, 'deaths');
    assert.ok(rate.length > 0 && rate[0]!.t >= 4 * TICKS_PER_WEEK, 'a rate is never scaled up from a stretch under four weeks');
    const rec = genRecord(seed, site.path, new DeltaStore(), { tick: far.tick, life: young });
    assert.equal((rec.pyramid!.f.concat(rec.pyramid!.m)).reduce((n, v) => n + v, 0), young.living, 'the pyramid adds up to the living');
    // Average age: the last point is the mean age of the living, exactly; the first is the starting residents'.
    {
      const ages = meanAgeSeries(young);
      const living = young.people.filter((p) => p.deathTick === null);
      const mean = living.reduce((n, p) => n + Math.floor((far.tick - p.birthTick) / TICKS_PER_YEAR), 0) / living.length;
      assert.equal(ages[ages.length - 1]!.v, Math.round(mean * 10) / 10, 'the average age ends at the living');
      const first = young.people.slice(0, young.initial); // the starting residents come first, in id order
      const meanFirst = first.reduce((n, p) => n + Math.floor((0 - p.birthTick) / TICKS_PER_YEAR), 0) / first.length;
      assert.equal(ages[0]!.v, Math.round(meanFirst * 10) / 10, 'the average age starts at the starting residents');
      assert.ok(ages.every((p) => Number.isFinite(p.v)), 'a district that has people all along has no gaps in the average-age line');
      assert.ok(ages.some((p, i) => i > 0 && i < ages.length - 1 && !Number.isInteger(p.v)), 'interior points keep their decimal');
      assert.ok(rec.charts!.find((c) => c.label === 'population')!.overlay!.points.length > 0, 'the population graph carries the overlay');
    }
    // The family tree: parents above, children below, everyone on it exists, the person is in their own row, grandchildren
    // are the children's children. Looked at over a long run so there are three generations.
    {
      const old = new Sim(seed);
      old.setFocusFromPath(site.path);
      old.advance(120 * TICKS_PER_YEAR);
      const L = old.lifeFor(site.path)!;
      let checked = 0;
      let deep = 0;
      for (const p of L.people) {
        if (p.mother === null && p.father === null && !L.people.some((q) => q.mother === p.id || q.father === p.id)) continue;
        const path = `${data.dwellings[p.origin]!.path}/p${p.local}`;
        const r = genRecord(seed, path, new DeltaStore(), { tick: old.tick, life: L });
        if (!r.tree) continue;
        const rows = Object.fromEntries(r.tree.rows.map((row) => [row.label, row.items]));
        assert.ok(rows.family!.some((c) => c.path === path), 'the person is in their own row');
        const seen = new Set<string>();
        for (const row of r.tree.rows) {
          assert.equal(new Set(row.items.map((c) => c.path)).size, row.items.length, 'no one twice in a row');
          for (const c of row.items) if (row.label === 'family') (assert.ok(!seen.has(c.path)), seen.add(c.path));
        }
        const kids = (rows.offspring ?? []).length;
        assert.equal(kids, L.people.filter((q) => q.mother === p.id || q.father === p.id).length, 'children match the record');
        assert.ok((rows.parents ?? []).length <= 2);
        // Every grandparent is a parent of a parent, and every grandchild has one of the person's children as a parent.
        const idOf = (c: { path: string }) => L.people.find((q) => `${data.dwellings[q.origin]!.path}/p${q.local}` === c.path)!;
        const mine = new Set(rows.parents?.map((c) => idOf(c).id));
        for (const g of rows.grandparents ?? []) {
          const gp = idOf(g);
          assert.ok(L.people.some((q) => mine.has(q.id) && (q.mother === gp.id || q.father === gp.id)), 'a grandparent is a parent of a parent');
        }
        const kidIds = new Set(rows.offspring?.map((c) => idOf(c).id));
        for (const g of rows.grandchildren ?? []) {
          const gc = idOf(g);
          assert.ok(kidIds.has(gc.mother ?? -1) || kidIds.has(gc.father ?? -1), 'a grandchild has one of my children as a parent');
        }
        if (rows.grandchildren) deep++;
        checked++;
        if (checked >= 40) break;
      }
      assert.ok(checked > 0, 'some person has family to draw');
      assert.ok(deep > 0, 'three generations show up');
    }
    far.goto(4 * TICKS_PER_YEAR);
    near.advance(4 * TICKS_PER_YEAR - near.tick);
    assert.equal(json(far.lifeFor(site.path)!.people), json(near.lifeFor(site.path)!.people), 'and forward again');
  }

  // The Sim reports the same world whether the district was watched from the start or only looked at later.
  const watched = new Sim(seed);
  watched.setFocusFromPath(site.path);
  for (let i = 0; i < 30 * TICKS_PER_WEEK; i++) watched.step();
  const late = new Sim(seed);
  for (let i = 0; i < 30 * TICKS_PER_WEEK; i++) late.step();
  assert.equal(snapshot(late.lifeFor(site.path)!), snapshot(watched.lifeFor(site.path)!));

  // The chart series agrees with the live headcount at both ends, and is empty before any week has run.
  const series = livingSeries(stepped, null);
  assert.equal(series[0]!.v, stepped.initial);
  assert.equal(series[series.length - 1]!.v, stepped.living);
  assert.equal(livingSeries(new SiteLife(seed, data), null).length, 0);
  // A finished stretch of the line does not change as time advances (no blips flickering in and out while watching).
  {
    const l = new SiteLife(seed, data);
    l.advanceTo(52 * 30);
    const before = livingSeries(l, null);
    l.advanceTo(52 * 30 + 1);
    const after = livingSeries(l, null);
    const settled = before.length - 2; // everything but the closing grid point and the exact end
    assert.deepEqual(after.slice(0, settled), before.slice(0, settled), 'earlier points stay put as a week passes');
    assert.ok(after.length <= 97, 'at most about 96 points');
  }

  // Records agree with the model: a dwelling lists its current residents, a moved person still resolves by path.
  const tick = WEEKS * TICKS_PER_WEEK;
  const live = { tick, life: stepped };
  const mover = stepped.people.find((p) => p.moves.length > 0 && p.deathTick === null)!;
  const dwellingPath = data.dwellings[mover.residence]!.path;
  const drec = genRecord(seed, dwellingPath, d, live);
  assert.equal(drec.children.length, stepped.residents(mover.residence).length);
  const originPath = data.dwellings[mover.origin]!.path;
  assert.ok(drec.children.some((c) => c.path === `${originPath}/p${mover.local}`), 'the mover is listed where they live now');
  const prec = genRecord(seed, `${originPath}/p${mover.local}`, d, live);
  assert.equal(prec.links?.find((l) => l.label === 'residence')?.items[0]?.path, dwellingPath);
  assert.equal(genRecord(seed, site.path, d, live).charts?.[0]?.points.length, series.length);

  // Homes do not empty out for good: households arrive and couples found new ones, so vacancy stays bounded and the
  // population neither dies out nor runs away over a century.
  {
    let homes = 0;
    let vacant = 0;
    let start = 0;
    let end = 0;
    let sampled = 0;
    let arrivedKids = 0;
    let arrivedKidsMoved = 0;
    for (let si = 0; si < 2 && sampled < 10; si++) {
      for (const sbi of settledBodyIndexes(seed, si)) {
        for (const s of bodySites(seed, si, sbi)) {
          if (sampled >= 10) break;
          const dd = siteLifeSeed(seed, si, sbi, s.index);
          const l = new SiteLife(seed, dd);
          start += l.living;
          l.advanceTo(52 * 100);
          end += l.living;
          const endTick = l.week * TICKS_PER_WEEK;
          for (const person of l.people) {
            assert.equal(person.residence, residenceAt(person, endTick), 'residence matches the move history');
            assert.equal(l.person(person.origin, person.local), person, 'a person is found by their path');
            if (person.mother !== null) {
              const mom = l.people[person.mother]!;
              const dad = person.father === null ? null : l.people[person.father]!;
              assert.ok((person.birthTick - mom.birthTick) / TICKS_PER_YEAR >= 18, 'mother was an adult at the birth');
              if (dad) assert.ok((person.birthTick - dad.birthTick) / TICKS_PER_YEAR >= 18, 'father was an adult at the birth');
              if (person.birthTick !== person.since) {
                arrivedKids++;
                if (person.moves.length > 0) arrivedKidsMoved++;
              }
            }
          }
          dd.dwellings.forEach((x, i) => {
            if (x.kind !== 'home' || !l.isBuilt(i)) return; // a plot not yet built on is not a vacant home
            homes++;
            if (l.residents(i).length === 0) vacant++;
          });
          sampled++;
        }
      }
    }
    // Homes are built ahead of need, and a plague year (0.8% of years) empties households: under half stand empty.
    assert.ok(vacant / homes < 0.55, `vacancy after a century: ${vacant}/${homes}`);
    assert.ok(arrivedKids > 0, 'households with children arrive');
    assert.ok(arrivedKidsMoved > 0, 'children who arrived with a household can leave home and found their own');
    assert.ok(end > start * 0.6 && end < start * 1.6, `population after a century: ${start} -> ${end}`);
  }

  // Plots: parcels never overlap, never lie on the plaza or water, each building stands inside its own plot, and the plot
  // lists its building (a vacant plot lists none).
  {
    let plots = 0;
    let vacant = 0;
    for (const sd of ['alpha', 'beta', 'first-light']) {
      for (let si = 0; si < 6; si++) {
        for (const sbi of settledBodyIndexes(sd, si)) {
          for (const st of bodySites(sd, si, sbi)) {
            const v = genSite(sd, si, sbi, st.index, new DeltaStore());
            const seen = new Set<number>();
            v.plots.forEach((p, pi) => {
              plots++;
              for (let y = p.y; y < p.y + p.h; y++) {
                for (let x = p.x; x < p.x + p.w; x++) {
                  assert.ok(x >= 0 && y >= 0 && x < v.w && y < v.h, 'a plot lies inside the district');
                  const k = y * v.w + x;
                  assert.equal(seen.has(k), false, 'plots never overlap');
                  seen.add(k);
                  assert.ok(v.cells[k] !== 2 && v.cells[k] !== 4, 'a plot is never on the plaza or water');
                }
              }
              if (p.dwelling < 0) vacant++;
              else assert.equal(v.dwellings[p.dwelling]!.plot, pi, 'a plot and its building point at each other');
            });
            for (const d of v.dwellings) {
              if (d.kind === 'hall') continue;
              const p = v.plots[d.plot]!;
              assert.ok(d.x >= p.x && d.y >= p.y && d.x + d.w <= p.x + p.w && d.y + d.h <= p.y + p.h, 'a building stands inside its plot');
            }
          }
        }
      }
    }
    assert.ok(plots > 1000 && vacant > 0 && vacant < plots, `plots ${plots}, vacant ${vacant}`);
  }

  // One population: a settlement's number is the people its district holds, on the planet list, in the district view
  // and in its record, at tick 0 and after any time (no unmodeled remainder).
  {
    let checked = 0;
    for (let si = 0; si < 3; si++) {
      for (const sbi of settledBodyIndexes(seed, si)) {
        const listed = genBody(seed, si, sbi, new DeltaStore()).sites;
        for (const s of bodySites(seed, si, sbi)) {
          const dd = siteLifeSeed(seed, si, sbi, s.index);
          const l = new SiteLife(seed, dd);
          const view = genSite(seed, si, sbi, s.index, new DeltaStore());
          assert.equal(view.population, l.initial, 'the settlement number is the people at tick 0');
          assert.equal(listed[s.index]!.population, view.population, 'the planet list shows the same number');
          const rec0 = genRecord(seed, s.path, new DeltaStore());
          assert.equal(rec0.fields.find((f) => f.label === 'population')!.value, view.population);
          l.advanceTo(52 * 150);
          const rec = genRecord(seed, s.path, new DeltaStore(), { tick: l.week * TICKS_PER_WEEK, life: l });
          const f = (k: string) => rec.fields.find((x) => x.label === k)!.value;
          assert.equal(f('population'), f('residents'), 'population equals the residents shown, after any time');
          const applied = applyLife(view, l);
          assert.equal(applied.population, l.living);
          assert.equal(applied.dwellings.reduce((n, x) => n + x.residents, 0), applied.population, 'the residents shown add up to the population');
          checked++;
        }
      }
    }
    assert.ok(checked > 5, 'some settlements checked');
  }

  // Entrances and footpaths: every building has a door on its edge that opens onto a road, the plaza or a track (a footpath is carved
  // from a landlocked one; one nothing can reach is not built).
  {
    let all = 0;
    for (const sd of ['alpha', 'beta', 'first-light']) {
      for (let si = 0; si < 6; si++) {
        for (const sbi of settledBodyIndexes(sd, si)) {
          for (const st of bodySites(sd, si, sbi)) {
            const v = genSite(sd, si, sbi, st.index, new DeltaStore());
            const full = v.cells.slice(); // every path laid, standing or not
            for (const d of v.dwellings) for (const e of d.track ?? []) full[e >> 3] = 5;
            for (const d of v.dwellings) {
              all++;
              const { x, y, side } = d.door;
              assert.ok(x >= d.x && x < d.x + d.w && y >= d.y && y < d.y + d.h, 'the door is a cell of the building');
              const edge = side === 0 ? y === d.y : side === 1 ? x === d.x + d.w - 1 : side === 2 ? y === d.y + d.h - 1 : x === d.x;
              assert.ok(edge, 'the door cell is on the side it faces');
              const ox = x + [0, 1, 0, -1][side]!;
              const oy = y + [-1, 0, 1, 0][side]!;
              // Standing at tick 0: the door must face a street that is drawn. Finished later: that, or its own path.
              const own = (d.track ?? []).some((e) => e >> 3 === oy * v.w + ox);
              const code = ox < 0 || oy < 0 || ox >= v.w || oy >= v.h ? -1 : d.built || !own ? v.cells[oy * v.w + ox]! : full[oy * v.w + ox]!;
              assert.ok(code === 1 || code === 2 || code === 5, `${d.path} has a road, plaza or track at its door`);
            }
          }
        }
      }
    }
    assert.ok(all > 1000, 'buildings checked');
  }

  // Housing capacity and growth: nobody starts or lives in a home past its footprint; homes only ever grow, one cell at
  // a time, into free ground touching them, never over a road, water, the plaza or another building; works and the
  // hall stay as built.
  {
    let grew = 0;
    let homes = 0;
    let bent = 0;
    for (const s of ['alpha', 'beta', 'gamma']) {
      for (const b of settledBodyIndexes(s, 0)) {
        for (const st of bodySites(s, 0, b)) {
          const sd = siteLifeSeed(s, 0, b, st.index);
          const l = new SiteLife(s, sd);
          sd.dwellings.forEach((dw, i) => {
            if (dw.kind === 'home' || dw.kind === 'shop') assert.ok(dw.residents <= l.capacity(i), 'a home starts within its capacity');
          });
          for (let y = 1; y <= 100; y++) {
            l.advanceTo(52 * y);
            sd.dwellings.forEach((_, i) => assert.ok(l.residents(i).length <= l.capacity(i), `${s} ${st.path} d${i} year ${y}: over capacity`));
          }
          const n = sd.grid.n;
          const taken = new Map<number, number>();
          let owner = -1;
          const claim = (x: number, y: number) => {
            const key = y * n + x;
            assert.equal(taken.has(key), false, 'two buildings never share a cell');
            taken.set(key, owner);
            return key;
          };
          const added: [number, number, number][] = [];
          sd.dwellings.forEach((dw, i) => {
            owner = i;
            const own = new Set<number>();
            for (let y = dw.y; y < dw.y + dw.h; y++) for (let x = dw.x; x < dw.x + dw.w; x++) own.add(claim(x, y));
            const ext = l.extension(i);
            if (dw.kind !== 'home') assert.equal(ext.length, 0, 'only homes grow');
            else homes++;
            assert.ok(dw.w * dw.h + ext.length <= Math.max(16, dw.w * dw.h), 'growth is capped');
            assert.equal(l.capacity(i), dw.kind === 'works' || dw.kind === 'hall' ? 0 : Math.min(10, 2 + Math.floor((dw.w * dw.h + ext.length) / 2)));
            if (ext.length > 0) grew++;
            // Each added cell is free ground or garden and touches the building as it stood when the cell was added.
            const cells = new Set(own);
            for (const c of ext) {
              const key = claim(c.x, c.y);
              assert.ok([0, 3].includes(sd.grid.cells[key]!), 'a home grows only onto ground or garden');
              const pl = dw.plot!;
              assert.ok(c.x >= pl.x && c.y >= pl.y && c.x < pl.x + pl.w && c.y < pl.y + pl.h, 'a home grows only inside its plot');
              const touches = [key - 1, key + 1, key - n, key + n].some((k) => cells.has(k) && Math.abs((k % n) - c.x) + Math.abs(Math.floor(k / n) - c.y) === 1);
              assert.ok(touches, 'a new cell touches its building on a side');
              cells.add(key);
              added.push([i, c.x, c.y]);
            }
            const xs = [...cells].map((k) => k % n);
            const ys = [...cells].map((k) => Math.floor(k / n));
            const bbox = (Math.max(...xs) - Math.min(...xs) + 1) * (Math.max(...ys) - Math.min(...ys) + 1);
            if (bbox > cells.size) bent++;
          });
          // No pockets: no open cell beside a grown cell is closed in on three or more sides by buildings (its own or others').
          for (const [, x, y] of added) {
            for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
              const fx = x + dx;
              const fy = y + dy;
              if (fx < 0 || fy < 0 || fx >= n || fy >= n || taken.has(fy * n + fx)) continue;
              const closed = [[0, -1], [1, 0], [0, 1], [-1, 0]].filter(([ex, ey]) => taken.has((fy + ey!) * n + (fx + ex!)) && fx + ex! >= 0 && fx + ex! < n).length;
              assert.ok(closed < 3, 'a grown home leaves no pocket');
            }
          }
          // A grown cell never has another building beside it, corners included.
          for (const [i, x, y] of added) {
            for (let dy = -1; dy <= 1; dy++) {
              for (let dx = -1; dx <= 1; dx++) {
                if (x + dx < 0 || x + dx >= n || y + dy < 0 || y + dy >= n) continue;
                const o = taken.get((y + dy) * n + (x + dx));
                assert.ok(o === undefined || o === i, 'grown homes never join another building');
              }
            }
          }
        }
      }
    }
    // A full home grows only after 13 full weeks in a row: a tiny full home, many seeds, none by week 12, some by 14.
    {
      const tiny: SiteLifeSeed = {
        path: 's0/b0/t0',
        dwellings: [{ path: 's0/b0/t0/d0', kind: 'home', residents: 3, x: 2, y: 2, w: 2, h: 1 }],
        grid: { n: 8, cells: new Uint8Array(64) },
      };
      let early = 0;
      let late = 0;
      let finished = 0;
      for (let k = 0; k < 40; k++) {
        const l = new SiteLife(`tiny${k}`, tiny);
        l.advanceTo(12);
        if (l.extension(0).length > 0) early++;
        l.advanceTo(14);
        if (l.extension(0).length > 0) late++;
        // A home that took a cell finishes the notch of its outline within a few weeks, full or not: 2x1 becomes 2x2.
        l.advanceTo(19);
        if (l.extension(0).length >= 2) {
          const xs = [2, 3, ...l.extension(0).map((c) => c.x)];
          const ys = [2, ...l.extension(0).map((c) => c.y)];
          if ((Math.max(...xs) - Math.min(...xs) + 1) * (Math.max(...ys) - Math.min(...ys) + 1) === 2 + l.extension(0).length) finished++;
        }
      }
      assert.ok(finished > late / 2, `a grown home fills the notch in its outline (${finished} of ${late})`);
      assert.equal(early, 0, 'no home grows before it has been full for 13 weeks');
      assert.ok(late > 10, `a full home grows after 13 weeks (${late} of 40)`);
    }
    assert.ok(grew > 0, `some homes grow over a century (${grew} of ${homes})`);
    assert.ok(bent > 0, 'grown homes are not all rectangles');
  }

  // Fast-forwarding a long time must stay cheap.
  const t0 = performance.now();
  new SiteLife(seed, data).advanceTo(52 * 150);
  assert.ok(performance.now() - t0 < 2000, 'a 150 year fast-forward takes under 2s');
}

// Later buildings: some plots are built on only as the years go (nobody lives there, no growth, until then); farmsteads stand
// outside the town; a jump to year N equals watching, and a built home fills with people.
{
  let later = 0;
  let farms = 0;
  let filled = 0;
  let standing = 0; // later buildings that stand at the end and are meant to hold people
  let reserved = 0; // plots held in reserve, and how many were built because homes were full
  let reserveUsed = 0;
  for (const s of ['alpha', 'beta', 'gamma', 'first-light']) {
    for (const b of settledBodyIndexes(s, 0)) {
      for (const st of bodySites(s, 0, b)) {
        const sd = siteLifeSeed(s, 0, b, st.index);
        const l = new SiteLife(s, sd);
        sd.dwellings.forEach((d, i) => {
          if ((d.built ?? 0) !== 0) {
            later++;
            assert.equal(d.residents, 0, 'a building not yet built holds nobody');
            assert.equal(l.isBuilt(i, 0), false);
          }
          // A farmstead: a home out in the country, on a plot of 30 cells or more.
          if (d.plot && d.plot.w * d.plot.h >= 30 && d.kind === 'home' && (d.built ?? 0) === 0 && d.residents > 0) {
            const px = d.plot.x + d.plot.w / 2 - sd.grid.n / 2;
            const py = d.plot.y + d.plot.h / 2 - sd.grid.n / 2;
            if (Math.hypot(px, py) > 9) farms++;
          }
        });
        // Watched week by week for one seed (and year by year for the rest): nobody lives in what is not built, and no home
        // is ever over capacity, including the week a home is finished.
        const weekly = s === 'alpha';
        for (let w = 1; w <= 52 * 300; w++) {
          if (!weekly && w % 52 !== 0) continue;
          l.advanceTo(w);
          sd.dwellings.forEach((_, i) => {
            if (!l.isBuilt(i)) assert.equal(l.residents(i).length, 0, 'nobody lives in what is not built yet');
            assert.ok(l.residents(i).length <= l.capacity(i), `${s} ${st.path} d${i} week ${w}: over capacity`);
          });
        }
        const view = applyLife(genSite(s, 0, b, st.index, new DeltaStore()), l);
        view.dwellings.forEach((d, i) => assert.equal(d.built, l.isBuilt(i), 'the view says which buildings stand'));
        view.dwellings.forEach((d) => {
          for (const e of d.track ?? []) assert.equal(view.cells[e >> 3] === 5, d.built, 'a path is drawn once its building stands');
        });
        sd.dwellings.forEach((d, i) => {
          if ((d.built ?? 0) !== 0 && l.isBuilt(i) && (d.kind === 'home' || d.kind === 'shop')) {
            standing++;
            if (l.residents(i).length > 0) filled++;
          }
          if (d.built === -1) {
            reserved++;
            if (l.isBuilt(i)) reserveUsed++;
          }
        });
        // The graphs end at the live numbers: totals so far, and the dwellings that stand.
        const lastOf = (kind: 'dwellings') => districtSeries(l, kind).at(-1)!.v;
        // Births and deaths are a rate per year: over the whole run the rate times the years is about the total.
        for (const [kind, total] of [['births', l.totals.births], ['deaths', l.totals.deaths]] as const) {
          const pts = districtSeries(l, kind);
          assert.ok(pts.length > 2 && pts.every((p) => p.v >= 0), 'a rate graph has points');
          assert.ok(Math.abs(pts.reduce((n, p, i) => n + p.v * (((p.t - (pts[i - 1]?.t ?? 0)) / TICKS_PER_WEEK) / 52), 0) - total) <= total * 0.02 + 8, `the ${kind} rate adds up to the total`);
        }
        assert.equal(lastOf('dwellings'), sd.dwellings.filter((_, i) => l.isBuilt(i)).length, 'the dwellings graph ends at what stands');
        const jump = new SiteLife(s, sd);
        jump.advanceTo(52 * 300);
        assert.equal(jump.living, l.living, 'jumping equals watching with later buildings');
        sd.dwellings.forEach((d, i) => {
          assert.deepEqual(jump.residents(i).map((p) => p.id), l.residents(i).map((p) => p.id), 'same people in every dwelling');
        });
      }
    }
  }
  // Over a thousand years some places fill every plot and some wither away (decline, plague); nobody lives in a ruin.
  let full = 0;
  let extinct = 0;
  for (const s of ['alpha', 'first-light']) {
    for (const b of settledBodyIndexes(s, 0)) {
      for (const st of bodySites(s, 0, b)) {
        const sd = siteLifeSeed(s, 0, b, st.index);
        const l = new SiteLife(s, sd);
        let peak = 0;
        for (let y = 100; y <= 1000; y += 100) {
          l.advanceTo(52 * y);
          peak = Math.max(peak, sd.dwellings.filter((_, i) => l.isBuilt(i)).length);
          sd.dwellings.forEach((_, i) => {
            if (!l.isBuilt(i)) assert.equal(l.residents(i).length, 0, 'nobody lives in a ruin');
          });
        }
        if (peak >= 0.9 * sd.dwellings.length) full++;
        if (l.living === 0) extinct++;
      }
    }
  }
  assert.ok(full > 0, `some place fills nearly every plot: ${full}`);
  assert.ok(extinct > 0, `some place dies out: ${extinct}`);
  assert.ok(later > 50, `later buildings: ${later}`);
  assert.ok(farms > 20, `farmsteads far from the center: ${farms}`);
  assert.ok(reserved > 0 && reserveUsed > 0 && reserveUsed < reserved, `reserve plots are built when needed, not all at once: ${reserveUsed}/${reserved}`);
  assert.ok(standing > 0 && filled > standing / 3, `built later buildings filled: ${filled}/${standing}`);
}

console.log(`ok: walked ${walked} settlements across 18 systems; names: ${names.join(' / ')}`);
