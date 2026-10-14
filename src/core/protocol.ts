import { DAY, HOUR, MONTH, WEEK, YEAR } from './time';
import type { Dyn, RecordData, SimEvent, View } from './types';

/** Zoom levels, outermost first. Index = depth of the view path (capped at 3). */
export const LEVELS = ['universe', 'system', 'body', 'site'] as const;
/** One ladder of spans in ticks (1 tick = 1 hour): hour, day, week, month, year, then by tens up to 10,000 years. */
export const LADDER = [HOUR, DAY, WEEK, MONTH, YEAR, 10 * YEAR, 100 * YEAR, 1000 * YEAR, 10_000 * YEAR] as const;
/** Where each level's five speeds start on the ladder: a year across a universe, a week in a system, a day on a
 *  planet, an hour in a district. The first rung is also that level's default step size. */
const LEVEL_START = [4, 2, 1, 0] as const;
/** The default step at each level, in ticks. */
export const BASE_TICKS = LEVEL_START.map((s) => LADDER[s]!) as readonly number[];

// Play triangle (U+25B6 with the text-presentation selector, so it never turns into an emoji).
const PLAY = '▶︎';
/** Next-track mark for the Step button: a play triangle against a bar. */
export const STEP_GLYPH = PLAY + '❘';
/** Pause bar, then one to four play triangles, then MAX. */
export const SPEED_GLYPHS = ['❚❚', PLAY, PLAY.repeat(2), PLAY.repeat(3), PLAY.repeat(4), 'MAX'] as const;

/** Target ticks per real second for a speed button (1 to 5; 0 is Pause) at a zoom level. */
export function speedTps(level: number, index: number): number {
  if (index <= 0) return 0;
  return LADDER[LEVEL_START[Math.max(0, Math.min(3, level))]! + index - 1] ?? 0;
}

/** A span of ticks in the biggest unit that fits: "1 year", "10 years", "36 hours". */
export function spanLabel(ticks: number): string {
  const units: [string, number][] = [['year', YEAR], ['month', MONTH], ['week', WEEK], ['day', DAY], ['hour', HOUR]];
  const [name, size] = units.find(([, s]) => ticks >= s) ?? units[units.length - 1]!;
  const v = ticks / size;
  const text = Math.abs(v - Math.round(v)) < 0.05 ? Math.round(v).toLocaleString('en-US') : v.toFixed(1);
  return `${text} ${name}${text === '1' ? '' : 's'}`;
}

export type ToWorker =
  | { type: 'reset'; seed: string }
  | { type: 'view'; path: string }
  | { type: 'record'; path: string }
  | { type: 'step'; n?: number }
  | { type: 'goto'; tick: number }
  | { type: 'speed'; index: number }
  | { type: 'delta'; path: string; patch: { inspected?: boolean } };

export type FromWorker =
  | { type: 'view'; view: View }
  | { type: 'record'; record: RecordData }
  | { type: 'tick'; tick: number; dyn: Dyn | null; events: SimEvent[]; tps: number; speed: number; maxTick: number }
  | { type: 'error'; message: string };
