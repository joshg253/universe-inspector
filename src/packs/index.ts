import { fantasy } from './fantasy';
import { scifi } from './scifi';
import type { Pack } from './types';

export const PACKS: Record<string, Pack> = { scifi, fantasy };
export const DEFAULT_PACK_ID = 'scifi';

export function packOf(id: string): Pack {
  return PACKS[id] ?? PACKS[DEFAULT_PACK_ID]!;
}
