// The zoomable map. One canvas, three renderers (system / body / site).
// Each draw pass records the clickable things it drew, so hit-testing always
// matches what is on screen (hidden layers are not clickable).
import type { BodyView, Dyn, FeatureId, SiteView, SystemView, UniverseView, View } from '../core/types';
import type { Pack } from '../packs/types';
import { h } from './dom';

export interface MapHooks {
  onSelect(path: string | null): void;
  onOpen(path: string): void;
}

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
const NATIVE_SCALE = { universe: 4, system: 4, body: 8, site: 10 } as const;

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export class MapCanvas {
  readonly root: HTMLDivElement;
  pack: Pack;
  marks: Record<string, boolean> = {};
  features: Record<FeatureId, boolean> = { anomalies: true, inhabitants: true, economy: true };
  sel: string | null = null;

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

  constructor(pack: Pack, private hooks: MapHooks) {
    this.pack = pack;
    this.canvas = h('canvas', { class: 'map-canvas' });
    this.ctx = this.canvas.getContext('2d')!;
    const btn = (label: string, title: string, fn: () => void) => h('button', { title, onclick: fn }, label);
    const buttons = h(
      'div',
      { class: 'mapbtns' },
      btn('+', 'Zoom in', () => this.zoomAt(1.4, this.cssW / 2, this.cssH / 2)),
      btn('-', 'Zoom out', () => this.zoomAt(1 / 1.4, this.cssW / 2, this.cssH / 2)),
      btn('1:1', 'Native scale', () => this.oneToOne()),
      btn('Fit', 'Fit to window', () => this.fit()),
      btn('↻', 'Recenter', () => this.fit()),
    );
    this.root = h('div', { class: 'mapwrap' }, this.canvas, buttons);

    new ResizeObserver(() => this.resize()).observe(this.root);
    this.canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    this.canvas.addEventListener('pointermove', (e) => this.onMove(e));
    this.canvas.addEventListener('pointerup', (e) => this.onUp(e));
    this.canvas.addEventListener('pointerleave', () => {
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

  private oneToOne(): void {
    if (!this.view) return;
    this.zoomAt(NATIVE_SCALE[this.view.level] / this.scale, this.cssW / 2, this.cssH / 2);
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
      const green = hexToRgb(pal.green);
      const plaza = hexToRgb(pal.plaza);
      const water = hexToRgb(pal.water);
      for (let i = 0; i < v.cells.length; i++) {
        const c0 = v.cells[i];
        const [r, g, b] = c0 === 1 ? road : c0 === 2 ? plaza : c0 === 3 ? green : c0 === 4 ? water : ground;
        img.data.set([r, g, b, 255], i * 4);
      }
    }
    cx.putImageData(img, 0, 0);
    return c;
  }

  /** Call after the pack changes so palette colors are rebuilt. */
  rebuild(): void {
    if (this.view) this.off = this.buildOffscreen(this.view);
    this.redraw();
  }

  private draw(): void {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = this.pack.palette.bg;
    ctx.fillRect(0, 0, this.cssW, this.cssH);
    this.hits = [];
    const v = this.view;
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

    const dyn = this.dyn?.level === 'site' ? this.dyn : null;
    const showDwellings = this.marks['site.dwellings'] !== false;
    if (showDwellings) {
      for (const d of v.dwellings) {
        ctx.fillStyle = pal.dwelling[d.kind];
        ctx.fillRect(X(d.x), Y(d.y), d.w * s, d.h * s);
        ctx.strokeStyle = 'rgba(0,0,0,0.55)';
        ctx.lineWidth = 1;
        ctx.strokeRect(X(d.x) + 0.5, Y(d.y) + 0.5, d.w * s - 1, d.h * s - 1);
      }
    }

    const dark = dyn ? 1 - dyn.daylight : 0;
    if (this.marks['site.night'] !== false && dark > 0) {
      ctx.fillStyle = `rgba(${NIGHT_TINT},${dark * 0.6})`;
      ctx.fillRect(X(0), Y(0), v.w * s, v.h * s);
    }

    if (showDwellings) {
      v.dwellings.forEach((d, i) => {
        if (dyn && dark > 0.15 && dyn.lit[i]) {
          ctx.fillStyle = `rgba(255,215,94,${Math.min(1, dark + 0.3)})`;
          // One lit window per two cells of footprint, so a big building glows more than a shed.
          const nx = Math.max(1, Math.floor(d.w / 2));
          const ny = Math.max(1, Math.floor(d.h / 2));
          for (let j = 0; j < ny; j++) {
            for (let i = 0; i < nx; i++) {
              ctx.fillRect(X(d.x + (i + 0.5) * (d.w / nx)) - s * 0.4, Y(d.y + (j + 0.5) * (d.h / ny)) - s * 0.4, s * 0.8, s * 0.8);
            }
          }
        }
        if (this.features.inhabitants && this.marks['site.residents'] !== false && s >= 6) {
          ctx.fillStyle = 'rgba(255,255,255,0.9)';
          const n = Math.min(d.residents, d.w * d.h);
          for (let k = 0; k < n; k++) {
            ctx.beginPath();
            ctx.arc(X(d.x + 0.5 + (k % d.w)), Y(d.y + 0.5 + Math.floor(k / d.w)), Math.max(1.5, s * 0.14), 0, TAU);
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
          ctx.strokeRect(X(d.x) - 2, Y(d.y) - 2, d.w * s + 4, d.h * s + 4);
        }
        this.hits.push({ path: d.path, x: X(d.x), y: Y(d.y), r: 0, w: d.w * s, h: d.h * s });
      });
      for (const d of v.dwellings) {
        if (this.isSel(d.path) || this.hover === d.path) {
          this.label(this.pack.name('dwelling', d.nameKey, d.kind), X(d.x + d.w) + 4, Y(d.y));
        }
      }
    }
  }
}
