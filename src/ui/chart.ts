// A small line chart: one series, thin line, recessive grid, end value labeled, hover crosshair and tooltip.
import { h } from './dom';

export interface ChartPoint {
  t: number;
  v: number;
}

const NS = 'http://www.w3.org/2000/svg';
const W = 320;
const H = 130;
const M = { l: 36, r: 12, t: 10, b: 22 };

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
    lo = Math.min(lo, p.v);
    hi = Math.max(hi, p.v);
  }
  const pad = Math.max(1, Math.ceil((hi - lo) * 0.15));
  return [Math.max(0, Math.floor(lo - pad)), Math.ceil(hi + pad)];
}

export function lineChart(title: string, points: ChartPoint[], fmtTime: (t: number) => string): HTMLElement {
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
  root.setAttribute('aria-label', `${title}: ${last.v} at ${fmtTime(last.t)}, range ${lo} to ${hi}`);

  for (const v of [lo, (lo + hi) / 2, hi]) {
    root.append(svg('line', { x1: M.l, x2: W - M.r, y1: Y(v), y2: Y(v), class: 'chart-grid' }));
    const label = svg('text', { x: M.l - 5, y: Y(v) + 3, class: 'chart-text', 'text-anchor': 'end' });
    label.textContent = String(Math.round(v));
    root.append(label);
  }
  const xl = svg('text', { x: M.l, y: H - 6, class: 'chart-text' });
  xl.textContent = fmtTime(t0);
  const xr = svg('text', { x: W - M.r, y: H - 6, class: 'chart-text', 'text-anchor': 'end' });
  xr.textContent = fmtTime(t1);
  root.append(xl, xr);

  // Step line: a headcount holds its value until the next birth or death.
  let d = `M${X(points[0]!.t)},${Y(points[0]!.v)}`;
  for (let i = 1; i < points.length; i++) d += ` H${X(points[i]!.t)} V${Y(points[i]!.v)}`;
  root.append(svg('path', { d, class: 'chart-line' }));

  const endLabel = svg('text', { x: X(last.t) - 4, y: Y(last.v) - 6, class: 'chart-value', 'text-anchor': 'end' });
  endLabel.textContent = String(last.v);
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
    tip.textContent = `${fmtTime(best.t)}: ${best.v}`;
    tip.style.display = '';
    const left = (X(best.t) / W) * r.width;
    tip.style.left = `${Math.min(Math.max(left, 40), r.width - 40)}px`;
  });
  root.addEventListener('pointerleave', () => {
    cross.style.display = dot.style.display = tip.style.display = 'none';
  });

  box.append(root, tip);
  return box;
}
