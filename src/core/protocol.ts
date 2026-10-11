import type { Dyn, RecordData, SimEvent, View } from './types';

/** Target ticks per second for each speed button. Index 0 is Pause. 1 tick = 1 hour, so Nx runs N sim hours per second. */
export const SPEED_TPS = [0, 1, 24, 168, 720, 8760] as const;
export const SPEED_LABELS = ['Pause', '1x', '24x', '168x', '720x', '8760x'] as const;
export const SPEED_HINTS = ['Paused', '1 hour per second', '1 day per second', '1 week per second', '30 days per second', '1 year per second'] as const;

export type ToWorker =
  | { type: 'reset'; seed: string }
  | { type: 'view'; path: string }
  | { type: 'record'; path: string }
  | { type: 'step'; n?: number }
  | { type: 'speed'; index: number }
  | { type: 'delta'; path: string; patch: { inspected?: boolean } };

export type FromWorker =
  | { type: 'view'; view: View }
  | { type: 'record'; record: RecordData }
  | { type: 'tick'; tick: number; dyn: Dyn | null; events: SimEvent[]; tps: number; speed: number }
  | { type: 'error'; message: string };
