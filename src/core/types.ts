// Generic simulation types. Nothing in core/ uses theme words: it emits ids
// like 'temperate' or 'home', and a content pack decides what they are called.

export type BodyKind = 'barren' | 'temperate' | 'arid' | 'frozen' | 'gaseous';
export type StarClass = 'dim' | 'mid' | 'bright';
export type SizeClass = 'small' | 'medium' | 'large';
/** `mill`, `quarry`, `dock`, `farm` and `mine` are workplaces tied to what lies around the town (timber, stone, fish, soil, stone); a `warehouse` is a workplace of the later ages. */
export type DwellingKind = 'home' | 'shop' | 'works' | 'mill' | 'quarry' | 'dock' | 'farm' | 'mine' | 'warehouse' | 'hall';
export type NameKind = 'universe' | 'system' | 'body' | 'site' | 'dwelling' | 'person' | 'anomaly';
export type EventKind =
  | 'birth'
  | 'death'
  | 'arrival'
  | 'departure'
  | 'exchange'
  | 'mishap'
  | 'gathering'
  | 'discovery';
/** How a district's streets are laid out. Chosen from the seed; packs only render it. */
export type TownStyle = 'grid' | 'radial' | 'organic' | 'village';
export type Level = 'universe' | 'system' | 'body' | 'site';
export type FeatureId = 'anomalies' | 'inhabitants' | 'economy';

/** Names are rendered by the pack from a number, so one universe can wear any theme. */
export interface TrailItem {
  path: string;
  nameKey: number;
  nameKind: NameKind;
  tag?: string;
}

export interface BodySummary {
  path: string;
  index: number;
  nameKey: number;
  kind: BodyKind;
  orbit: number;
  period: number; // ticks per orbit
  phase: number; // radians at tick 0
  size: number;
  siteCount: number;
  /** Percent of the surface under water (0 for a gas giant). */
  waterPct: number;
  inspected: boolean;
}

export interface SiteSummary {
  path: string;
  index: number;
  nameKey: number;
  x: number;
  y: number;
  size: SizeClass;
  /** On a planet list: the people its district holds at tick 0 (the worker replaces it with the live count when the run is later). */
  population: number;
  /** What the planet offers within reach of the site, 0..3 each (none .. plentiful). */
  around: { fresh: number; salt: number; soil: number; timber: number; stone: number; fish: number };
  inspected: boolean;
}

export interface AnomalySummary {
  path: string;
  index: number;
  nameKey: number;
  x: number;
  y: number;
  inspected: boolean;
}

export interface DwellingSummary {
  path: string;
  index: number;
  nameKey: number; // family key
  kind: DwellingKind;
  x: number;
  y: number;
  w: number;
  h: number;
  residents: number;
  /** People it holds at most (from its footprint; a home that stays full grows); 0 for works and the hall. */
  capacity: number;
  /** Cells a home has grown into beyond its rectangle (x, y, w, h), one cell at a time. */
  extra?: { x: number; y: number }[];
  /** Index into the district's `plots` of the parcel it stands on (-1 for the hall). */
  plot: number;
  /** The entrance: an edge cell of the original rectangle and the side it faces (0 north, 1 east, 2 south, 3 west). */
  door: { x: number; y: number; side: number };
  /** The week it is finished (0: standing from the start; -1: held in reserve until the town needs it; a view with life gives the live value). Until then nobody lives there. */
  builtWeek: number;
  /** Whether it stands now (set from the running district; at tick 0, `builtWeek === 0`). */
  built: boolean;
  /** The footpath carved for a building finished later (cell index x 8 + the cell's class before), left out of `cells` until it stands. */
  track?: number[];
  inspected: boolean;
}

/** A parcel of ground in a district: one building stands on it with its yard, or it is vacant. */
export interface PlotSummary {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Index into the district's `dwellings` of what stands there, -1 while vacant. */
  dwelling: number;
}

export interface SystemSummary {
  path: string;
  index: number;
  nameKey: number;
  x: number;
  y: number;
  cls: StarClass;
  bodyCount: number;
  inspected: boolean;
}

/** The top level: a field of star systems. Positions are in the same -120..120 space as a system view. */
export interface UniverseView {
  level: 'universe';
  path: string;
  nameKey: number;
  trail: TrailItem[];
  systems: SystemSummary[];
}

export interface SystemView {
  level: 'system';
  path: string;
  nameKey: number;
  trail: TrailItem[];
  star: { cls: StarClass; radius: number };
  bodies: BodySummary[];
}

export interface BodyView {
  level: 'body';
  path: string;
  nameKey: number;
  trail: TrailItem[];
  kind: BodyKind;
  w: number;
  h: number;
  /** terrain class 0..6 per cell (deep water .. summit); for gas bodies, a band index */
  cells: Uint8Array;
  /** Resource layers per cell: water 0 none / 1 fresh / 2 salt; soil, timber, stone 0..3 (none .. plentiful) */
  layers: { water: Uint8Array; soil: Uint8Array; timber: Uint8Array; stone: Uint8Array };
  dayLength: number;
  sites: SiteSummary[];
  anomalies: AnomalySummary[];
}

export interface SiteView {
  level: 'site';
  path: string;
  nameKey: number;
  trail: TrailItem[];
  bodyKind: BodyKind;
  w: number;
  h: number;
  /** 0 ground, 1 road, 2 plaza, 3 green, 4 water, 5 track (see CELL in town.ts) */
  cells: Uint8Array;
  dwellings: DwellingSummary[];
  plots: PlotSummary[];
  dayLength: number;
  lon: number; // 0..1 position around the body, used for local time
  population: number;
  size: SizeClass;
  style: TownStyle;
}

export type View = UniverseView | SystemView | BodyView | SiteView;

/** Per-tick state that changes while the view stays the same. */
export type Dyn =
  | { level: 'universe' }
  | { level: 'system'; angles: number[] }
  | { level: 'body'; night: Uint8Array }
  | { level: 'site'; daylight: number; hour: number; lit: Uint8Array };

export interface SimEvent {
  tick: number;
  kind: EventKind;
  path: string;
  nameKey: number;
  n: number;
}

export interface RecordField {
  label: string;
  value: string | number;
  /** if set, the value is an id the pack translates as `${vocab}.${value}` */
  vocab?: string;
  feature?: FeatureId;
  /** The lowest and highest the stat has been over the run (for a total such as births, of its yearly rate: see `perYear`). */
  range?: { min: number; max: number; perYear?: boolean };
}

export interface RecordChild {
  path: string;
  nameKey: number;
  nameKind: NameKind;
  tag?: string;
  feature?: FeatureId;
  /** For people, shown beside the name (sex/age). `dead` people keep their age at death. */
  meta?: { sex: 'f' | 'm'; age: number; dead: boolean };
  /** In a household list: 1 for a child shown under their parents, 2 for a grandchild. */
  indent?: number;
  /** In a household list: the other parent of the children listed under the person above (shown with a +). */
  partner?: boolean;
}

/** A named group of related records, e.g. a person's mother or children. */
export interface RecordLinks {
  label: string;
  items: RecordChild[];
}

/** A value over time, for a line chart. `label` is a field word key; `t` is in ticks. */
export interface RecordChart {
  label: string;
  /** The values are a rate per year, not a level. */
  perYear?: boolean;
  points: { t: number; v: number }[];
  /** A second measure drawn over the first on its own scale (a label key, like `label`). */
  overlay?: { label: string; points: { t: number; v: number }[] };
}

export interface RecordData {
  path: string;
  kind: 'system' | 'body' | 'site' | 'dwelling' | 'person' | 'anomaly';
  nameKey: number;
  nameKind: NameKind;
  tag?: string;
  inspected: boolean;
  fields: RecordField[];
  children: RecordChild[];
  links?: RecordLinks[];
  /** A person's family by generation, oldest first: grandparents, parents, the person with siblings and the other parents of
   *  their children, children, grandchildren. */
  tree?: { rows: { label: string; items: RecordChild[] }[] };
  charts?: RecordChart[];
  /** Living people by age band (`step` years each, youngest first) and sex, for a settlement. */
  pyramid?: { step: number; f: number[]; m: number[] };
}
