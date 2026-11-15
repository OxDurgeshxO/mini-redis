import fs from "fs";
import path from "path";
import { TtlScheduler } from "./ttl.js";
import { EvictionPolicy } from "../protocol/resp/types.js";
import { metrics } from "../observability/metrics.js";

export interface StoreEntry {
  value: string;
  type: "string";
  createdAt: number;
  lastAccessedAt: number;
  expiresAt: number | null; // epoch timestamp in ms or null
}

export interface StoreOptions {
  maxMemoryBytes?: number;
  evictionPolicy?: EvictionPolicy;
}

export class KeyValueStore {
  private store: Map<string, StoreEntry> = new Map();
  private hashes: Map<string, Map<string, string>> = new Map();
  private sets: Map<string, Set<string>> = new Map();
  private maxMemoryBytes: number = 0; // 0 = unlimited
  private evictionPolicy: EvictionPolicy = "noeviction";
  private ttlScheduler: TtlScheduler;

  constructor(options?: StoreOptions) {
    if (options?.maxMemoryBytes) {
      this.maxMemoryBytes = options.maxMemoryBytes;
    }
    if (options?.evictionPolicy) {
      this.evictionPolicy = options.evictionPolicy;
    }

    this.ttlScheduler = new TtlScheduler(
      (key) => {
        this.delete(key);
        metrics.incrementExpiredKeys(1);
      },
      (count) => {
        const results: [string, number][] = [];
        for (const [k, entry] of this.store.entries()) {
          if (entry.expiresAt !== null) {
            results.push([k, entry.expiresAt]);
            if (results.length >= count) break;
          }
        }
        return results;
      }
    );
    this.ttlScheduler.start(100);
  }

  public setConfig(param: string, value: string): boolean {
    const p = param.toLowerCase();
    if (p === "maxmemory") {
      this.maxMemoryBytes = parseInt(value, 10) || 0;
      return true;
    }
    if (p === "maxmemory-policy") {
      if (value === "noeviction" || value === "allkeys-lru" || value === "volatile-ttl") {
        this.evictionPolicy = value;
        return true;
      }
    }
    return false;
  }

  public getConfig(param: string): string | null {
    const p = param.toLowerCase();
    if (p === "maxmemory") return this.maxMemoryBytes.toString();
    if (p === "maxmemory-policy") return this.evictionPolicy;
    return null;
  }

  public getEstimatedMemory(): number {
    let bytes = 0;
    for (const [k, v] of this.store.entries()) {
      bytes += Buffer.byteLength(k, "utf-8") + Buffer.byteLength(v.value, "utf-8") + 64;
    }
    for (const [k, m] of this.hashes.entries()) {
      bytes += Buffer.byteLength(k, "utf-8") + 64;
      for (const [hk, hv] of m.entries()) {
        bytes += Buffer.byteLength(hk, "utf-8") + Buffer.byteLength(hv, "utf-8") + 32;
      }
    }
    for (const [k, s] of this.sets.entries()) {
      bytes += Buffer.byteLength(k, "utf-8") + 64;
      for (const m of s.values()) {
        bytes += Buffer.byteLength(m, "utf-8") + 32;
      }
    }
    return bytes;
  }

  private evictIfNecessary(requiredBytes: number): void {
    if (this.maxMemoryBytes <= 0) return;

    while (this.getEstimatedMemory() + requiredBytes > this.maxMemoryBytes) {
      if (this.evictionPolicy === "noeviction") {
        throw new Error("OOM command not allowed when used memory > 'maxmemory'");
      }

      let candidateKey: string | null = null;

      if (this.evictionPolicy === "allkeys-lru") {
        let oldestAccess = Infinity;
        for (const [k, entry] of this.store.entries()) {
          if (entry.lastAccessedAt < oldestAccess) {
            oldestAccess = entry.lastAccessedAt;
            candidateKey = k;
          }
        }
      } else if (this.evictionPolicy === "volatile-ttl") {
        let shortestTtl = Infinity;
        for (const [k, entry] of this.store.entries()) {
          if (entry.expiresAt !== null && entry.expiresAt < shortestTtl) {
            shortestTtl = entry.expiresAt;
            candidateKey = k;
          }
        }
      }

      if (!candidateKey) {
        throw new Error("OOM command not allowed when used memory > 'maxmemory' and no keys eligible for eviction");
      }

      this.delete(candidateKey);
      metrics.incrementEvictedKeys(1);
    }
  }

  // --- String Key-Value Operations ---
  public set(
    key: string,
    value: string,
    ttlMs?: number,
    nx?: boolean,
    xx?: boolean
  ): boolean {
    const existing = this.get(key);
    if (nx && existing !== null) return false;
    if (xx && existing === null) return false;

    const estimatedSize = Buffer.byteLength(key, "utf-8") + Buffer.byteLength(value, "utf-8") + 64;
    this.evictIfNecessary(estimatedSize);

    const now = Date.now();
    const expiresAt = ttlMs !== undefined ? now + ttlMs : null;
    this.store.set(key, {
      value,
      type: "string",
      createdAt: now,
      lastAccessedAt: now,
      expiresAt
    });
    return true;
  }

  public get(key: string): string | null {
    const entry = this.store.get(key);
    if (!entry) return null;

    if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      metrics.incrementExpiredKeys(1);
      return null;
    }

    entry.lastAccessedAt = Date.now();
    return entry.value;
  }

  public getDel(key: string): string | null {
    const val = this.get(key);
    if (val !== null) {
      this.delete(key);
    }
    return val;
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

  public expire(key: string, seconds: number): boolean {
    const entry = this.store.get(key);
    if (!entry) return false;
    if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return false;
    }
    entry.expiresAt = Date.now() + seconds * 1000;
    return true;
  }

  public ttl(key: string): number {
    const entry = this.store.get(key);
    if (!entry) return -2; // Key does not exist
    if (entry.expiresAt === null) return -1; // Key exists with no expiry

    const remainingMs = entry.expiresAt - Date.now();
    if (remainingMs <= 0) {
      this.store.delete(key);
      metrics.incrementExpiredKeys(1);
      return -2;
    }
    return Math.floor(remainingMs / 1000);
  }

  public persist(key: string): boolean {
    const entry = this.store.get(key);
    if (!entry || entry.expiresAt === null) return false;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return false;
    }
    entry.expiresAt = null;
    return true;
  }

  public keys(pattern: string): string[] {
    const allKeys: string[] = [];
    const now = Date.now();

    for (const [k, v] of this.store.entries()) {
      if (v.expiresAt !== null && now > v.expiresAt) continue;
      allKeys.push(k);
    }
    for (const k of this.hashes.keys()) {
      if (!allKeys.includes(k)) allKeys.push(k);
    }
    for (const k of this.sets.keys()) {
      if (!allKeys.includes(k)) allKeys.push(k);
    }

    if (pattern === "*") return allKeys;

    const regex = new RegExp("^" + pattern.replace(/\*/g, ".*").replace(/\?/g, ".") + "$");
    return allKeys.filter((k) => regex.test(k));
  }

  public type(key: string): string {
    if (this.get(key) !== null) return "string";
    if (this.hashes.has(key)) return "hash";
    if (this.sets.has(key)) return "set";
    return "none";
  }

  public rename(oldKey: string, newKey: string): boolean {
    const val = this.get(oldKey);
    if (val === null) return false;

    const entry = this.store.get(oldKey)!;
    const ttlMs = entry.expiresAt !== null ? Math.max(0, entry.expiresAt - Date.now()) : undefined;

    this.delete(oldKey);
    this.set(newKey, val, ttlMs);
    return true;
  }

  public incr(key: string, delta: number = 1): number {
    const current = this.get(key);
    let num = 0;
    if (current !== null) {
      num = parseInt(current, 10);
      if (isNaN(num)) {
        throw new Error("value is not an integer or out of range");
      }
    }
    num += delta;
    this.set(key, num.toString());
    return num;
  }

  public append(key: string, value: string): number {
    const current = this.get(key) ?? "";
    const updated = current + value;
    this.set(key, updated);
    return Buffer.byteLength(updated, "utf-8");
  }

  public strlen(key: string): number {
    const current = this.get(key);
    if (current === null) return 0;
    return Buffer.byteLength(current, "utf-8");
  }

  public flushdb(): void {
    this.store.clear();
    this.hashes.clear();
    this.sets.clear();
  }

  public dbsize(): number {
    let count = 0;
    const now = Date.now();
    for (const [_, v] of this.store.entries()) {
      if (v.expiresAt === null || now <= v.expiresAt) count++;
    }
    count += this.hashes.size;
    count += this.sets.size;
    return count;
  }

  // --- Hashes ---
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

  // --- Sets ---
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

  // Export raw data for RDB / Compaction
  public getAllEntries(): Array<{ key: string; value: string; expiresAt: number | null }> {
    const entries: Array<{ key: string; value: string; expiresAt: number | null }> = [];
    const now = Date.now();
    for (const [k, v] of this.store.entries()) {
      if (v.expiresAt === null || now <= v.expiresAt) {
        entries.push({ key: k, value: v.value, expiresAt: v.expiresAt });
      }
    }
    return entries;
  }

  public getAllHashes(): Array<{ key: string; fields: [string, string][] }> {
    const res: Array<{ key: string; fields: [string, string][] }> = [];
    for (const [k, map] of this.hashes.entries()) {
      res.push({ key: k, fields: Array.from(map.entries()) });
    }
    return res;
  }

  public getAllSets(): Array<{ key: string; members: string[] }> {
    const res: Array<{ key: string; members: string[] }> = [];
    for (const [k, set] of this.sets.entries()) {
      res.push({ key: k, members: Array.from(set.values()) });
    }
    return res;
  }

  // Compatibility helpers
  public saveRdb(filepath: string = "dump.rdb"): void {
    const dir = path.dirname(filepath);
    if (dir && dir !== "." && !fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const data = {
      version: 1,
      timestamp: Date.now(),
      store: this.getAllEntries(),
      hashes: this.getAllHashes(),
      sets: this.getAllSets()
    };
    fs.writeFileSync(filepath, JSON.stringify(data, null, 2), "utf-8");
  }

  public loadRdb(filepath: string = "dump.rdb"): boolean {
    if (!fs.existsSync(filepath)) return false;
    try {
      const content = fs.readFileSync(filepath, "utf-8");
      const data = JSON.parse(content);
      const now = Date.now();
      if (Array.isArray(data.store)) {
        for (const item of data.store) {
          if (item.expiresAt === null || now <= item.expiresAt) {
            this.store.set(item.key, {
              value: item.value,
              type: "string",
              createdAt: now,
              lastAccessedAt: now,
              expiresAt: item.expiresAt
            });
          }
        }
      }
      if (Array.isArray(data.hashes)) {
        for (const h of data.hashes) {
          const map = new Map<string, string>(h.fields);
          this.hashes.set(h.key, map);
        }
      }
      if (Array.isArray(data.sets)) {
        for (const s of data.sets) {
          this.sets.set(s.key, new Set<string>(s.members));
        }
      }
      return true;
    } catch {
      return false;
    }
  }

  public destroy(): void {
    this.ttlScheduler.stop();
  }
}
