// Core invariants, run with `npm test`. No browser needed: core/ has no DOM.
import assert from 'node:assert/strict';
import { DeltaStore } from '../src/core/deltas';
import { bodySites, genBody, genRecord, genSite, genSystem, genUniverse, settledBodyIndexes, siteLifeSeed } from '../src/core/generate';
import { SiteLife, TICKS_PER_YEAR, TICKS_PER_WEEK, ageAt, livingSeries } from '../src/core/life';
import { viewLevel } from '../src/core/path';
import { layoutTown } from '../src/core/town';
import { rngFor } from '../src/core/rng';
import { Sim, dynFor } from '../src/core/sim';
import { packOf, PACKS } from '../src/packs';

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
  const snapshot = (l: SiteLife) => json(l.people);

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

  // Parentage: every newborn has a mother and a father, and the pair are not close kin.
  for (const p of stepped.people.filter((q) => q.mother !== null)) {
    const mom = stepped.people[p.mother!]!;
    const dad = stepped.people[p.father!]!;
    assert.equal(mom.sex, 'f');
    assert.equal(dad.sex, 'm');
    assert.ok(dad.mother !== mom.id && dad.father !== mom.id, "father is not the mother's child");
    assert.ok(mom.mother !== dad.id && mom.father !== dad.id, "mother is not the father's child");
    assert.ok(!(mom.mother !== null && mom.mother === dad.mother), 'parents are not siblings');
    assert.ok(!(mom.father !== null && mom.father === dad.father), 'parents are not half-siblings');
  }

  // Everyone lives somewhere real, and no building is over capacity once settled.
  const occupancy = new Map<number, number>();
  for (const p of stepped.people) {
    assert.ok(p.residence >= 0 && p.residence < data.dwellings.length);
    if (p.deathTick === null) occupancy.set(p.residence, (occupancy.get(p.residence) ?? 0) + 1);
    if (p.moves.length > 0) assert.equal(data.dwellings[p.residence]!.kind === 'home' || p.residence === p.origin, true);
  }
  assert.ok(Math.max(...occupancy.values()) <= 10, 'no dwelling holds more than ten people');

  // Age is the rolled age at tick 0 and goes up one per year.
  const d0 = data.dwellings.findIndex((x) => x.ages.length > 0);
  const p0 = new SiteLife(seed, data).person(d0, 0)!;
  assert.equal(ageAt(p0, 0), data.dwellings[d0]!.ages[0]);
  assert.equal(ageAt(p0, 5 * TICKS_PER_YEAR), data.dwellings[d0]!.ages[0]! + 5);

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

  // Fast-forwarding a long time must stay cheap.
  const t0 = performance.now();
  new SiteLife(seed, data).advanceTo(52 * 150);
  assert.ok(performance.now() - t0 < 2000, 'a 150 year fast-forward takes under 2s');
}

console.log(`ok: walked ${walked} settlements across 18 systems; names: ${names.join(' / ')}`);
