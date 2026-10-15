import { lineChart } from './chart';
import { depth, parentPath, parsePath } from '../core/path';
import { DAY, YEAR } from '../core/time';
import { TICKS_PER_WEEK } from '../core/life';
import { BASE_TICKS, LADDER, SPEED_GLYPHS, STEP_GLYPH, spanLabel, speedTps, type FromWorker, type ToWorker } from '../core/protocol';
import type { Dyn, FeatureId, RecordChild, RecordData, SimEvent, View } from '../core/types';
import { DEFAULT_PACK_ID, PACKS, packOf } from '../packs';
import { fmt } from '../packs/define';
import { clear, h } from './dom';
import { MapCanvas } from './map';

type Tab = 'status' | 'results' | 'record' | 'settings';

interface MarkDef {
  key: string;
  glyph: string;
  cls: string;
  word: string;
  count?: number;
  feature?: FeatureId;
}

interface Saved {
  seed: string;
  skin: string;
  packId: string;
  features: Record<FeatureId, boolean>;
  marks: Record<string, boolean>;
  leftW: number;
}

const LEFT_MIN = 300;
const LEFT_DEFAULT = 440;
const RIGHT_MIN = 360; // keep the map usable; also encoded in .left max-width in win.css

const LS_KEY = 'universe-inspector.settings.v1';
// Oldest first, with the year of the look each one imitates.
const SKINS: [string, string][] = [
  ['amiga', 'Amiga Workbench (1985)'],
  ['mac', 'Classic Mac, System 7 (1991)'],
  ['win31', 'Windows 3.1 (1992)'],
  ['win95', 'Windows 95 (1995)'],
  ['beos', 'BeOS (1996)'],
  ['win98', 'Windows 98 (1998)'],
  ['win2k', 'Windows 2000 (2000)'],
  ['winxp', 'Windows XP (2001)'],
  ['flat', 'Flat, modern (2015)'],
];
const TABS: [Tab, string][] = [
  ['status', 'Status'],
  ['results', 'Results'],
  ['record', 'Record'],
  ['settings', 'Settings'],
];
const FEATURES: [FeatureId, string][] = [
  ['anomalies', 'Anomalies / omens (hidden marks on planet maps)'],
  ['inhabitants', 'Inhabitants (person-level records, resident dots)'],
  ['economy', 'Economy fields (output, wealth)'],
];

function loadSaved(): Partial<Saved> {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? '{}') as Partial<Saved>;
  } catch {
    return {};
  }
}

function marksFor(v: View): MarkDef[] {
  if (v.level === 'universe') {
    return [{ key: 'universe.systems', glyph: '●', cls: 'g-body', word: 'mark.systems', count: v.systems.length }];
  }
  if (v.level === 'system') {
    return [
      { key: 'system.orbits', glyph: '◯', cls: 'g-orbit', word: 'mark.orbits', count: v.bodies.length },
      { key: 'system.bodies', glyph: '●', cls: 'g-body', word: 'mark.bodies', count: v.bodies.length },
      {
        key: 'system.settled',
        glyph: '◎',
        cls: 'g-site',
        word: 'mark.settled',
        count: v.bodies.filter((b) => b.siteCount > 0).length,
      },
    ];
  }
  if (v.level === 'body') {
    let land = 0;
    for (const c of v.cells) if (c >= 2) land++;
    return [
      {
        key: 'body.terrain',
        glyph: '▦',
        cls: 'g-terrain',
        word: 'mark.terrain',
        count: v.kind === 'gaseous' ? undefined : land,
      },
      { key: 'body.night', glyph: '◐', cls: 'g-night', word: 'mark.night' },
      { key: 'body.sites', glyph: '▲', cls: 'g-site', word: 'mark.sites', count: v.sites.length },
      {
        key: 'body.anomalies',
        glyph: '✕',
        cls: 'g-anom',
        word: 'mark.anomalies',
        count: v.anomalies.length,
        feature: 'anomalies',
      },
    ];
  }
  let roads = 0;
  for (const c of v.cells) if (c === 1) roads++;
  return [
    { key: 'site.roads', glyph: '▬', cls: 'g-road', word: 'mark.roads', count: roads },
    { key: 'site.lots', glyph: '▢', cls: 'g-dwell', word: 'mark.lots', count: v.plots.length },
    { key: 'site.dwellings', glyph: '■', cls: 'g-dwell', word: 'mark.dwellings', count: v.dwellings.filter((d) => d.built).length },
    {
      key: 'site.residents',
      glyph: '•',
      cls: 'g-res',
      word: 'mark.residents',
      count: v.dwellings.reduce((n, d) => n + d.residents, 0),
      feature: 'inhabitants',
    },
    { key: 'site.night', glyph: '◐', cls: 'g-night', word: 'mark.night' },
  ];
}

export function startApp(root: HTMLElement): void {
  // URL parameters override saved settings, for sharing a state or taking a screenshot of one:
  // ?skin=amiga&pack=fantasy&seed=abc&view=s0/b2&ticks=20000
  const query = new URLSearchParams(location.search);
  const fromUrl: Partial<Saved> = {};
  if (query.get('seed')) fromUrl.seed = query.get('seed')!;
  if (query.get('skin')) fromUrl.skin = query.get('skin')!;
  if (query.get('pack')) fromUrl.packId = query.get('pack')!;
  const saved = { ...loadSaved(), ...fromUrl };
  const state = {
    seed: saved.seed ?? 'first-light',
    skin: saved.skin ?? 'win98',
    packId: saved.packId ?? DEFAULT_PACK_ID,
    features: { ...packOf(saved.packId ?? DEFAULT_PACK_ID).features, ...(saved.features ?? {}) } as Record<
      FeatureId,
      boolean
    >,
    marks: { ...(saved.marks ?? {}) } as Record<string, boolean>,
    leftW: Math.max(LEFT_MIN, saved.leftW ?? LEFT_DEFAULT),
    view: null as View | null,
    viewPath: '',
    selPath: null as string | null,
    record: null as RecordData | null,
    tick: 0,
    /** The furthest tick this run has reached: the scrubber goes back anywhere up to it. */
    maxTick: 0,
    /** Event kind the log is limited to ('' for all). */
    logKind: '',
    /** Column the structure list is sorted by (null: generated order). */
    listSort: null as { col: 'name' | 'state'; dir: 1 | -1 } | null,
    speed: 0,
    tps: 0,
    dyn: null as Dyn | null,
    events: [] as SimEvent[],
    tab: 'status' as Tab,
    /** Which stat's graph the Results tab shows (a field label); the first graph of a record when unset or absent. */
    chartStat: null as string | null,
    /** Whether graphs also draw their running average. Transient UI state. */
    chartAvg: false,
    /** How many ticks the Step button (and the . key) advance, per zoom level (universe, system, planet, settlement);
     *  an hour means nothing across a universe. Transient UI state. */
    stepTicks: [...BASE_TICKS] as number[],
    error: null as string | null,
  };
  let pack = packOf(state.packId);
  const t = (k: string) => pack.t(k);
  const nm = (kind: Parameters<typeof pack.name>[0], key: number, tag?: string) => pack.name(kind, key, tag);

  const worker = new Worker(new URL('../worker/sim.worker.ts', import.meta.url), { type: 'module' });
  const send = (m: ToWorker) => worker.postMessage(m);

  const persist = () => {
    try {
      const data: Saved = {
        seed: state.seed,
        skin: state.skin,
        packId: state.packId,
        features: state.features,
        marks: state.marks,
        leftW: state.leftW,
      };
      localStorage.setItem(LS_KEY, JSON.stringify(data));
    } catch {
      /* storage may be unavailable; settings just won't persist */
    }
  };

  const map = new MapCanvas(pack, {
    onSelect: (p) => select(p),
    onOpen: (p) => open(p),
    onLens: () => syncUrl(),
  });
  if (['age', 'fill', 'water', 'soil', 'timber', 'stone'].includes(query.get('lens') ?? '')) map.lens = query.get('lens') as typeof map.lens;
  map.marks = state.marks;
  map.features = state.features;

  // ------------------------------------------------------------ DOM build

  const titleText = h('span', { class: 'tb-title' });
  const titlebar = h(
    'div',
    { class: 'titlebar' },
    // In skins with no taskbar (Windows 3.1) this is the system menu and opens the same items as Start.
    h('span', { class: 'tb-icon', onclick: () => toggleStartMenu() }),
    titleText,
    h(
      'div',
      { class: 'tb-btns' },
      h('span', { class: 'tb-btn' }, '_'),
      h('span', { class: 'tb-btn' }, '□'),
      h('span', { class: 'tb-btn' }, '×'),
    ),
  );

  const tabBtns = {} as Record<Tab, HTMLButtonElement>;
  const panels = {} as Record<Tab, HTMLElement>;
  const tabStrip = h('div', { class: 'tabstrip' });
  for (const [id, label] of TABS) {
    tabBtns[id] = h('button', { class: 'tab', onclick: () => setTab(id) }, label);
    panels[id] = h('div', { class: 'panel' });
    tabStrip.append(tabBtns[id]);
  }

  // --- Status panel
  const sysInput = h('input', {
    type: 'number',
    class: 'num',
    min: 0,
    step: 1,
    value: 0,
    onchange: () => pickItem(Math.floor(Number(sysInput.value) || 0)),
  });
  // The picker steps through what the view holds: systems in the universe, bodies in a system, sites on a body, and the
  // standing structures in a district. Picking one selects it (double-click or Zoom in goes inside).
  const levelItems = (): { path: string }[] => {
    const v = state.view;
    if (!v) return [];
    if (v.level === 'universe') return v.systems;
    if (v.level === 'system') return v.bodies;
    if (v.level === 'body') return v.sites;
    return v.dwellings.filter((d) => d.built);
  };
  const itemLevel = (): string => {
    const v = state.view;
    return v?.level === 'system' ? 'body' : v?.level === 'body' ? 'site' : v?.level === 'site' ? 'dwelling' : 'system';
  };
  /** Index of the selected item among them, -1 when something else (or nothing) is selected. */
  const curItem = () => levelItems().findIndex((it) => it.path === state.selPath);
  /** `back`: stepping left from nothing (or from something else) lands on the last item rather than the first. */
  function pickItem(i: number, back = false): void {
    const items = levelItems();
    if (items.length === 0) return;
    if (back && curItem() < 0) i = items.length - 1;
    select(items[Math.max(0, Math.min(items.length - 1, i))]!.path);
  }
  const pickLabel = h('label', null, 'System');
  const hintLine = h('div', { class: 'hint' });
  const bigTitle = h('div', { class: 'bigtitle' });
  const stateLine = h('div', { class: 'stateline' });
  const levelLine = h('div', { class: 'hint tight' });
  const kvBody = h('tbody');
  const kv = (label: string) => {
    const v = h('td', { class: 'v' });
    kvBody.append(h('tr', null, h('td', { class: 'k' }, label), v));
    return v;
  };
  const kTick = kv('Tick');
  const kClock = kv('Standard clock');
  const kLocal = kv('Local time');
  const kRate = kv('Rate');
  const kInView = kv('In view');
  const kInsp = kv('Inspected');

  const listBody = h('tbody');
  // Click a column header to sort the list by it; click again to reverse, a third time to go back to generated order.
  const listHeads: Record<string, HTMLElement> = {};
  function listHead(col: 'name' | 'state', label: string): HTMLElement {
    const th = h('th', { class: 'sortable', title: 'Sort', onclick: () => {
      const s = state.listSort;
      state.listSort = s?.col !== col ? { col, dir: 1 } : s.dir === 1 ? { col, dir: -1 } : null;
      renderList();
    } }, label);
    listHeads[col] = th;
    return th;
  }
  const listBox = h(
    'div',
    { class: 'listbox' },
    h('table', { class: 'list' }, h('thead', null, h('tr', null, listHead('name', 'Name'), listHead('state', 'State'))), listBody),
  );
  const helpLine = h(
    'div',
    { class: 'help' },
    'Click an item to select it; double-click to zoom in. Drag the map to pan, scroll to zoom. Space = pause/resume, . = step, Backspace = zoom out.',
  );

  const btnOut = h('button', { onclick: () => zoomOut() }, 'Zoom out');
  const btnIn = h('button', { onclick: () => zoomIn() }, 'Zoom in');
  const btnInspect = h('button', { onclick: () => inspect() }, 'Inspect');
  // The step sizes are the ladder from an hour to 1,000 years (the same spans the speeds use).
  const STEP_SIZES: [string, number][] = LADDER.slice(0, 8).map((span) => [spanLabel(span), span]);
  const stepLevel = () => Math.min(3, depth(state.viewPath));
  const stepNow = () => send({ type: 'step', n: state.stepTicks[stepLevel()] });
  const btnStep = h('button', { title: 'Advance one step (.)', onclick: stepNow }, `${STEP_GLYPH} Step`);
  const stepSize = h(
    'select',
    {
      title: 'How far the Step button advances',
      onchange: (e: Event) => (state.stepTicks[stepLevel()] = Number((e.target as HTMLSelectElement).value)),
    },
    ...STEP_SIZES.map(([label, n]) => h('option', { value: String(n) }, label)),
  );
  const speedBtns = SPEED_GLYPHS.map((glyph, i) => h('button', { class: 'speed', onclick: () => setSpeed(i) }, glyph));
  const speedLevel = () => Math.min(3, depth(state.viewPath));
  const speedText = (i: number) => (i === 0 ? 'Paused' : `${spanLabel(speedTps(speedLevel(), i))} per second`);

  panels.status.append(
    h(
      'div',
      { class: 'row' },
      pickLabel,
      h('button', { class: 'small', onclick: () => pickItem(curItem() - 1, true) }, '◄'),
      sysInput,
      h('button', { class: 'small', onclick: () => pickItem(curItem() + 1) }, '►'),
    ),
    hintLine,
    bigTitle,
    stateLine,
    levelLine,
    h('table', { class: 'kv' }, kvBody),
    listBox,
    helpLine,
  );

  // Jump to a year, or scrub anywhere within what has run (going back refolds the district from the start).
  const yearInput = h('input', { type: 'number', class: 'num', min: 0, step: 1, value: 0, title: 'Year to jump to' });
  const goTo = (tick: number) => send({ type: 'goto', tick: Math.max(0, Math.round(tick)) });
  yearInput.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') {
      goTo((Number(yearInput.value) || 0) * YEAR);
      yearInput.blur();
    }
  });
  const scrub = h('input', { type: 'range', class: 'scrub', min: 0, max: 0, step: 1, value: 0, title: 'Scrub through time' });
  // While dragged, the slider is the user's, and a drag sends the latest position at most every 120 ms.
  let scrubbing = false;
  let scrubTimer = 0;
  scrub.addEventListener('pointerdown', () => (scrubbing = true));
  window.addEventListener('pointerup', () => (scrubbing = false));
  scrub.addEventListener('input', () => {
    if (scrubTimer) return;
    scrubTimer = window.setTimeout(() => {
      scrubTimer = 0;
      goTo(Number(scrub.value) * TICKS_PER_WEEK);
    }, 120);
  });
  scrub.addEventListener('change', () => goTo(Number(scrub.value) * TICKS_PER_WEEK));

  // Zoom and time controls stay visible whichever tab is open.
  const controls = h(
    'div',
    { class: 'controls' },
    h('div', { class: 'btnrow' }, btnOut, btnIn, btnInspect),
    h('div', { class: 'btnrow' }, btnStep, stepSize),
    h('div', { class: 'btnrow' }, ...speedBtns),
    h('div', { class: 'btnrow' }, h('label', null, 'Year'), yearInput, h('button', { class: 'small', onclick: () => goTo((Number(yearInput.value) || 0) * YEAR) }, 'Go')),
    h('div', { class: 'btnrow' }, scrub),
  );

  // --- Results / Record / Settings panels
  const resultsBody = h('div', { class: 'scroll' });
  panels.results.append(resultsBody);
  const logBody = h('div', { class: 'log' });
  // Show one kind of event only (people's births and deaths drown out everything else in a big town).
  const LOG_KINDS = ['birth', 'death', 'arrival', 'departure', 'exchange', 'mishap', 'gathering', 'discovery'] as const;
  const logFilter = h(
    'select',
    { title: 'Show only one kind of event', onchange: () => ((state.logKind = logFilter.value), renderLog()) },
    h('option', { value: '' }, 'All events'),
    ...LOG_KINDS.map((k) => h('option', { value: k }, k[0]!.toUpperCase() + k.slice(1))),
  );
  panels.record.append(
    h('div', { class: 'hint' }, 'Events from the system you are watching, newest first. Click a line to jump there.'),
    logBody,
    h('div', { class: 'btnrow' }, logFilter, h('button', { onclick: () => ((state.events = []), renderLog()) }, 'Clear')),
  );
  const settingsBody = h('div', { class: 'scroll' });
  panels.settings.append(settingsBody);

  const leftCol = h('div', { class: 'left' }, tabStrip, ...TABS.map(([id]) => panels[id]), controls);

  // --- Right side
  const crumbs = h('div', { class: 'crumbs' });
  const infoBox = h('div', { class: 'info' });
  const marksRow = h('div', { class: 'marks' });
  const readout = h('pre', { class: 'readout' });
  const rightCol = h('div', { class: 'right' }, crumbs, map.root, infoBox, marksRow, readout);

  const taskTray = h('div', { class: 'tray' });
  const startBtn = h(
    'button',
    { class: 'start', onclick: () => toggleStartMenu() },
    h('b', { class: 'st-win' }, '■ Start'),
    h('b', { class: 'st-mac' }, '\u{1F34E}'),
    h('b', { class: 'st-be' }, h('i', null, 'Be'), h('i', null, 'OS')),
  );
  const taskbar = h(
    'div',
    { class: 'taskbar' },
    startBtn,
    // Only the Mac skin shows these: its menu bar replaces the taskbar.
    ...['File', 'Edit', 'View'].map((m) => h('span', { class: 'menu-fake' }, m)),
    h('span', { class: 'menu-fake mac-only' }, 'Special'),
    h('span', { class: 'menu-fake help-only' }, 'Help'),
    h('div', { class: 'taskbtn' }, h('span', { class: 'tb-icon' }), h('span', { class: 'task-title' })),
    taskTray,
  );

  // Draggable divider between the left panel and the map. CSS (.left min/max-width) enforces the limits on window resize.
  const splitter = h('div', {
    class: 'splitter',
    role: 'separator',
    tabIndex: 0,
    title: 'Drag to resize (double-click to reset)',
  });
  const mainEl = h('div', { class: 'main' }, leftCol, splitter, rightCol);
  const setLeftW = (w: number, save = true): void => {
    const max = Math.max(LEFT_MIN, mainEl.getBoundingClientRect().width - RIGHT_MIN - 16);
    state.leftW = Math.round(Math.min(max, Math.max(LEFT_MIN, w)));
    leftCol.style.setProperty('--left-w', `${state.leftW}px`);
    if (save) persist();
  };
  setLeftW(state.leftW, false);
  let dragFrom: { x: number; w: number } | null = null;
  splitter.addEventListener('pointerdown', (e) => {
    splitter.setPointerCapture(e.pointerId);
    dragFrom = { x: e.clientX, w: leftCol.getBoundingClientRect().width };
    splitter.classList.add('drag');
  });
  splitter.addEventListener('pointermove', (e) => {
    if (dragFrom) setLeftW(dragFrom.w + e.clientX - dragFrom.x, false);
  });
  const endDrag = () => {
    if (!dragFrom) return;
    dragFrom = null;
    splitter.classList.remove('drag');
    persist();
  };
  splitter.addEventListener('pointerup', endDrag);
  splitter.addEventListener('pointercancel', endDrag);
  splitter.addEventListener('dblclick', () => setLeftW(LEFT_DEFAULT));
  splitter.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    setLeftW(leftCol.getBoundingClientRect().width + (e.key === 'ArrowLeft' ? -16 : 16));
  });

  const windowEl = h('div', { class: 'window' }, titlebar, mainEl);
  const dialogLayer = h('div', { class: 'dialog-layer' });
  const startMenu = h('div', { class: 'startmenu' });
  root.append(h('div', { class: 'desktop' }, windowEl, dialogLayer), startMenu, taskbar);

  // --- Start menu: the "File menu" of this tool
  const closeStartMenu = (): void => startMenu.classList.remove('open');
  function toggleStartMenu(): void {
    startMenu.classList.toggle('open');
  }
  const menuItem = (label: string, fn: () => void): HTMLElement =>
    h('button', { class: 'item', onclick: () => (closeStartMenu(), fn()) }, label);
  startMenu.append(
    menuItem('New universe...', () => openNewUniverse()),
    menuItem('Settings', () => setTab('settings')),
    h('hr'),
    menuItem('About', () => showMessage('About', `${t('app.title')} v0.1\nA procedural universe you inspect, not play. Everything is generated from the seed; only your changes are stored.`)),
  );
  document.addEventListener('pointerdown', (e) => {
    const target = e.target as Node;
    const opener = startBtn.contains(target) || (target as Element).closest?.('.window > .titlebar > .tb-icon');
    if (!startMenu.contains(target) && !opener) closeStartMenu();
  });

  // --- Dialogs: the main window is hidden while one is open, like a closed app
  let dialogOpen = false;
  const showDialog = (title: string, body: HTMLElement, buttons: HTMLElement[]): void => {
    dialogOpen = true;
    windowEl.classList.add('away');
    clear(dialogLayer);
    dialogLayer.append(
      h(
        'div',
        { class: 'dialog', role: 'dialog' },
        h('div', { class: 'titlebar' }, h('span', { class: 'tb-icon' }), h('span', { class: 'tb-title' }, title)),
        h('div', { class: 'dialog-body' }, body, h('div', { class: 'btnrow right' }, ...buttons)),
      ),
    );
    dialogLayer.classList.add('open');
  };
  const closeDialog = (): void => {
    dialogOpen = false;
    clear(dialogLayer);
    dialogLayer.classList.remove('open');
    windowEl.classList.remove('away');
    map.redraw();
  };
  function showMessage(title: string, text: string): void {
    showDialog(title, h('div', { class: 'dialog-text' }, text), [h('button', { onclick: closeDialog }, 'OK')]);
  }
  function openNewUniverse(): void {
    const draft = { seed: state.seed, packId: state.packId, features: { ...state.features } };
    const seed = h('input', { type: 'text', class: 'seed', value: draft.seed });
    seed.addEventListener('input', () => (draft.seed = seed.value));
    const packSel = h(
      'select',
      {
        onchange: () => {
          draft.packId = packSel.value;
          draft.features = { ...packOf(draft.packId).features };
          drawFeatures();
        },
      },
      ...Object.values(PACKS).map((p) => h('option', { value: p.id, selected: p.id === draft.packId }, `${p.label} (${p.era})`)),
    );
    const featureBox = h('div', { class: 'dialog-features' });
    const drawFeatures = (): void => {
      clear(featureBox);
      for (const [id, label] of FEATURES) {
        const cb = h('input', { type: 'checkbox', checked: draft.features[id] });
        cb.addEventListener('change', () => (draft.features[id] = cb.checked));
        featureBox.append(h('label', { class: 'check' }, cb, ` ${label}`));
      }
    };
    drawFeatures();
    const start = (): void => {
      const s = draft.seed.trim();
      if (!s) return seed.focus();
      closeDialog();
      state.packId = draft.packId;
      pack = packOf(draft.packId);
      Object.assign(state.features, draft.features);
      renderSettings();
      refreshContent();
      resetUniverse(s);
    };
    seed.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') start();
    });
    showDialog(
      'New Universe',
      h(
        'div',
        { class: 'dialog-form' },
        h('div', { class: 'row' }, h('label', null, 'Universe seed'), seed, h('button', { onclick: () => ((draft.seed = Math.random().toString(36).slice(2, 8)), (seed.value = draft.seed)) }, 'Random')),
        h('div', { class: 'row' }, h('label', null, 'Content pack'), packSel),
        h('div', { class: 'section-title' }, 'Feature sets'),
        featureBox,
        h('div', { class: 'hint' }, 'The same seed gives the same starting universe in any content pack. Starting restarts the simulation at tick 0.'),
      ),
      [h('button', { onclick: start }, 'Start'), h('button', { onclick: closeDialog }, 'Cancel')],
    );
    seed.focus();
    seed.select();
  }

  // ------------------------------------------------------------ rendering

  const kindLabel = (r: RecordData): string => {
    switch (r.kind) {
      case 'system':
        return t('level.system');
      case 'body':
        return t('level.body');
      case 'site':
        return t('level.site');
      case 'dwelling':
        return t(`dwelling.${r.tag}`);
      case 'person':
        return 'Person';
      case 'anomaly':
        return t('state.anomaly');
    }
  };

  const fieldValue = (value: string | number, vocab?: string): string => {
    if (vocab) return t(`${vocab}.${value}`);
    return typeof value === 'number' ? value.toLocaleString() : String(value);
  };

  const countItems = (v: View): { total: number; inspected: number } => {
    if (v.level === 'universe') return { total: v.systems.length, inspected: v.systems.filter((s) => s.inspected).length };
    if (v.level === 'system') return { total: v.bodies.length, inspected: v.bodies.filter((b) => b.inspected).length };
    if (v.level === 'body') {
      const a = state.features.anomalies ? v.anomalies : [];
      return {
        total: v.sites.length + a.length,
        inspected: v.sites.filter((s) => s.inspected).length + a.filter((x) => x.inspected).length,
      };
    }
    const here = v.dwellings.filter((d) => d.built);
    return { total: here.length, inspected: here.filter((d) => d.inspected).length };
  };

  /** Chart time axis: days at first, then years. 1 tick = 1 hour. */
  const fmtTime = (tick: number): string =>
    tick < YEAR * 2 ? `Day ${Math.floor(tick / DAY) + 1}` : `Year ${(tick / YEAR).toFixed(1)}`;

  const eventText = (e: SimEvent) => fmt(t(`event.${e.kind}`), { 0: nm('site', e.nameKey), n: e.n });

  function renderChrome(): void {
    root.className = `skin-${state.skin}`;
    const title = `${t('app.title')} v0.1 - ${state.seed}`;
    titleText.textContent = title;
    document.title = t('app.title');
    (taskbar.querySelector('.task-title') as HTMLElement).textContent = t('app.title');
    for (const [id] of TABS) tabBtns[id].classList.toggle('active', id === state.tab);
    for (const [id] of TABS) panels[id].classList.toggle('active', id === state.tab);
    speedBtns.forEach((b, i) => b.classList.toggle('pressed', i === state.speed));
  }

  function renderHeader(): void {
    clear(crumbs);
    const v = state.view;
    if (!v) return;
    v.trail.forEach((item, i) => {
      if (i > 0) crumbs.append(h('span', { class: 'sep' }, ' › '));
      const text = nm(item.nameKind, item.nameKey, item.tag);
      const last = i === v.trail.length - 1;
      crumbs.append(
        last
          ? h('b', null, `${text} — ${t(`level.${v.level}`)}`)
          : h('a', { class: 'crumb', href: '#', onclick: (e: Event) => (e.preventDefault(), goView(item.path)) }, text),
      );
    });
  }

  function renderStatus(): void {
    const v = state.view;
    pickLabel.textContent = t(`level.${itemLevel()}`);
    sysInput.value = curItem() >= 0 ? String(curItem()) : '';
    sysInput.max = String(Math.max(0, levelItems().length - 1));
    hintLine.textContent = `Generating from seed "${state.seed}" — nothing is stored except what you change.`;
    if (v) {
      const last = v.trail[v.trail.length - 1]!;
      bigTitle.textContent = nm(last.nameKind, last.nameKey, last.tag);
      levelLine.textContent = `Level ${depth(v.path) + 1} of 4: ${t(`level.${v.level}`)}`;
      const c = countItems(v);
      kInView.textContent = c.total.toLocaleString();
      kInsp.textContent = `${c.inspected} of ${c.total}`;
    } else {
      bigTitle.textContent = 'Loading…';
    }
    renderStatusLive();
  }

  function renderStatusLive(): void {
    const running = state.speed > 0;
    stateLine.textContent = running ? `Running at ${SPEED_GLYPHS[state.speed]} (${speedText(state.speed)})` : 'Paused';
    stateLine.classList.toggle('running', running);
    kTick.textContent = state.tick.toLocaleString();
    kClock.textContent = `Day ${Math.floor(state.tick / DAY) + 1}, ${String(state.tick % DAY).padStart(2, '0')}:00`;
    kLocal.textContent = state.dyn?.level === 'site' ? `${String(state.dyn.hour).padStart(2, '0')}:00 (daylight ${Math.round(state.dyn.daylight * 100)}%)` : '—';
    kRate.textContent = running ? `${Math.round(state.tps).toLocaleString('en-US')} ticks/s` : '0 ticks/s';
    taskTray.textContent = `Tick ${state.tick.toLocaleString()}`;
  }

  function renderList(): void {
    clear(listBody);
    const v = state.view;
    if (!v) return;
    let pending: [string, string, string][] = [];
    const flush = (): void => {
      const s = state.listSort;
      if (s) {
        const k = s.col === 'name' ? 1 : 2;
        pending.sort((a, b) => s.dir * a[k]!.localeCompare(b[k]!, undefined, { numeric: true }));
      }
      for (const [path, name, st] of pending) {
        listBody.append(
          h('tr', { class: state.selPath === path ? 'sel' : '', onclick: () => select(path), ondblclick: () => open(path) }, h('td', null, name), h('td', null, st)),
        );
      }
      pending = [];
    };
    const section = (title: string) => {
      flush();
      listBody.append(h('tr', { class: 'section' }, h('td', { colSpan: 2 }, title)));
    };
    const row = (path: string, name: string, st: string) => pending.push([path, name, st]);
    for (const [col, th] of Object.entries(listHeads)) {
      const s = state.listSort;
      th.textContent = (col === 'name' ? 'Name' : 'State') + (s?.col === col ? (s.dir === 1 ? ' ▲' : ' ▼') : '');
    }
    if (v.level === 'universe') {
      section(t('list.universe'));
      for (const s of v.systems) {
        const st = [t(`star.${s.cls}`), `${s.bodyCount} ${t('mark.bodies').toLowerCase()}`, s.inspected ? '✓' : '']
          .filter(Boolean)
          .join(' · ');
        row(s.path, nm('system', s.nameKey), st);
      }
    } else if (v.level === 'system') {
      section(t('list.system'));
      for (const b of v.bodies) {
        const st = [t(`body.${b.kind}`), b.siteCount > 0 ? t('state.settled') : '', b.inspected ? '✓' : '']
          .filter(Boolean)
          .join(' · ');
        row(b.path, nm('body', b.nameKey, b.kind), st);
      }
    } else if (v.level === 'body') {
      section(t('list.sites'));
      for (const s of v.sites) {
        row(s.path, nm('site', s.nameKey, s.size), `${t(`size.${s.size}`)} · ${s.population.toLocaleString()}${s.inspected ? ' · ✓' : ''}`);
      }
      if (state.features.anomalies && v.anomalies.length > 0) {
        section(t('list.anomalies'));
        for (const a of v.anomalies) row(a.path, nm('anomaly', a.nameKey), `${t('state.anomaly')}${a.inspected ? ' · ✓' : ''}`);
      }
    } else {
      section(t('list.dwellings'));
      for (const d of v.dwellings.filter((x) => x.built)) {
        const res = state.features.inhabitants ? ` · ${d.residents}` : '';
        row(d.path, nm('dwelling', d.nameKey, d.kind), `${t(`dwelling.${d.kind}`)}${res}${d.inspected ? ' · ✓' : ''}`);
      }
    }
    flush();
    listBody.querySelector('tr.sel')?.scrollIntoView({ block: 'nearest' });
  }

  function renderMarks(): void {
    clear(marksRow);
    marksRow.append(h('span', { class: 'marks-label' }, 'Show marks:'));
    const v = state.view;
    if (!v) return;
    for (const m of marksFor(v)) {
      if (m.feature && !state.features[m.feature]) continue;
      const cb = h('input', {
        type: 'checkbox',
        checked: state.marks[m.key] !== false,
        onchange: () => {
          state.marks[m.key] = cb.checked;
          persist();
          map.redraw();
        },
      });
      const text = t(m.word) + (m.count !== undefined ? ` ${m.count.toLocaleString()}` : '');
      marksRow.append(
        h(
          'label',
          { class: `mark${m.count === 0 ? ' zero' : ''}` },
          cb,
          h('span', { class: `glyph ${m.cls}` }, m.glyph),
          h('span', { class: 'mark-text' }, text),
        ),
      );
    }
  }

  function renderInfo(): void {
    clear(infoBox);
    const v = state.view;
    if (!v) return;
    const lines: string[] = [];
    if (v.level === 'universe') {
      lines.push(`${v.systems.length} ${t('mark.systems').toLowerCase()} in view; the field extends in every direction.`);
      lines.push('Each system is generated on demand from the seed when you zoom into it.');
      lines.push('Double-click a system to zoom in.');
    } else if (v.level === 'system') {
      const settled = v.bodies.filter((b) => b.siteCount > 0).length;
      const periods = v.bodies.map((b) => b.period);
      lines.push(`${t(`star.${v.star.cls}`)} at the center. ${v.bodies.length} ${t('mark.bodies').toLowerCase()}, ${settled} with settlements.`);
      lines.push(`Orbital periods run from ${Math.min(...periods)} to ${Math.max(...periods)} ticks; positions advance with the tick counter.`);
      lines.push('Double-click a body to zoom in. Everything is generated on demand from the seed.');
    } else if (v.level === 'body') {
      lines.push(`${t(`body.${v.kind}`)}. Surface grid ${v.w} × ${v.h} cells, day length ${v.dayLength} ticks.`);
      lines.push(`${v.sites.length} sites${state.features.anomalies ? `, ${v.anomalies.length} ${t('mark.anomalies').toLowerCase()}` : ''}. Night shading follows the sun across the surface.`);
      lines.push('Double-click a site to zoom into its district.');
    } else {
      const residents = v.dwellings.reduce((n, d) => n + d.residents, 0);
      lines.push(`District grid ${v.w} × ${v.h} cells with ${v.dwellings.filter((d) => d.built).length} dwellings.`);
      lines.push(`Population ${residents.toLocaleString()}. Lit windows follow local solar time.`);
      lines.push('Double-click a dwelling to open its record.');
    }
    for (const l of lines) infoBox.append(h('div', null, l));
  }

  function renderReadout(): void {
    const v = state.view;
    const lines: string[] = [];
    if (v) {
      lines.push(`Viewing   ${v.path}  (${t(`level.${v.level}`)})`);
      const r = state.record;
      lines.push(
        state.selPath && r && r.path === state.selPath
          ? `Selected  ${nm(r.nameKind, r.nameKey, r.tag)}  (${kindLabel(r)})`
          : state.selPath
            ? `Selected  ${state.selPath}`
            : 'Selected  nothing',
      );
      const c = countItems(v);
      lines.push(`Inspected ${c.inspected} of ${c.total} items in view.`);
    }
    const ev = state.events[state.events.length - 1];
    lines.push(ev ? `Last event T${ev.tick}: ${eventText(ev)}` : 'Last event: none yet (press Step or pick a speed).');
    if (state.error) lines.push(`Error: ${state.error}`);
    readout.textContent = lines.join('\n');
  }

  function renderResults(): void {
    clear(resultsBody);
    const r = state.record;
    if (!r) {
      resultsBody.append(
        h('div', { class: 'hint' }, state.selPath || state.viewPath ? 'Loading…' : 'Nothing selected. Click an item on the map or in the list.'),
      );
      return;
    }
    resultsBody.append(
      h('div', { class: 'bigtitle' }, nm(r.nameKind, r.nameKey, r.tag)),
      h('div', { class: 'hint' }, `${kindLabel(r)} · ${r.path}${r.inspected ? ` · ${t('state.inspected')}` : ''}`),
    );
    // A stat that has a graph is a link: click it to show that graph below. The first graph is the default.
    const charts = r.charts ?? [];
    const active = charts.find((c) => c.label === state.chartStat) ?? charts[0];
    const body = h('tbody');
    for (const f of r.fields) {
      if (f.feature && !state.features[f.feature]) continue;
      const graphed = charts.some((c) => c.label === f.label);
      const label = t(`field.${f.label}`);
      body.append(
        h(
          'tr',
          graphed
            ? {
                class: `statlink${active?.label === f.label ? ' on' : ''}`,
                title: 'Show graph',
                onclick: () => ((state.chartStat = f.label), renderResults()),
              }
            : null,
          h('td', { class: 'k' }, label),
          h(
            'td',
            { class: 'v' },
            fieldValue(f.value, f.vocab),
            f.range ? h('span', { class: 'range' }, ` (${t('field.min')} ${f.range.min} · ${t('field.max')} ${f.range.max}${f.range.perYear ? ` ${t('field.per_yr')}` : ''})`) : null,
          ),
        ),
      );
    }
    resultsBody.append(h('table', { class: 'kv wide' }, body));
    if (active) {
      const plotted = active.points.length >= 2; // a graph with no history yet has nothing to average
      resultsBody.append(
        h('div', { class: 'section-title' }, `${t(`field.${active.label}`)}${active.perYear ? ` (${t('field.per_year')})` : ''}`),
      );
      if (plotted) {
        const toggle = h('input', { type: 'checkbox', checked: state.chartAvg });
        toggle.addEventListener('change', () => ((state.chartAvg = toggle.checked), renderResults()));
        resultsBody.append(h('label', { class: 'chart-opt' }, toggle, ` ${t('field.running_avg')}`));
      }
      resultsBody.append(
        lineChart(t(`field.${active.label}`), active.points, fmtTime, {
          avg: state.chartAvg ? { label: t('field.running_avg') } : undefined,
          overlay: active.overlay ? { label: t(`field.${active.overlay.label}`), points: active.overlay.points } : undefined,
        }),
      );
    }
    const pyr = r.pyramid;
    if (pyr && pyr.f.length > 0) {
      const top = Math.max(1, ...pyr.f, ...pyr.m);
      resultsBody.append(h('div', { class: 'section-title' }, 'Age and sex'));
      const box = h('div', { class: 'pyramid' });
      for (let i = pyr.f.length - 1; i >= 0; i--) {
        const label = i === 9 ? `${i * pyr.step}+` : `${i * pyr.step}–${(i + 1) * pyr.step - 1}`;
        box.append(
          h(
            'div',
            { class: 'prow' },
            h('span', { class: 'pbar f', style: `width:${(pyr.f[i]! / top) * 100}%`, title: `${pyr.f[i]} female` }),
            h('span', { class: 'plabel' }, label),
            h('span', { class: 'pbar m', style: `width:${(pyr.m[i]! / top) * 100}%`, title: `${pyr.m[i]} male` }),
          ),
        );
      }
      resultsBody.append(box);
    }
    // In a household's own list the family name is the household's, so it is left off unless it differs.
    const listName = (c: RecordChild, parent: RecordData): string => {
      const full = nm(c.nameKind, c.nameKey, c.tag);
      if (parent.kind !== 'dwelling' || c.nameKind !== 'person' || c.nameKey >>> 16 !== parent.nameKey >>> 16) return full;
      const family = nm('dwelling', parent.nameKey);
      return full.endsWith(` ${family}`) ? full.slice(0, -family.length - 1) : full;
    };
    const group = (title: string, items: RecordChild[]): void => {
      const shown = items.filter((c) => !c.feature || state.features[c.feature]);
      if (shown.length === 0) return;
      resultsBody.append(h('div', { class: 'section-title' }, title));
      const list = h('div', { class: 'children' });
      for (const c of shown) {
        const meta = c.meta ? ` ${t(`sexshort.${c.meta.sex}`)}/${c.meta.age}${c.meta.dead ? ' †' : ''}` : '';
        list.append(
          h(
            'a',
            {
              class: 'crumb',
              href: '#',
              style: c.indent ? `margin-left:${c.indent * 14}px` : '',
              onclick: (e: Event) => (e.preventDefault(), select(c.path)),
            },
            `${c.partner ? '+ ' : c.indent ? '└ ' : ''}${listName(c, r)}${meta}`,
          ),
        );
      }
      resultsBody.append(list);
    };
    group('Contains', r.children);
    // A person's family drawn by generation; the list below keeps the plain links.
    if (r.tree && r.tree.rows.some((row) => row.items.length > 0 && row.label !== 'family') ) {
      resultsBody.append(h('div', { class: 'section-title' }, t('field.tree')));
      const tree = h('div', { class: 'famtree' });
      for (const row of r.tree.rows) {
        const cells = row.items
          .filter((c) => !c.feature || state.features[c.feature])
          .map((c) => {
          const meta = c.meta ? ` ${t(`sexshort.${c.meta.sex}`)}/${c.meta.age}${c.meta.dead ? ' †' : ''}` : '';
          return h(
            'a',
            {
              class: 'fam' + (c.path === r.path ? ' me' : ''),
              href: '#',
              title: t(`field.${row.label}`),
              onclick: (e: Event) => (e.preventDefault(), select(c.path)),
            },
            nm(c.nameKind, c.nameKey, c.tag),
            h('small', null, meta.trim()),
          );
        });
        if (cells.length === 0) continue; // everyone in this row is hidden by the inhabitants feature
        tree.append(h('div', { class: 'famcap' }, t(`field.${row.label}`)), h('div', { class: 'famrow' }, ...cells));
      }
      resultsBody.append(tree);
    }
    for (const l of r.links ?? []) group(t(`field.${l.label}`), l.items);
  }

  let logDirty = false;
  function renderLog(): void {
    logDirty = false;
    clear(logBody);
    const shown = state.events.filter((e) => !state.logKind || e.kind === state.logKind).slice(-200).reverse();
    if (shown.length === 0) logBody.append(h('div', { class: 'hint' }, state.logKind ? 'No events of this kind yet.' : 'No events yet.'));
    for (const e of shown) {
      logBody.append(
        h(
          'div',
          { class: 'logline', onclick: () => goView(e.path) },
          h('span', { class: 'lt' }, `T${e.tick}`),
          ` ${eventText(e)}`,
        ),
      );
    }
  }

  function renderSettings(): void {
    clear(settingsBody);
    const skinSel = h(
      'select',
      { onchange: () => ((state.skin = skinSel.value), persist(), renderChrome()) },
      ...SKINS.map(([id, label]) => h('option', { value: id, selected: id === state.skin }, label)),
    );
    const packSel = h(
      'select',
      { onchange: () => applyPack(packSel.value) },
      ...Object.values(PACKS).map((p) => h('option', { value: p.id, selected: p.id === state.packId }, `${p.label} (${p.era})`)),
    );
    settingsBody.append(
      h('div', { class: 'section-title' }, 'Window skin'),
      h('div', { class: 'row' }, skinSel),
      h('div', { class: 'hint' }, 'Skins only change the chrome. They never change the universe.'),
      h('div', { class: 'section-title' }, 'Content pack'),
      h('div', { class: 'row' }, packSel),
      h('div', { class: 'hint' }, 'A pack renames things, recolors the maps and sets default feature sets. The same seed gives the same universe in any pack.'),
      h('div', { class: 'section-title' }, 'Feature sets'),
    );
    for (const [id, label] of FEATURES) {
      const cb = h('input', {
        type: 'checkbox',
        checked: state.features[id],
        onchange: () => {
          state.features[id] = cb.checked;
          persist();
          refreshContent();
        },
      });
      settingsBody.append(h('label', { class: 'check' }, cb, ` ${label}`));
    }
    settingsBody.append(
      h(
        'div',
        { class: 'btnrow' },
        h('button', { onclick: () => (Object.assign(state.features, pack.features), persist(), renderSettings(), refreshContent()) }, 'Reset to pack defaults'),
      ),
    );
  }

  function renderButtons(): void {
    btnOut.disabled = depth(state.viewPath) === 0;
    btnIn.disabled = !state.selPath;
    btnInspect.disabled = !state.selPath;
    btnInspect.textContent = state.record?.inspected ? 'Un-inspect' : 'Inspect';
    stepSize.value = String(state.stepTicks[stepLevel()]);
    speedBtns.forEach((b, i) => (b.title = i === 0 ? 'Pause' : speedText(i)));
  }

  /** Everything that depends on names, vocabulary, or feature flags. */
  function refreshContent(): void {
    map.pack = pack;
    map.features = state.features;
    map.rebuild();
    renderChrome();
    renderHeader();
    renderStatus();
    renderList();
    renderMarks();
    renderInfo();
    renderReadout();
    renderResults();
    renderLog();
    renderButtons();
  }

  // -------------------------------------------------------------- actions

  function setTab(tab: Tab): void {
    state.tab = tab;
    renderChrome();
    if (tab === 'settings') renderSettings();
    if (tab === 'record') renderLog();
  }

  function setSpeed(i: number): void {
    state.speed = i;
    send({ type: 'speed', index: i });
    renderChrome();
    renderStatusLive();
  }

  function select(path: string | null): void {
    state.selPath = path;
    state.record = null;
    map.sel = path;
    map.redraw();
    // With nothing selected, Results describes the thing you are looking at (the town, planet or system).
    const shown = path ?? (state.viewPath || null);
    if (shown) send({ type: 'record', path: shown });
    renderList();
    renderResults();
    renderReadout();
    renderButtons();
    renderStatus();
    syncUrl();
  }

  /** Keep the seed, view and selection in the address, so a reload or a shared link lands in the same place. */
  function syncUrl(): void {
    try {
      const p = new URLSearchParams(location.search);
      const set = (k: string, v: string) => (v ? p.set(k, v) : p.delete(k));
      set('seed', state.seed);
      set('view', state.viewPath);
      set('sel', state.selPath ?? '');
      for (const k of ['ticks', 'menu', 'dialog', 'tab']) p.delete(k); // one-shot parameters: a reload must not repeat them
      set('skin', state.skin);
      set('pack', state.packId);
      set('lens', map.shownLens() === 'kind' ? '' : map.shownLens());
      history.replaceState(null, '', `${location.pathname}?${p}${location.hash}`);
    } catch {
      /* a sandboxed frame may refuse: the address is only a convenience */
    }
  }

  function goView(path: string, selectPath: string | null = null): void {
    state.viewPath = path;
    send({ type: 'view', path });
    select(selectPath);
  }

  function open(path: string): void {
    const last = parsePath(path).at(-1);
    if (!last) return;
    if (last.k === 's' || last.k === 'b' || last.k === 't') goView(path);
    else {
      select(path);
      setTab('results');
    }
  }

  function zoomIn(): void {
    if (state.selPath) open(state.selPath);
  }

  function zoomOut(): void {
    if (depth(state.viewPath) > 0) goView(parentPath(state.viewPath), state.viewPath);
  }

  function inspect(): void {
    if (!state.selPath) return;
    send({ type: 'delta', path: state.selPath, patch: { inspected: !state.record?.inspected } });
  }

  function resetUniverse(seed: string): void {
    state.seed = seed;
    state.events = [];
    state.tick = 0;
    state.view = null;
    state.dyn = null;
    persist();
    state.maxTick = 0;
    send({ type: 'reset', seed });
    renderChrome();
    renderLog();
    goView('');
  }

  function applyPack(id: string): void {
    state.packId = id;
    pack = packOf(id);
    Object.assign(state.features, pack.features);
    persist();
    renderSettings();
    refreshContent();
  }

  // ------------------------------------------------------------- messages

  let liveQueued = false;
  function scheduleLive(): void {
    if (liveQueued) return;
    liveQueued = true;
    requestAnimationFrame(() => {
      liveQueued = false;
      renderStatusLive();
      renderReadout();
      if (logDirty && state.tab === 'record') renderLog();
    });
  }

  worker.onmessage = (e: MessageEvent<FromWorker>) => {
    const m = e.data;
    switch (m.type) {
      case 'view':
        state.view = m.view;
        state.viewPath = m.view.path;
        map.setView(m.view);
        map.sel = state.selPath;
        renderHeader();
        renderStatus();
        renderList();
        renderMarks();
        renderInfo();
        renderReadout();
        renderButtons();
        break;
      case 'record':
        if (m.record.path === (state.selPath ?? state.viewPath)) {
          state.record = m.record;
          renderResults();
          renderReadout();
          renderButtons();
        }
        break;
      case 'tick':
        state.tick = m.tick;
        if (m.tick < state.tick) state.events = state.events.filter((e) => e.tick <= m.tick); // went back: later events are not yet
        state.maxTick = m.maxTick;
        scrub.max = String(Math.floor(state.maxTick / TICKS_PER_WEEK));
        if (!scrubbing) scrub.value = String(Math.floor(m.tick / TICKS_PER_WEEK));
        if (document.activeElement !== yearInput) yearInput.value = String(Math.floor(m.tick / YEAR));
        state.tps = m.tps;
        state.dyn = m.dyn;
        map.setWeek(Math.floor(m.tick / TICKS_PER_WEEK));
        if (m.dyn && state.view && m.dyn.level === state.view.level) map.setDyn(m.dyn);
        if (m.events.length > 0) {
          state.events.push(...m.events);
          if (state.events.length > 400) state.events = state.events.slice(-400);
          logDirty = true;
        }
        scheduleLive();
        break;
      case 'error':
        state.error = m.message;
        renderReadout();
        break;
    }
  };

  document.addEventListener('keydown', (e) => {
    if (dialogOpen) {
      if (e.key === 'Escape') closeDialog();
      return;
    }
    const target = e.target as HTMLElement;
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName) || target === splitter) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      pickItem(curItem() + (e.key === 'ArrowRight' ? 1 : -1), e.key === 'ArrowLeft');
    } else if (e.key === ' ') {
      e.preventDefault();
      if (target.tagName === 'BUTTON') target.blur();
      setSpeed(state.speed === 0 ? 1 : 0);
    } else if (e.key === '.') stepNow();
    else if (e.key === 'Backspace') {
      e.preventDefault();
      zoomOut();
    } else if (e.key === 'Enter' && target.tagName !== 'BUTTON') zoomIn();
    else if (e.key === 'i') inspect();
  });

  // ----------------------------------------------------------------- boot

  renderChrome();
  renderSettings();
  renderLog();
  renderResults();
  renderButtons();
  send({ type: 'reset', seed: state.seed });
  goView(query.get('view') ?? '');
  const ticks = Number(query.get('ticks'));
  if (ticks > 0) send({ type: 'step', n: ticks });
  // More of the state in the URL (used for documentation screenshots): ?sel=<path>&tab=results&menu=1&dialog=new
  const sel = query.get('sel');
  if (sel) select(sel);
  const tab = query.get('tab');
  if (tab && TABS.some(([id]) => id === tab)) setTab(tab as Tab);
  if (query.get('menu') === '1') startMenu.classList.add('open');
  if (query.get('dialog') === 'new') openNewUniverse();
}
