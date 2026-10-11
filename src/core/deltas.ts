// The generated universe is the baseline. Only changes (deltas) are stored,
// keyed by path, so saves stay tiny and a universe can be shared by seed.

export interface Delta {
  inspected?: boolean;
}

export class DeltaStore {
  private m = new Map<string, Delta>();

  get(path: string): Delta | undefined {
    return this.m.get(path);
  }

  patch(path: string, patch: Delta): void {
    this.m.set(path, { ...this.m.get(path), ...patch });
  }

  isInspected(path: string): boolean {
    return this.m.get(path)?.inspected === true;
  }

  toJSON(): Record<string, Delta> {
    return Object.fromEntries(this.m);
  }

  static fromJSON(data: Record<string, Delta>): DeltaStore {
    const s = new DeltaStore();
    for (const [k, v] of Object.entries(data)) s.m.set(k, v);
    return s;
  }
}
