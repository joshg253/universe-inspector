import { mulberry32, hash32 } from '../core/rng';
import { BASE_WORDS } from './base';
import type { Pack, PackDef } from './types';

export function definePack(def: PackDef): Pack {
  const words = { ...BASE_WORDS, ...def.words };
  const t = (key: string): string => words[key] ?? key;
  return {
    id: def.id,
    label: def.label,
    era: def.era,
    features: def.features,
    palette: def.palette,
    t,
    name: (kind, key, tag) => def.name(kind, key, tag, t),
  };
}

const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

/** Build a pronounceable name from a number: onset+mid pairs and a closing coda. */
export function syllables(
  salt: string,
  key: number,
  tables: { onsets: string[]; mids: string[]; codas: string[] },
  parts: [number, number],
): string {
  const r = mulberry32(hash32(`${salt}:${key}`));
  const n = r.int(parts[0], parts[1]);
  let s = '';
  for (let i = 0; i < n; i++) s += r.pick(tables.onsets) + r.pick(tables.mids);
  s += r.pick(tables.codas);
  return cap(s);
}

export function fmt(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));
}
