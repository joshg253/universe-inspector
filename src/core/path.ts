// Paths address anything in the universe: s3/b2/t5/d17/p1
//   s system, b body, t site (settlement), d dwelling, p person, a anomaly
import type { Level } from './types';

export type SegKind = 's' | 'b' | 't' | 'd' | 'p' | 'a';
export interface Seg {
  k: SegKind;
  i: number;
}

export function parsePath(path: string): Seg[] {
  if (!path) return [];
  return path.split('/').map((s) => ({ k: s[0] as SegKind, i: parseInt(s.slice(1), 10) }));
}

/** The settlement a path lies in (the first three segments), or null if it is above that level. */
export function sitePathOf(path: string): string | null {
  const segs = parsePath(path);
  if (segs.length < 3 || segs[0]!.k !== 's' || segs[1]!.k !== 'b' || segs[2]!.k !== 't') return null;
  return segs.slice(0, 3).map((s) => `${s.k}${s.i}`).join('/');
}

export const depth = (path: string): number => (path ? path.split('/').length : 0);

export const parentPath = (path: string): string => path.split('/').slice(0, -1).join('/');

/** A view path has 0 (universe), 1 (system), 2 (body) or 3 (site) segments. */
export function viewLevel(viewPath: string): Level {
  const d = depth(viewPath);
  return d === 0 ? 'universe' : d === 1 ? 'system' : d === 2 ? 'body' : 'site';
}
