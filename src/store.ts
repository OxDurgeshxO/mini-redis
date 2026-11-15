interface StoreEntry {
  value: string;
  expiresAt: number | null; // epoch timestamp in ms, or null if persistent
}

export class KeyValueStore {
  private store: Map<string, StoreEntry> = new Map();

  public set(key: string, value: string, ttlMs?: number): void {
    const expiresAt = ttlMs !== undefined ? Date.now() + ttlMs : null;
    this.store.set(key, { value, expiresAt });
  }

  public get(key: string): string | null {
    const entry = this.store.get(key);
    if (!entry) return null;

    if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }

    return entry.value;
  }

  public delete(key: string): boolean {
    const entry = this.store.get(key);
    if (!entry) return false;

    // Check if expired
    if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return false;
    }

    return this.store.delete(key);
  }

  public exists(key: string): boolean {
    return this.get(key) !== null;
  }

  public clear(): void {
    this.store.clear();
  }

  public size(): number {
    // Purge expired keys on count
    const now = Date.now();
    for (const [k, v] of this.store.entries()) {
      if (v.expiresAt !== null && now > v.expiresAt) {
        this.store.delete(k);
      }
    }
    return this.store.size;
  }
}
