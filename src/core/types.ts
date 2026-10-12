// Generic simulation types. Nothing in core/ uses theme words: it emits ids
// like 'temperate' or 'home', and a content pack decides what they are called.

export type BodyKind = 'barren' | 'temperate' | 'arid' | 'frozen' | 'gaseous';
export type StarClass = 'dim' | 'mid' | 'bright';
export type SizeClass = 'small' | 'medium' | 'large';
export type DwellingKind = 'home' | 'shop' | 'works' | 'hall';
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
  inspected: boolean;
}

export interface SiteSummary {
  path: string;
  index: number;
  nameKey: number;
  x: number;
  y: number;
  size: SizeClass;
  population: number;
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
  inspected: boolean;
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
  /** 0 ground, 1 road, 2 plaza, 3 green, 4 water (see CELL in town.ts) */
  cells: Uint8Array;
  dwellings: DwellingSummary[];
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
  points: { t: number; v: number }[];
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
  charts?: RecordChart[];
}
