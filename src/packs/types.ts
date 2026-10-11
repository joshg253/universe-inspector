import type { BodyKind, DwellingKind, FeatureId, NameKind, StarClass } from '../core/types';

export interface Palette {
  bg: string;
  star: Record<StarClass, string>;
  orbit: string;
  /** 7 colors per body kind, indexed by terrain class (or band, for gas bodies) */
  terrain: Record<BodyKind, string[]>;
  ground: string;
  road: string;
  green: string;
  plaza: string;
  water: string;
  dwelling: Record<DwellingKind, string>;
  mark: { site: string; anomaly: string; selected: string; settled: string };
}

export interface Pack {
  id: string;
  label: string;
  era: string;
  /** which optional feature sets this pack turns on by default */
  features: Record<FeatureId, boolean>;
  palette: Palette;
  /** translate an id like 'body.temperate' */
  t(key: string): string;
  /** render a generated name key */
  name(kind: NameKind, key: number, tag?: string): string;
}

export interface PackDef {
  id: string;
  label: string;
  era: string;
  features: Record<FeatureId, boolean>;
  palette: Palette;
  words: Record<string, string>;
  name(kind: NameKind, key: number, tag: string | undefined, t: (key: string) => string): string;
}
