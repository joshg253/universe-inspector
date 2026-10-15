// The zoomable map. One canvas, three renderers (system / body / site).
// Each draw pass records the clickable things it drew, so hit-testing always
// matches what is on screen (hidden layers are not clickable).
import type { BodyView, DwellingSummary, Dyn, FeatureId, SiteView, SystemView, UniverseView, View } from '../core/types';
import type { Pack } from '../packs/types';
import { TICKS_PER_WEEK, TICKS_PER_YEAR } from '../core/life';
import { h } from './dom';

export interface MapHooks {
  onSelect(path: string | null): void;
  onOpen(path: string): void;
  onLens?(lens: Lens): void;
}

/** How buildings are colored in a district: by what they are, how old they are, or how full they are. */
export type Lens = 'kind' | 'age' | 'fill' | 'water' | 'soil' | 'timber' | 'stone';
/** District lenses color buildings; planet lenses color the terrain by what each cell holds. 'kind' is the plain view of both. */
export const LENSES: Lens[] = ['kind', 'age', 'fill'];
export const PLANET_LENSES: Lens[] = ['kind', 'water', 'soil', 'timber', 'stone'];
/** none .. plentiful, per layer (water: none, fresh, salt). */
const LAYER_RAMPS: Record<'water' | 'soil' | 'timber' | 'stone', string[]> = {
  water: ['#3a3a3a', '#46b6e8', '#1d4f9c'],
  soil: ['#3a3a3a', '#a89060', '#8a6a34', '#5e3f18'],
  timber: ['#3a3a3a', '#a8c070', '#5f9a3c', '#2a6a22'],
  stone: ['#3a3a3a', '#b8b8b8', '#8a8a8a', '#5a5a64'],
};
const RATING_IDS = ['none', 'scarce', 'fair', 'plentiful'];

/** Age bins in years (upper bound exclusive), oldest last. Warm and dark with age. */
const AGE_BINS: [number, string][] = [
  [10, '#ffe08a'],
  [30, '#f5b64a'],
  [80, '#d9822b'],
  [200, '#a8501f'],
  [Infinity, '#6b2d14'],
];
/** Fill bins: share of capacity used. Buildings that hold nobody by design (works, hall) stay neutral. */
const FILL_BINS: [number, string][] = [
  [0.001, '#4a4a52'],
  [0.5, '#8fb8d8'],
  [1, '#4f8fc0'],
  [Infinity, '#1f5f9f'],
];
const NEUTRAL = '#777777';
/** Buildings that stood before the run began. */
const ORIGINAL = '#8a7fb0';

interface HitItem {
  path: string;
  x: number;
  y: number;
  r: number; // circle radius in px
  w?: number; // rect size in px (if set, the item is a rect with top-left x,y)
  h?: number;
}

const TAU = Math.PI * 2;
/** Night shading. Near-neutral on purpose: a blue tint over grey rock reads as ocean. */
const NIGHT_TINT = '8,8,14';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Every cell a dwelling covers: its rectangle, then the cells it has grown into. */
function footprint(d: { x: number; y: number; w: number; h: number; extra?: { x: number; y: number }[] }): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let y = 0; y < d.h; y++) for (let x = 0; x < d.w; x++) out.push({ x: d.x + x, y: d.y + y });
  return d.extra ? out.concat(d.extra) : out;
}

/**
 * Stroke the outer edge of a set of cells (no lines between its own cells). `inset` moves each edge toward the inside
 * (0.5 for a crisp 1px line on the cell border) or, when negative, outside it (a halo); edges run the full cell length,
 * and a halo's ends are extended so its corners meet.
 */
function outline(
  ctx: CanvasRenderingContext2D,
  cells: { x: number; y: number }[],
  X: (v: number) => number,
  Y: (v: number) => number,
  inset: number,
): void {
  const has = new Set(cells.map((c) => c.y * 4096 + c.x));
  const e = Math.max(0, -inset);
  ctx.beginPath();
  for (const { x, y } of cells) {
    const x0 = X(x);
    const y0 = Y(y);
    const x1 = X(x + 1);
    const y1 = Y(y + 1);
    if (!has.has((y - 1) * 4096 + x)) { ctx.moveTo(x0 - e, y0 + inset); ctx.lineTo(x1 + e, y0 + inset); }
    if (!has.has((y + 1) * 4096 + x)) { ctx.moveTo(x0 - e, y1 - inset); ctx.lineTo(x1 + e, y1 - inset); }
    if (!has.has(y * 4096 + x - 1)) { ctx.moveTo(x0 + inset, y0 - e); ctx.lineTo(x0 + inset, y1 + e); }
    if (!has.has(y * 4096 + x + 1)) { ctx.moveTo(x1 - inset, y0 - e); ctx.lineTo(x1 - inset, y1 + e); }
  }
  ctx.stroke();
}

export class MapCanvas {
  readonly root: HTMLDivElement;
  pack: Pack;
  marks: Record<string, boolean> = {};
  features: Record<FeatureId, boolean> = { anomalies: true, inhabitants: true, economy: true };
  sel: string | null = null;
  lens: Lens = 'kind';

  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private view: View | null = null;
  private dyn: Dyn | null = null;
  private off: HTMLCanvasElement | null = null;
  private scale = 1;
  private ox = 0;
  private oy = 0;
  private cssW = 0;
  private cssH = 0;
  private dpr = 1;
  private hover: string | null = null;
  private hits: HitItem[] = [];
  private drag: { x: number; y: number; ox: number; oy: number; moved: boolean } | null = null;
  private raf = 0;
  private legend: HTMLElement;
  private lensSel: HTMLSelectElement;
  private week = 0;
  private tip: HTMLElement;

  constructor(pack: Pack, private hooks: MapHooks) {
    this.pack = pack;
    this.canvas = h('canvas', { class: 'map-canvas' });
    this.ctx = this.canvas.getContext('2d')!;
    const btn = (label: string, title: string, fn: () => void) => h('button', { title, onclick: fn }, label);
    this.lensSel = h('select', { title: 'Color by', 'aria-label': 'Color by', onchange: () => this.setLens(this.lensSel.value as Lens) });
    const buttons = h(
      'div',
      { class: 'mapbtns' },
      this.lensSel,
      btn('+', 'Zoom in', () => this.zoomAt(1.4, this.cssW / 2, this.cssH / 2)),
      btn('-', 'Zoom out', () => this.zoomAt(1 / 1.4, this.cssW / 2, this.cssH / 2)),
      btn('Fit', 'Fit to window', () => this.fit()),
    );
    this.legend = h('div', { class: 'maplegend' });
    this.tip = h('div', { class: 'maptip' });
    this.root = h('div', { class: 'mapwrap' }, this.canvas, buttons, this.legend, this.tip);

    new ResizeObserver(() => this.resize()).observe(this.root);
    this.canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    this.canvas.addEventListener('pointermove', (e) => this.onMove(e));
    this.canvas.addEventListener('pointerup', (e) => this.onUp(e));
    this.canvas.addEventListener('pointerleave', () => {
      this.tip.style.display = 'none';
      if (!this.drag && this.hover) {
        this.hover = null;
        this.redraw();
      }
    });
    this.canvas.addEventListener('dblclick', (e) => {
      const hit = this.hitTest(...this.local(e));
      if (hit) hooks.onOpen(hit.path);
    });
    this.canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const [x, y] = this.local(e);
        this.zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, x, y);
      },
      { passive: false },
    );
  }

  // ------------------------------------------------------------- state in

  setView(view: View): void {
    const same = this.view?.path === view.path;
    this.view = view;
    if (!same) {
      this.off = this.buildOffscreen(view);
      this.hover = null;
      this.fit(false);
    }
    this.redraw();
  }

  setLens(lens: Lens): void {
    this.lens = lens;
    this.lensSel.value = lens;
    this.hooks.onLens?.(lens);
    if (this.view?.level === 'body') this.off = this.buildOffscreen(this.view);
    this.redraw();
  }

  /** The week the run is at, for building age. */
  setWeek(week: number): void {
    if (week === this.week) return;
    this.week = week;
    if (this.lens === 'age') this.redraw();
  }

  /** The lens the current map actually shows: a lens that belongs to the other kind of map counts as plain. */
  shownLens(): Lens {
    const level = this.view?.level;
    if (level !== 'site' && level !== 'body') return this.lens;
    return (level === 'body' ? PLANET_LENSES : LENSES).includes(this.lens) ? this.lens : 'kind';
  }

  /** The pack's words for the lens menu; rebuilt when the words change. */
  private renderLensMenu(): void {
    const planet = this.view?.level === 'body';
    const list = planet ? PLANET_LENSES : LENSES;
    const word = (l: Lens) => this.pack.t(planet && l === 'kind' ? 'lens.terrain' : 'lens.' + l);
    const key = (planet ? 'p:' : 's:') + list.map(word).join('|');
    if (this.lensSel.dataset.key !== key) {
      this.lensSel.dataset.key = key;
      this.lensSel.replaceChildren(...list.map((l) => h('option', { value: l }, word(l))));
    }
    this.lensSel.value = list.includes(this.lens) ? this.lens : 'kind';
  }

  /** The color a building gets under the current lens. */
  private lensColor(d: DwellingSummary): string {
    if (this.lens === 'age') {
      if (d.builtWeek <= 0) return ORIGINAL; // stood from the start: its real age is not known
      const years = ((this.week - d.builtWeek) * TICKS_PER_WEEK) / TICKS_PER_YEAR;
      return AGE_BINS.find(([max]) => years < max)![1];
    }
    if (this.lens === 'fill') {
      if (d.capacity <= 0) return NEUTRAL;
      const share = d.residents / d.capacity;
      return FILL_BINS.find(([max]) => share < max)![1];
    }
    return this.pack.palette.dwelling[d.kind];
  }

  setDyn(dyn: Dyn | null): void {
    this.dyn = dyn;
    this.redraw();
  }

  redraw(): void {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.draw();
    });
  }

  // ------------------------------------------------------------ transform

  private resize(): void {
    const r = this.root.getBoundingClientRect();
    const first = this.cssW === 0;
    this.dpr = window.devicePixelRatio || 1;
    this.cssW = Math.max(1, Math.floor(r.width));
    this.cssH = Math.max(1, Math.floor(r.height));
    this.canvas.width = Math.floor(this.cssW * this.dpr);
    this.canvas.height = Math.floor(this.cssH * this.dpr);
    this.canvas.style.width = `${this.cssW}px`;
    this.canvas.style.height = `${this.cssH}px`;
    if (first && this.view) this.fit(false);
    this.redraw();
  }

  private bounds(): { x0: number; y0: number; x1: number; y1: number } {
    const v = this.view;
    if (!v) return { x0: 0, y0: 0, x1: 1, y1: 1 };
    if (v.level === 'system' || v.level === 'universe') return { x0: -120, y0: -120, x1: 120, y1: 120 };
    return { x0: 0, y0: 0, x1: v.w, y1: v.h };
  }

  fit(redraw = true): void {
    const b = this.bounds();
    const pad = 16;
    const w = b.x1 - b.x0;
    const hgt = b.y1 - b.y0;
    this.scale = Math.max(0.5, Math.min((this.cssW - pad * 2) / w, (this.cssH - pad * 2) / hgt));
    this.ox = (this.cssW - w * this.scale) / 2 - b.x0 * this.scale;
    this.oy = (this.cssH - hgt * this.scale) / 2 - b.y0 * this.scale;
    if (redraw) this.redraw();
  }

  private zoomAt(factor: number, cx: number, cy: number): void {
    const next = Math.max(0.5, Math.min(160, this.scale * factor));
    const k = next / this.scale;
    this.ox = cx - (cx - this.ox) * k;
    this.oy = cy - (cy - this.oy) * k;
    this.scale = next;
    this.redraw();
  }

  // ---------------------------------------------------------------- input

  private local(e: MouseEvent): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  private onDown(e: PointerEvent): void {
    this.canvas.setPointerCapture(e.pointerId);
    this.drag = { x: e.clientX, y: e.clientY, ox: this.ox, oy: this.oy, moved: false };
  }

  private onMove(e: PointerEvent): void {
    if (this.drag) {
      this.tip.style.display = 'none';
      const dx = e.clientX - this.drag.x;
      const dy = e.clientY - this.drag.y;
      if (!this.drag.moved && Math.hypot(dx, dy) > 3) this.drag.moved = true;
      if (this.drag.moved) {
        this.ox = this.drag.ox + dx;
        this.oy = this.drag.oy + dy;
        this.canvas.style.cursor = 'grabbing';
        this.redraw();
      }
      return;
    }
    const hit = this.hitTest(...this.local(e));
    const path = hit?.path ?? null;
    this.canvas.style.cursor = hit ? 'pointer' : 'default';
    if (path !== this.hover) {
      this.hover = path;
      this.redraw();
    }
    this.showTip(path, ...this.local(e));
  }

  /** A small card beside the pointer: what a building or settlement is, who is in it, how old it is. */
  private showTip(path: string | null, x: number, y: number): void {
    const v = this.view;
    const lines: string[] = [];
    if (path && v?.level === 'site') {
      const d = v.dwellings.find((q) => q.path === path);
      if (d?.built) {
        lines.push(this.pack.name('dwelling', d.nameKey, d.kind));
        const room = d.capacity > 0 ? `${d.residents} of ${d.capacity}` : `${d.residents}`;
        lines.push(`${this.pack.t(`dwelling.${d.kind}`)} · ${d.w * d.h + (d.extra?.length ?? 0)} cells`);
        if (d.kind === 'home' || d.kind === 'shop') lines.push(`${room} ${d.capacity > 0 ? 'residents' : ''}`.trim());
        lines.push(d.builtWeek > 0 ? `Built year ${Math.floor((d.builtWeek * TICKS_PER_WEEK) / TICKS_PER_YEAR)}` : 'Stood from the start');
      }
    } else if (path && v?.level === 'universe') {
      const sys = v.systems.find((q) => q.path === path);
      if (sys) {
        const t = (k: string) => this.pack.t(k);
        lines.push(this.pack.name('system', sys.nameKey), t('star.' + sys.cls), `${sys.bodyCount} ${t('field.bodies').toLowerCase()}`);
      }
    } else if (path && v?.level === 'system') {
      const b = v.bodies.find((q) => q.path === path);
      if (b) {
        const t = (k: string) => this.pack.t(k);
        lines.push(this.pack.name('body', b.nameKey, b.kind), t('body.' + b.kind));
        if (b.kind !== 'gaseous') lines.push(`${t('field.surfaceWater')}: ${b.waterPct}%`);
        lines.push(`${b.siteCount} ${t('field.sites').toLowerCase()}`);
      }
    } else if (path && v?.level === 'body') {
      const s = v.sites.find((q) => q.path === path);
      if (s) {
        const t = (k: string) => this.pack.t(k);
        lines.push(this.pack.name('site', s.nameKey, s.size), `${t(`size.${s.size}`)} · ${s.population.toLocaleString('en-US')} people`);
        const a = s.around;
        const water = a.fresh > 0 && a.salt > 0 ? 'both' : a.fresh > 0 ? 'fresh' : 'salt';
        lines.push(`${t('field.water')}: ${t('water.' + water)}`);
        for (const k of ['soil', 'timber', 'stone', 'fish'] as const) lines.push(`${t('field.' + k)}: ${t('rating.' + RATING_IDS[a[k]])}`);
      }
    }
    if (!path && v?.level === 'body' && v.kind !== 'gaseous') {
      // Open ground: what the cell is and what it holds.
      const cx = Math.floor((x - this.ox) / this.scale);
      const cy = Math.floor((y - this.oy) / this.scale);
      if (cx >= 0 && cy >= 0 && cx < v.w && cy < v.h) {
        const i = cy * v.w + cx;
        const t = (k: string) => this.pack.t(k);
        lines.push(t('terrain.' + v.cells[i]));
        const water = v.layers.water[i]!;
        if (water > 0) lines.push(t('field.water') + ': ' + t(water === 1 ? 'water.fresh' : 'water.salt'));
        for (const k of ['soil', 'timber', 'stone'] as const) {
          const n = v.layers[k][i]!;
          if (n > 0) lines.push(t('field.' + k) + ': ' + t('rating.' + RATING_IDS[n]));
        }
      }
    }
    if (lines.length === 0) {
      this.tip.style.display = 'none';
      return;
    }
    this.tip.replaceChildren(...lines.map((t, i) => h(i === 0 ? 'b' : 'div', null, t)));
    this.tip.style.display = 'block';
    const w = this.root.clientWidth;
    this.tip.style.left = `${Math.min(x + 14, Math.max(0, w - 150))}px`;
    this.tip.style.top = `${Math.max(0, Math.min(y + 14, this.root.clientHeight - 140))}px`;
  }

  private onUp(e: PointerEvent): void {
    const d = this.drag;
    this.drag = null;
    this.canvas.style.cursor = 'default';
    if (d && !d.moved) {
      const hit = this.hitTest(...this.local(e));
      this.hooks.onSelect(hit?.path ?? null);
    }
  }

  private hitTest(x: number, y: number): HitItem | null {
    let best: HitItem | null = null;
    let bestD = Infinity;
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const it = this.hits[i]!;
      if (it.w !== undefined && it.h !== undefined) {
        if (x >= it.x - 1 && x <= it.x + it.w + 1 && y >= it.y - 1 && y <= it.y + it.h + 1) return it;
      } else {
        const d = Math.hypot(it.x - x, it.y - y);
        if (d <= it.r && d < bestD) {
          best = it;
          bestD = d;
        }
      }
    }
    return best;
  }

  private isSel(path: string): boolean {
    return this.sel !== null && (this.sel === path || this.sel.startsWith(`${path}/`));
  }

  // -------------------------------------------------------------- drawing

  private buildOffscreen(v: View): HTMLCanvasElement | null {
    if (v.level === 'system' || v.level === 'universe') return null;
    const c = document.createElement('canvas');
    c.width = v.w;
    c.height = v.h;
    const cx = c.getContext('2d')!;
    const img = cx.createImageData(v.w, v.h);
    const pal = this.pack.palette;
    if (v.level === 'body') {
      const colors = pal.terrain[v.kind].map(hexToRgb);
      const layer = this.planetLayer(v);
      if (layer) {
        const ramp = LAYER_RAMPS[layer.id].map(hexToRgb);
        for (let i = 0; i < v.cells.length; i++) {
          const on = layer.data[i]!;
          // Cells with none of it are the ramp's first color, the legend's "None".
          const c = ramp[on]!;
          img.data.set([c[0]!, c[1]!, c[2]!, 255], i * 4);
        }
        cx.putImageData(img, 0, 0);
        return c;
      }
      // Rock gets a little grain (display only, same every time) so a flat plateau never reads as open water.
      const grain = v.kind === 'barren' ? 7 : 0;
      for (let i = 0; i < v.cells.length; i++) {
        const [r, g, b] = colors[v.cells[i]!]!;
        const j = grain ? ((Math.imul(i, 2654435761) >>> 24) % (grain * 2 + 1)) - grain : 0;
        img.data.set([r + j, g + j, b + j, 255], i * 4);
      }
    } else {
      const ground = hexToRgb(pal.ground);
      const road = hexToRgb(pal.road);
      const track = road.map((v, k) => Math.round((v + hexToRgb(pal.ground)[k]!) / 2)); // a footpath: between road and ground
      const green = hexToRgb(pal.green);
      const plaza = hexToRgb(pal.plaza);
      const water = hexToRgb(pal.water);
      for (let i = 0; i < v.cells.length; i++) {
        const c0 = v.cells[i];
        const [r, g, b] = c0 === 1 ? road : c0 === 2 ? plaza : c0 === 3 ? green : c0 === 4 ? water : c0 === 5 ? track : ground;
        img.data.set([r, g, b, 255], i * 4);
      }
    }
    cx.putImageData(img, 0, 0);
    return c;
  }

  /** The resource layer the planet map shows, if a planet lens is chosen. */
  private planetLayer(v: View): { id: 'water' | 'soil' | 'timber' | 'stone'; data: Uint8Array } | null {
    if (v.level !== 'body' || v.kind === 'gaseous') return null;
    const id = this.lens;
    return id === 'water' || id === 'soil' || id === 'timber' || id === 'stone' ? { id, data: v.layers[id] } : null;
  }

  /** Call after the pack changes so palette colors are rebuilt. */
  rebuild(): void {
    if (this.view) this.off = this.buildOffscreen(this.view);
    this.redraw();
  }

  /** What the colors mean in a district; hidden on the other levels. */
  private drawLegend(v: View | null): void {
    this.lensSel.style.display = v?.level === 'site' || (v?.level === 'body' && v.kind !== 'gaseous') ? '' : 'none';
    this.renderLensMenu();
    const layer = v ? this.planetLayer(v) : null;
    const show = layer ? true : v?.level === 'site' && this.marks['site.legend'] !== false;
    this.legend.style.display = show ? '' : 'none';
    if (!show) return;
    const pal = this.pack.palette;
    const t = (k: string) => this.pack.t(k);
    if (layer) {
      const ramp = LAYER_RAMPS[layer.id];
      const names = layer.id === 'water' ? ['none', 'fresh', 'salt'] : RATING_IDS;
      const items = ramp.map((c, i): [string, string] => [c, t((layer.id === 'water' ? 'water.' : 'rating.') + names[i])]);
      const key = layer.id + items.map((i) => i.join('|')).join(';');
      if (this.legend.dataset.key === key) return;
      this.legend.dataset.key = key;
      this.legend.replaceChildren(...items.map(([c, label]) => h('span', { class: 'lg' }, h('i', { style: `background:${c}` }), label)));
      return;
    }
    const mid = (a: string, b: string) => {
      const x = hexToRgb(a);
      const y = hexToRgb(b);
      return `rgb(${x.map((c, i) => Math.round((c + y[i]!) / 2)).join(',')})`;
    };
    const bins = (list: [number, string][], label: (i: number) => string): [string, string][] =>
      list.map(([, c], i) => [c, label(i)]);
    const yr = t('lens.years');
    const kinds: [string, string][] =
      this.lens === 'age'
        ? [
            [ORIGINAL, t('lens.original')],
            ...bins(AGE_BINS, (i) => (i === AGE_BINS.length - 1 ? AGE_BINS[i - 1]![0] + '+ ' + yr : '< ' + AGE_BINS[i]![0] + ' ' + yr)),
          ]
        : this.lens === 'fill'
          ? [...bins(FILL_BINS, (i) => t('lens.fill' + i)), [NEUTRAL, t('lens.nobody')]]
          : [
              [pal.dwelling.home, t('dwelling.home')],
              [pal.dwelling.shop, t('dwelling.shop')],
              [pal.dwelling.works, t('dwelling.works')],
              [pal.dwelling.hall, t('dwelling.hall')],
            ];
    const items: [string, string][] = [
      ...kinds,
      [pal.road, t('legend.road')],
      [mid(pal.road, pal.ground), t('legend.track')],
      [pal.plaza, t('legend.plaza')],
      [pal.water, t('legend.water')],
      [pal.green, t('legend.green')],
    ];
    const key = items.map((i) => i.join('|')).join(';');
    if (this.legend.dataset.key === key) return;
    this.legend.dataset.key = key;
    this.legend.replaceChildren(
      ...items.map(([c, label]) => h('span', { class: 'lg' }, h('i', { style: `background:${c}` }), label)),
    );
  }

  private draw(): void {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = this.pack.palette.bg;
    ctx.fillRect(0, 0, this.cssW, this.cssH);
    this.hits = [];
    const v = this.view;
    this.drawLegend(v);
    if (!v) return;
    if (v.level === 'universe') this.drawUniverse(v);
    else if (v.level === 'system') this.drawSystem(v);
    else if (v.level === 'body') this.drawBody(v);
    else this.drawSite(v);
  }

  private label(text: string, x: number, y: number): void {
    const ctx = this.ctx;
    ctx.font = '11px Tahoma, Segoe UI, sans-serif';
    ctx.textBaseline = 'alphabetic';
    const w = ctx.measureText(text).width;
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(x - 2, y - 10, w + 4, 14);
    ctx.fillStyle = '#f0f0f0';
    ctx.fillText(text, x, y);
  }

  private drawUniverse(v: UniverseView): void {
    if (this.marks['universe.systems'] === false) return;
    const ctx = this.ctx;
    const pal = this.pack.palette;
    const s = this.scale;
    const RADIUS = { dim: 2.2, mid: 3, bright: 4 };
    for (const sys of v.systems) {
      const px = this.ox + sys.x * s;
      const py = this.oy + sys.y * s;
      const r = Math.max(RADIUS[sys.cls] * Math.sqrt(s), 3);
      const color = pal.star[sys.cls];
      const glow = ctx.createRadialGradient(px, py, r * 0.3, px, py, r * 3);
      glow.addColorStop(0, color);
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = 0.4;
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(px, py, r * 3, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, TAU);
      ctx.fill();
      if (sys.inspected) {
        ctx.fillStyle = '#5fd35f';
        ctx.beginPath();
        ctx.arc(px + r, py - r, 3, 0, TAU);
        ctx.fill();
      }
      if (this.isSel(sys.path)) {
        ctx.strokeStyle = pal.mark.selected;
        ctx.lineWidth = 2;
        ctx.strokeRect(px - r - 6, py - r - 6, (r + 6) * 2, (r + 6) * 2);
      }
      if (this.isSel(sys.path) || this.hover === sys.path || s >= 5) {
        this.label(this.pack.name('system', sys.nameKey), px + r + 6, py - r - 4);
      }
      this.hits.push({ path: sys.path, x: px, y: py, r: Math.max(r + 6, 10) });
    }
  }

  private drawSystem(v: SystemView): void {
    const ctx = this.ctx;
    const pal = this.pack.palette;
    const s = this.scale;
    const X = (wx: number) => this.ox + wx * s;
    const Y = (wy: number) => this.oy + wy * s;

    if (this.marks['system.orbits'] !== false) {
      ctx.strokeStyle = pal.orbit;
      ctx.lineWidth = 1;
      for (const b of v.bodies) {
        ctx.beginPath();
        ctx.arc(X(0), Y(0), b.orbit * s, 0, TAU);
        ctx.stroke();
      }
    }

    const sr = Math.max(v.star.radius * s, 5);
    const color = pal.star[v.star.cls];
    const glow = ctx.createRadialGradient(X(0), Y(0), sr * 0.4, X(0), Y(0), sr * 2.2);
    glow.addColorStop(0, color);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(X(0), Y(0), sr * 2.2, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(X(0), Y(0), sr, 0, TAU);
    ctx.fill();

    if (this.marks['system.bodies'] === false) return;
    const angles = this.dyn?.level === 'system' ? this.dyn.angles : v.bodies.map((b) => b.phase);
    v.bodies.forEach((b, i) => {
      const a = angles[i] ?? b.phase;
      const px = X(Math.cos(a) * b.orbit);
      const py = Y(Math.sin(a) * b.orbit);
      const r = Math.max(b.size * s, 3);
      ctx.fillStyle = pal.terrain[b.kind][3]!;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 1;
      ctx.stroke();
      if (this.marks['system.settled'] !== false && b.siteCount > 0) {
        ctx.strokeStyle = pal.mark.settled;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(px, py, r + 4, 0, TAU);
        ctx.stroke();
      }
      if (b.inspected) {
        ctx.fillStyle = '#5fd35f';
        ctx.beginPath();
        ctx.arc(px + r, py - r, 3, 0, TAU);
        ctx.fill();
      }
      if (this.isSel(b.path)) {
        ctx.strokeStyle = pal.mark.selected;
        ctx.lineWidth = 2;
        ctx.strokeRect(px - r - 6, py - r - 6, (r + 6) * 2, (r + 6) * 2);
      }
      if (this.isSel(b.path) || this.hover === b.path || s >= 5) {
        this.label(this.pack.name('body', b.nameKey, b.kind), px + r + 6, py - r - 4);
      }
      this.hits.push({ path: b.path, x: px, y: py, r: Math.max(r + 6, 10) });
    });
  }

  private drawGrid(v: BodyView | SiteView): void {
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false;
    if (this.off) ctx.drawImage(this.off, this.ox, this.oy, v.w * this.scale, v.h * this.scale);
  }

  private drawBody(v: BodyView): void {
    const ctx = this.ctx;
    const pal = this.pack.palette;
    const s = this.scale;
    const X = (wx: number) => this.ox + wx * s;
    const Y = (wy: number) => this.oy + wy * s;

    if (this.marks['body.terrain'] !== false) this.drawGrid(v);
    else {
      ctx.fillStyle = '#2a2a2e';
      ctx.fillRect(X(0), Y(0), v.w * s, v.h * s);
    }

    if (this.marks['body.night'] !== false && this.dyn?.level === 'body') {
      // One gradient across the map: per-column rects overlapped and double-darkened into stripes.
      const night = this.dyn.night;
      const grad = ctx.createLinearGradient(X(0), 0, X(v.w), 0);
      for (let x = 0; x < v.w; x++) {
        grad.addColorStop((x + 0.5) / v.w, `rgba(${NIGHT_TINT},${(night[x]! / 255) * 0.6})`);
      }
      ctx.fillStyle = grad;
      ctx.fillRect(X(0), Y(0), v.w * s, v.h * s);
    }

    if (this.marks['body.sites'] !== false) {
      for (const site of v.sites) {
        const cx = X(site.x + 0.5);
        const cy = Y(site.y + 0.5);
        const sz = site.size === 'large' ? 9 : site.size === 'medium' ? 7 : 5;
        ctx.fillStyle = pal.mark.site;
        ctx.strokeStyle = 'rgba(20,10,40,0.9)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx, cy - sz);
        ctx.lineTo(cx + sz * 0.9, cy + sz * 0.7);
        ctx.lineTo(cx - sz * 0.9, cy + sz * 0.7);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        if (site.inspected) {
          ctx.fillStyle = '#5fd35f';
          ctx.beginPath();
          ctx.arc(cx + sz, cy - sz, 3, 0, TAU);
          ctx.fill();
        }
        if (this.isSel(site.path)) {
          ctx.strokeStyle = pal.mark.selected;
          ctx.lineWidth = 2;
          ctx.strokeRect(cx - sz - 4, cy - sz - 4, (sz + 4) * 2, (sz + 4) * 2);
        }
        if (this.isSel(site.path) || this.hover === site.path) {
          this.label(this.pack.name('site', site.nameKey, site.size), cx + sz + 4, cy - sz);
        }
        this.hits.push({ path: site.path, x: cx, y: cy, r: sz + 5 });
      }
    }

    if (this.features.anomalies && this.marks['body.anomalies'] !== false) {
      for (const a of v.anomalies) {
        const cx = X(a.x + 0.5);
        const cy = Y(a.y + 0.5);
        const sz = 5;
        ctx.strokeStyle = pal.mark.anomaly;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(cx - sz, cy - sz);
        ctx.lineTo(cx + sz, cy + sz);
        ctx.moveTo(cx + sz, cy - sz);
        ctx.lineTo(cx - sz, cy + sz);
        ctx.stroke();
        if (a.inspected) {
          ctx.fillStyle = '#5fd35f';
          ctx.beginPath();
          ctx.arc(cx + sz + 2, cy - sz - 2, 3, 0, TAU);
          ctx.fill();
        }
        if (this.isSel(a.path)) {
          ctx.strokeStyle = pal.mark.selected;
          ctx.lineWidth = 2;
          ctx.strokeRect(cx - sz - 4, cy - sz - 4, (sz + 4) * 2, (sz + 4) * 2);
        }
        if (this.isSel(a.path) || this.hover === a.path) {
          this.label(this.pack.name('anomaly', a.nameKey), cx + sz + 4, cy - sz);
        }
        this.hits.push({ path: a.path, x: cx, y: cy, r: sz + 6 });
      }
    }
  }

  private drawSite(v: SiteView): void {
    const ctx = this.ctx;
    const pal = this.pack.palette;
    const s = this.scale;
    const X = (wx: number) => this.ox + wx * s;
    const Y = (wy: number) => this.oy + wy * s;

    if (this.marks['site.roads'] !== false) this.drawGrid(v);
    else {
      ctx.fillStyle = pal.ground;
      ctx.fillRect(X(0), Y(0), v.w * s, v.h * s);
    }

    if (this.marks['site.lots'] !== false) {
      // Plots: a faint dashed edge, and a light wash on the ones nobody has built on yet.
      ctx.save();
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.lineWidth = 1;
      for (const p of v.plots) {
        const own = p.dwelling >= 0 ? v.dwellings[p.dwelling] : undefined;
        if (own && !own.built && own.builtWeek < 0) continue; // held in reserve: no plot until it is wanted
        if (!own?.built) {
          ctx.fillStyle = 'rgba(255,255,255,0.07)';
          ctx.fillRect(X(p.x), Y(p.y), p.w * s, p.h * s);
        }
        ctx.strokeRect(X(p.x) + 0.5, Y(p.y) + 0.5, p.w * s - 1, p.h * s - 1);
      }
      ctx.restore();
    }

    const dyn = this.dyn?.level === 'site' ? this.dyn : null;
    const showDwellings = this.marks['site.dwellings'] !== false;
    if (showDwellings) {
      for (const d of v.dwellings) {
        if (!d.built) continue;
        ctx.fillStyle = this.lensColor(d);
        const cells = footprint(d);
        for (const c of cells) ctx.fillRect(X(c.x), Y(c.y), s, s);
        ctx.strokeStyle = 'rgba(0,0,0,0.55)';
        ctx.lineWidth = 1;
        outline(ctx, cells, X, Y, 0.5);
        if (s >= 5) {
          // The entrance: a short light bar across the middle of the edge cell it faces.
          const { x, y, side } = d.door;
          const t = Math.max(2, s * 0.25);
          const len = s * 0.5;
          ctx.fillStyle = 'rgba(255,244,200,0.95)';
          if (side === 0) ctx.fillRect(X(x) + (s - len) / 2, Y(y) - t / 2, len, t);
          else if (side === 2) ctx.fillRect(X(x) + (s - len) / 2, Y(y + 1) - t / 2, len, t);
          else if (side === 3) ctx.fillRect(X(x) - t / 2, Y(y) + (s - len) / 2, t, len);
          else ctx.fillRect(X(x + 1) - t / 2, Y(y) + (s - len) / 2, t, len);
        }
      }
    }

    const dark = dyn ? 1 - dyn.daylight : 0;
    if (this.marks['site.night'] !== false && dark > 0) {
      ctx.fillStyle = `rgba(${NIGHT_TINT},${dark * 0.6})`;
      ctx.fillRect(X(0), Y(0), v.w * s, v.h * s);
    }

    if (showDwellings) {
      v.dwellings.forEach((d, i) => {
        if (!d.built) return;
        if (dyn && dark > 0.15 && dyn.lit[i]) {
          ctx.fillStyle = `rgba(255,215,94,${Math.min(1, dark + 0.3)})`;
          // One lit window per two cells of footprint, so a big building glows more than a shed; a grown cell adds a half.
          const nx = Math.max(1, Math.floor(d.w / 2));
          const ny = Math.max(1, Math.floor(d.h / 2));
          for (let j = 0; j < ny; j++) {
            for (let i = 0; i < nx; i++) {
              ctx.fillRect(X(d.x + (i + 0.5) * (d.w / nx)) - s * 0.4, Y(d.y + (j + 0.5) * (d.h / ny)) - s * 0.4, s * 0.8, s * 0.8);
            }
          }
          (d.extra ?? []).forEach((c, k) => {
            if (k % 2 === 0) ctx.fillRect(X(c.x + 0.5) - s * 0.4, Y(c.y + 0.5) - s * 0.4, s * 0.8, s * 0.8);
          });
        }
        if (this.features.inhabitants && this.marks['site.residents'] !== false && s >= 6) {
          ctx.fillStyle = 'rgba(255,255,255,0.9)';
          const cells = footprint(d);
          const n = Math.min(d.residents, cells.length);
          for (let k = 0; k < n; k++) {
            ctx.beginPath();
            ctx.arc(X(cells[k]!.x + 0.5), Y(cells[k]!.y + 0.5), Math.max(1.5, s * 0.14), 0, TAU);
            ctx.fill();
          }
        }
        if (d.inspected) {
          ctx.fillStyle = '#5fd35f';
          ctx.beginPath();
          ctx.arc(X(d.x + d.w), Y(d.y), Math.max(3, s * 0.2), 0, TAU);
          ctx.fill();
        }
        if (this.isSel(d.path)) {
          ctx.strokeStyle = pal.mark.selected;
          ctx.lineWidth = 2;
          outline(ctx, footprint(d), X, Y, -2);
        }
        this.hits.push({ path: d.path, x: X(d.x), y: Y(d.y), r: 0, w: d.w * s, h: d.h * s });
        for (const c of d.extra ?? []) this.hits.push({ path: d.path, x: X(c.x), y: Y(c.y), r: 0, w: s, h: s });
      });
      for (const d of v.dwellings) {
        if (d.built && (this.isSel(d.path) || this.hover === d.path)) {
          this.label(this.pack.name('dwelling', d.nameKey, d.kind), X(d.x + d.w) + 4, Y(d.y));
        }
      }
    }
  }
}
