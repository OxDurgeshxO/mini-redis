import fs from "fs";
import path from "path";

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

  public saveRdb(filepath: string): void {
    const now = Date.now();
    const data: Record<string, { value: string; expiresAt: number | null }> = {};
    for (const [k, v] of this.store.entries()) {
      if (v.expiresAt === null || v.expiresAt > now) {
        data[k] = v;
      }
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
      const data = JSON.parse(jsonStr) as Record<string, { value: string; expiresAt: number | null }>;

      const now = Date.now();
      this.store.clear();
      for (const [k, v] of Object.entries(data)) {
        if (v.expiresAt === null || v.expiresAt > now) {
          this.store.set(k, v);
        }
      }
      return true;
    } catch {
      return false;
    }
  }
}
