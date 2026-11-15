import fs from "fs";
import path from "path";

interface StoreEntry {
  value: string;
  expiresAt: number | null; // epoch timestamp in ms, or null if persistent
}

export class KeyValueStore {
  private store: Map<string, StoreEntry> = new Map();
  private hashes: Map<string, Map<string, string>> = new Map();
  private sets: Map<string, Set<string>> = new Map();

  // --- String Key-Value Operations ---
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
    let deleted = false;
    const entry = this.store.get(key);
    if (entry) {
      if (entry.expiresAt === null || Date.now() <= entry.expiresAt) {
        deleted = true;
      }
      this.store.delete(key);
    }
    if (this.hashes.delete(key)) deleted = true;
    if (this.sets.delete(key)) deleted = true;
    return deleted;
  }

  public exists(key: string): boolean {
    return this.get(key) !== null || this.hashes.has(key) || this.sets.has(key);
  }

  // --- Hash Operations ---
  public hset(key: string, field: string, value: string): number {
    let map = this.hashes.get(key);
    let isNewField = false;
    if (!map) {
      map = new Map();
      this.hashes.set(key, map);
      isNewField = true;
    } else {
      isNewField = !map.has(field);
    }
    map.set(field, value);
    return isNewField ? 1 : 0;
  }

  public hget(key: string, field: string): string | null {
    const map = this.hashes.get(key);
    if (!map) return null;
    return map.get(field) ?? null;
  }

  public hgetall(key: string): [string, string][] {
    const map = this.hashes.get(key);
    if (!map) return [];
    return Array.from(map.entries());
  }

  // --- Set Operations ---
  public sadd(key: string, members: string[]): number {
    let set = this.sets.get(key);
    if (!set) {
      set = new Set();
      this.sets.set(key, set);
    }
    let addedCount = 0;
    for (const m of members) {
      if (!set.has(m)) {
        set.add(m);
        addedCount++;
      }
    }
    return addedCount;
  }

  public smembers(key: string): string[] {
    const set = this.sets.get(key);
    if (!set) return [];
    return Array.from(set.values());
  }

  public sismember(key: string, member: string): boolean {
    const set = this.sets.get(key);
    if (!set) return false;
    return set.has(member);
  }

  // --- Store Utilities ---
  public clear(): void {
    this.store.clear();
    this.hashes.clear();
    this.sets.clear();
  }

  public size(): number {
    const now = Date.now();
    for (const [k, v] of this.store.entries()) {
      if (v.expiresAt !== null && now > v.expiresAt) {
        this.store.delete(k);
      }
    }
    return this.store.size + this.hashes.size + this.sets.size;
  }

  // --- Iterators for AOF and Persistence ---
  public getAllStrings(): [string, string, number | null][] {
    const now = Date.now();
    const result: [string, string, number | null][] = [];
    for (const [k, v] of this.store.entries()) {
      if (v.expiresAt === null) {
        result.push([k, v.value, null]);
      } else if (v.expiresAt > now) {
        result.push([k, v.value, v.expiresAt - now]);
      }
    }
    return result;
  }

  public getAllHashes(): [string, [string, string][]][] {
    const result: [string, [string, string][]][] = [];
    for (const [k, map] of this.hashes.entries()) {
      result.push([k, Array.from(map.entries())]);
    }
    return result;
  }

  public getAllSets(): [string, string[]][] {
    const result: [string, string[]][] = [];
    for (const [k, set] of this.sets.entries()) {
      result.push([k, Array.from(set.values())]);
    }
    return result;
  }

  // --- RDB Snapshotting ---
  public saveRdb(filepath: string): void {
    const now = Date.now();
    const data: {
      strings: Record<string, { value: string; expiresAt: number | null }>;
      hashes: Record<string, Record<string, string>>;
      sets: Record<string, string[]>;
    } = {
      strings: {},
      hashes: {},
      sets: {}
    };

    for (const [k, v] of this.store.entries()) {
      if (v.expiresAt === null || v.expiresAt > now) {
        data.strings[k] = v;
      }
    }

    for (const [k, map] of this.hashes.entries()) {
      data.hashes[k] = Object.fromEntries(map.entries());
    }

    for (const [k, set] of this.sets.entries()) {
      data.sets[k] = Array.from(set.values());
    }

    const magic = Buffer.from("REDIS0009", "utf-8");
    const payload = Buffer.from(JSON.stringify(data), "utf-8");
    const eof = Buffer.from([0xFF]);
    const fileBuffer = Buffer.concat([magic, payload, eof]);

    const dir = path.dirname(filepath);
    if (dir && dir !== "." && !fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const tmpPath = `${filepath}.tmp`;
    fs.writeFileSync(tmpPath, fileBuffer);
    fs.renameSync(tmpPath, filepath);
  }

  public loadRdb(filepath: string): boolean {
    try {
      if (!fs.existsSync(filepath)) return false;

      const fileBuffer = fs.readFileSync(filepath);
      if (fileBuffer.length < 10) return false;

      const magic = fileBuffer.subarray(0, 9).toString("utf-8");
      if (magic !== "REDIS0009") return false;

      const eofIndex = fileBuffer.lastIndexOf(0xFF);
      const jsonEnd = eofIndex > 9 ? eofIndex : fileBuffer.length;
      const jsonStr = fileBuffer.subarray(9, jsonEnd).toString("utf-8");
      const data = JSON.parse(jsonStr);

      this.clear();
      const now = Date.now();

      // Support backward compatibility if plain Record was saved
      if (data.strings) {
        for (const [k, v] of Object.entries(data.strings as Record<string, { value: string; expiresAt: number | null }>)) {
          if (v.expiresAt === null || v.expiresAt > now) {
            this.store.set(k, v);
          }
        }
        if (data.hashes) {
          for (const [k, fields] of Object.entries(data.hashes as Record<string, Record<string, string>>)) {
            this.hashes.set(k, new Map(Object.entries(fields)));
          }
        }
        if (data.sets) {
          for (const [k, items] of Object.entries(data.sets as Record<string, string[]>)) {
            this.sets.set(k, new Set(items));
          }
        }
      } else {
        // Plain key-value map
        for (const [k, v] of Object.entries(data as Record<string, { value: string; expiresAt: number | null }>)) {
          if (v.expiresAt === null || v.expiresAt > now) {
            this.store.set(k, v);
          }
        }
      }

      return true;
    } catch {
      return false;
    }
  }
}
