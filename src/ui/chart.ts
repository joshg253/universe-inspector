// A small line chart: one series, thin line, recessive grid, end value labeled, hover crosshair and tooltip.
import { DAY, MONTH, WEEK, YEAR } from '../core/time';
import { h } from './dom';

export interface ChartPoint {
  t: number;
  v: number;
}

const NS = 'http://www.w3.org/2000/svg';
const W = 320;
const H = 130;
const M0 = { l: 36, r: 12, t: 10, b: 22 };

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

/** Whole-number axis with a little headroom so a flat line still reads as a line. */
function yRange(points: ChartPoint[]): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of points) {
    if (!Number.isFinite(p.v)) continue;
    lo = Math.min(lo, p.v);
    hi = Math.max(hi, p.v);
  }
  const pad = Math.max(1, Math.ceil((hi - lo) * 0.15));
  return [Math.max(0, Math.floor(lo - pad)), Math.ceil(hi + pad)];
}

/** Spacings the time marks may use (in ticks = hours): days, a week, a month, a season, then years by 1-2-5. */
const STEPS = [DAY, 2 * DAY, WEEK, MONTH, 91 * DAY, YEAR];
for (let m = 1; m <= 1000; m *= 10) for (const k of [2, 5, 10]) if (k * m * YEAR > YEAR) STEPS.push(k * m * YEAR);

/** Round-number time marks inside (t0, t1): the smallest spacing that gives at most five of them. */
function timeMarks(t0: number, t1: number): { t: number; label: string }[] {
  let step = STEPS.find((s) => (t1 - t0) / s <= 5) ?? STEPS[STEPS.length - 1]!;
  while ((t1 - t0) / step > 5) step *= 2; // past the last tabled spacing: keep widening so there are never more than five
  const out: { t: number; label: string }[] = [];
  for (let t = Math.ceil((t0 + 1) / step) * step; t < t1; t += step) {
    out.push({ t, label: step >= YEAR ? `Y${Math.round(t / YEAR).toLocaleString('en-US')}` : `D${(Math.floor(t / DAY) + 1).toLocaleString('en-US')}` });
  }
  return out;
}

export interface ChartOptions {
  /** Draw the trailing average of the line (over about a sixth of the span). */
  avg?: { label: string };
  /** A second series on its own right-hand scale. */
  overlay?: { label: string; points: ChartPoint[] };
}

/** Trailing mean over the last `window` points (as many as exist at the start), a plain mean of the points. */
function trailingMean(points: ChartPoint[], window: number): ChartPoint[] {
  return points.map((p, i) => {
    const from = Math.max(0, i - window + 1);
    let sum = 0;
    for (let k = from; k <= i; k++) sum += points[k]!.v;
    return { t: p.t, v: sum / (i - from + 1) };
  });
}

/** Numbers read with thousands separators, the same everywhere. */
const num = (v: number): string => v.toLocaleString('en-US');

export function lineChart(title: string, points: ChartPoint[], fmtTime: (t: number) => string, opts: ChartOptions = {}): HTMLElement {
  const M = opts.overlay && opts.overlay.points.filter((p) => Number.isFinite(p.v)).length > 1 ? { ...M0, r: 30 } : M0;
  const box = h('div', { class: 'chart' });
  if (points.length < 2) {
    box.append(h('div', { class: 'hint' }, 'History appears once the simulation has run for a few weeks.'));
    return box;
  }
  const [lo, hi] = yRange(points);
  const t0 = points[0]!.t;
  const t1 = points[points.length - 1]!.t;
  const X = (t: number) => M.l + ((t - t0) / Math.max(1, t1 - t0)) * (W - M.l - M.r);
  const Y = (v: number) => M.t + (1 - (v - lo) / Math.max(1, hi - lo)) * (H - M.t - M.b);

  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart-svg', role: 'img' });
  const last = points[points.length - 1]!;
  root.setAttribute('aria-label', `${title}: ${num(last.v)} at ${fmtTime(last.t)}, range ${num(lo)} to ${num(hi)}`);

  for (const v of [lo, (lo + hi) / 2, hi]) {
    root.append(svg('line', { x1: M.l, x2: W - M.r, y1: Y(v), y2: Y(v), class: 'chart-grid' }));
    const label = svg('text', { x: M.l - 5, y: Y(v) + 3, class: 'chart-text', 'text-anchor': 'end' });
    label.textContent = num(Math.round(v));
    root.append(label);
  }
  const xl = svg('text', { x: M.l, y: H - 6, class: 'chart-text' });
  xl.textContent = fmtTime(t0);
  const xr = svg('text', { x: W - M.r, y: H - 6, class: 'chart-text', 'text-anchor': 'end' });
  xr.textContent = fmtTime(t1);
  root.append(xl, xr);

  // Time marks: faint dashed lines up through the plot with a short label under each (skipped where they would
  // run into the end labels).
  for (const m of timeMarks(t0, t1)) {
    const x = X(m.t);
    root.append(svg('line', { x1: x, x2: x, y1: M.t, y2: H - M.b, class: 'chart-tick' }));
    if (x > M.l + 36 && x < W - M.r - 52) {
      const lab = svg('text', { x, y: H - 6, class: 'chart-text', 'text-anchor': 'middle' });
      lab.textContent = m.label;
      root.append(lab);
    }
  }

  // Overlay on its own scale, labeled on the right edge, and the trailing average of the main line on the same scale.
  const legend: [string, string][] = [];
  const ov = opts.overlay && opts.overlay.points.filter((p) => Number.isFinite(p.v)).length > 1 ? opts.overlay.points : null;
  if (ov) {
    const [olo, ohi] = yRange(ov);
    const OY = (v: number) => M.t + (1 - (v - olo) / Math.max(1, ohi - olo)) * (H - M.t - M.b);
    // A point with no value (nobody alive) ends the segment: the line is not drawn across the gap.
    let od = '';
    let pen = false;
    for (const p of ov) {
      if (!Number.isFinite(p.v)) {
        pen = false;
        continue;
      }
      od += `${pen ? ' L' : 'M'}${X(p.t)},${OY(p.v)}`;
      pen = true;
    }
    root.append(svg('path', { d: od, class: 'chart-over' }));
    for (const v of [olo, ohi]) {
      const l = svg('text', { x: W - M.r + 4, y: OY(v) + 3, class: 'chart-text chart-over-text' });
      l.textContent = num(Math.round(v));
      root.append(l);
    }
    legend.push(['over', opts.overlay!.label]);
  }
  if (opts.avg) {
    const win = Math.max(3, Math.ceil(points.length / 6));
    const avg = trailingMean(points, win);
    let ad = `M${X(avg[0]!.t)},${Y(avg[0]!.v)}`;
    for (let i = 1; i < avg.length; i++) ad += ` L${X(avg[i]!.t)},${Y(avg[i]!.v)}`;
    root.append(svg('path', { d: ad, class: 'chart-avg' }));
    legend.push(['avg', opts.avg.label]);
  }

  // Step line: a headcount holds its value until the next birth or death.
  let d = `M${X(points[0]!.t)},${Y(points[0]!.v)}`;
  for (let i = 1; i < points.length; i++) d += ` H${X(points[i]!.t)} V${Y(points[i]!.v)}`;
  root.append(svg('path', { d, class: 'chart-line' }));

  const endLabel = svg('text', { x: X(last.t) - 4, y: Y(last.v) - 6, class: 'chart-value', 'text-anchor': 'end' });
  endLabel.textContent = num(last.v);
  root.append(endLabel);

  const cross = svg('line', { y1: M.t, y2: H - M.b, class: 'chart-cross' });
  const dot = svg('circle', { r: 4, class: 'chart-dot' });
  cross.style.display = dot.style.display = 'none';
  root.append(cross, dot);

  const tip = h('div', { class: 'chart-tip' });
  tip.style.display = 'none';

  root.addEventListener('pointermove', (e) => {
    const r = root.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    let best = points[0]!;
    for (const p of points) if (Math.abs(X(p.t) - px) < Math.abs(X(best.t) - px)) best = p;
    cross.setAttribute('x1', String(X(best.t)));
    cross.setAttribute('x2', String(X(best.t)));
    dot.setAttribute('cx', String(X(best.t)));
    dot.setAttribute('cy', String(Y(best.v)));
    cross.style.display = dot.style.display = '';
    tip.textContent = `${fmtTime(best.t)}: ${num(best.v)}`;
    tip.style.display = '';
    const left = (X(best.t) / W) * r.width;
    tip.style.left = `${Math.min(Math.max(left, 40), r.width - 40)}px`;
  });
  root.addEventListener('pointerleave', () => {
    cross.style.display = dot.style.display = tip.style.display = 'none';
  });

  if (legend.length > 0) {
    box.append(h('div', { class: 'chart-legend' }, ...legend.map(([k, label]) => h('span', { class: 'lg-' + k }, label))));
  }
  box.append(root, tip);
  return box;
}
