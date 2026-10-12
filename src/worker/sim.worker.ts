// Runs generation and the tick loop off the main thread.
import { Sim, dynFor } from '../core/sim';
import { genBody, genRecord, genSite, genSystem, genUniverse } from '../core/generate';
import { applyLife } from '../core/life';
import { parsePath, sitePathOf } from '../core/path';
import { LEVELS, SPEED_GLYPHS, speedTps, type FromWorker, type ToWorker } from '../core/protocol';
import type { SimEvent, View } from '../core/types';

const ctx = self as unknown as {
  postMessage(message: FromWorker): void;
  onmessage: ((e: MessageEvent<ToWorker>) => void) | null;
};

let sim = new Sim('universe');
let view: View | null = null;
let speedIdx = 0;
let acc = 0;
let last = performance.now();
let evBuf: SimEvent[] = [];
let dirty = false;
let tpsCount = 0;
let tpsT0 = performance.now();
let tps = 0;
let recordPath: string | null = null;
let seenLifeVersion = 0;

function buildView(path: string): View {
  const segs = parsePath(path);
  if (segs.length === 0) return genUniverse(sim.seed, sim.deltas);
  const s = segs[0]?.i ?? 0;
  if (segs.length <= 1) return genSystem(sim.seed, s, sim.deltas);
  const b = segs[1]?.i ?? 0;
  if (segs.length === 2) return genBody(sim.seed, s, b, sim.deltas);
  const site = genSite(sim.seed, s, b, segs[2]?.i ?? 0, sim.deltas);
  const life = sim.lifeFor(site.path);
  return life ? applyLife(site, life) : site;
}

function recordFor(path: string) {
  return genRecord(sim.seed, path, sim.deltas, { tick: sim.tick, life: sim.lifeFor(path) });
}

/** When a watched district's population changed, push fresh counts and the open record. */
function refreshLive(): void {
  if (sim.lifeVersion === seenLifeVersion) return;
  seenLifeVersion = sim.lifeVersion;
  if (view?.level === 'site') {
    view = buildView(view.path);
    postView();
  }
  if (recordPath && sitePathOf(recordPath)) ctx.postMessage({ type: 'record', record: recordFor(recordPath) });
}

function postView(): void {
  if (view) ctx.postMessage({ type: 'view', view });
}

function postTick(): void {
  if (evBuf.length > 200) evBuf = evBuf.slice(-200);
  ctx.postMessage({
    type: 'tick',
    tick: sim.tick,
    dyn: view ? dynFor(view, sim.tick, sim.seed) : null,
    events: evBuf,
    tps,
    speed: speedIdx,
  });
  evBuf = [];
  dirty = false;
}

function runTicks(n: number, countRate = true): void {
  const evs = sim.advance(n);
  for (const e of evs) evBuf.push(e);
  if (countRate) tpsCount += n;
  dirty = true;
  refreshLive();
}

function fail(e: unknown): void {
  ctx.postMessage({ type: 'error', message: e instanceof Error ? e.message : String(e) });
}

setInterval(() => {
  const now = performance.now();
  const dt = (now - last) / 1000;
  last = now;
  const target = speedTps(view ? LEVELS.indexOf(view.level) : 0, speedIdx);
  if (target > 0) {
    acc += target * dt;
    let n = Math.floor(acc);
    acc -= n;
    n = Math.min(n, 20_000_000); // a long span is jumped (see Sim.advance), so this stays cheap
    if (n > 0) runTicks(n);
  }
  if (now - tpsT0 >= 1000) {
    tps = (tpsCount * 1000) / (now - tpsT0);
    tpsCount = 0;
    tpsT0 = now;
    dirty = true;
  }
  if (dirty) postTick();
}, 50);

ctx.onmessage = (e) => {
  const msg = e.data;
  try {
    switch (msg.type) {
      case 'reset':
        sim = new Sim(msg.seed);
        seenLifeVersion = 0;
        recordPath = null;
        view = null;
        acc = 0;
        evBuf = [];
        tpsCount = 0;
        tps = 0;
        postTick();
        break;
      case 'view':
        sim.setFocusFromPath(msg.path);
        view = buildView(msg.path);
        postView();
        postTick();
        break;
      case 'record':
        recordPath = msg.path;
        ctx.postMessage({ type: 'record', record: recordFor(msg.path) });
        break;
      case 'step':
        runTicks(Math.max(1, Math.min(10_000_000, msg.n ?? 1)), false);
        postTick();
        break;
      case 'speed':
        speedIdx = Math.max(0, Math.min(SPEED_GLYPHS.length - 1, msg.index));
        acc = 0;
        dirty = true;
        break;
      case 'delta':
        sim.deltas.patch(msg.path, msg.patch);
        if (view) {
          view = buildView(view.path);
          postView();
        }
        ctx.postMessage({ type: 'record', record: recordFor(msg.path) });
        break;
    }
  } catch (err) {
    fail(err);
  }
};
