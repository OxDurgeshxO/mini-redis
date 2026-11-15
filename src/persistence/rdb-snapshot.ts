import fs from "fs";
import path from "path";
import crypto from "crypto";
import { KeyValueStore } from "../storage/memory-store.js";
import { logger } from "../observability/logger.js";

export class RdbSnapshotEngine {
  private filepath: string;
  private isSaving = false;

  constructor(filepath: string = "dump.rdb") {
    this.filepath = filepath;
  }

  public save(store: KeyValueStore): boolean {
    if (this.isSaving) return false;
    this.isSaving = true;

    try {
      const dir = path.dirname(this.filepath);
      if (dir && dir !== "." && !fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const rawData = {
        strings: {} as Record<string, { value: string; expiresAt: number | null }>,
        hashes: {} as Record<string, Record<string, string>>,
        sets: {} as Record<string, string[]>
      };

      for (const entry of store.getAllEntries()) {
        rawData.strings[entry.key] = { value: entry.value, expiresAt: entry.expiresAt };
      }
      for (const h of store.getAllHashes()) {
        rawData.hashes[h.key] = Object.fromEntries(h.fields);
      }
      for (const s of store.getAllSets()) {
        rawData.sets[s.key] = s.members;
      }

      const rawJson = JSON.stringify(rawData);
      const checksum = crypto.createHash("sha256").update(rawJson).digest("hex");

      const envelope = {
        format: "REDIS0009",
        version: 2,
        createdAt: Date.now(),
        checksum,
        ...rawData
      };

      const magic = Buffer.from("REDIS0009", "utf-8");
      const payload = Buffer.from(JSON.stringify(envelope), "utf-8");
      const eof = Buffer.from([0xff]);
      const fileBuffer = Buffer.concat([magic, payload, eof]);

      // Atomic write via temp file
      const tempPath = `${this.filepath}.tmp.${Date.now()}`;
      fs.writeFileSync(tempPath, fileBuffer);
      if (fs.existsSync(this.filepath)) {
        try {
          fs.unlinkSync(this.filepath);
        } catch {}
      }
      fs.renameSync(tempPath, this.filepath);

      logger.info("RDB snapshot saved successfully", {
        path: this.filepath,
        checksum: checksum.slice(0, 12),
        keys: Object.keys(rawData.strings).length
      });
      return true;
    } catch (err) {
      logger.error("Failed to save RDB snapshot", { error: String(err) });
      return false;
    } finally {
      this.isSaving = false;
    }
  }

  public bgsave(store: KeyValueStore): Promise<boolean> {
    return new Promise((resolve) => {
      setImmediate(() => {
        const res = this.save(store);
        resolve(res);
      });
    });
  }

  public restore(store: KeyValueStore): boolean {
    if (!fs.existsSync(this.filepath)) return false;

    try {
      const fileBuffer = fs.readFileSync(this.filepath);
      if (fileBuffer.length < 10) return false;

      const magic = fileBuffer.subarray(0, 9).toString("utf-8");
      if (magic !== "REDIS0009") {
        logger.warn("Unrecognized RDB snapshot header magic", { magic });
        return false;
      }

      const eofIndex = fileBuffer.lastIndexOf(0xff);
      const jsonEnd = eofIndex > 9 ? eofIndex : fileBuffer.length;
      const jsonStr = fileBuffer.subarray(9, jsonEnd).toString("utf-8");
      const data = JSON.parse(jsonStr);

      // Verify SHA-256 integrity checksum if present
      if (data.checksum) {
        const rawToVerify = {
          strings: data.strings ?? {},
          hashes: data.hashes ?? {},
          sets: data.sets ?? {}
        };
        const computed = crypto.createHash("sha256").update(JSON.stringify(rawToVerify)).digest("hex");
        if (computed !== data.checksum) {
          logger.error("RDB snapshot checksum verification failed - corrupted snapshot", {
            expected: data.checksum,
            actual: computed
          });
          return false;
        }
      }

      const now = Date.now();

      // Restore strings
      if (data.strings && typeof data.strings === "object") {
        for (const [k, v] of Object.entries(data.strings as Record<string, any>)) {
          if (v && typeof v === "object" && "value" in v) {
            if (v.expiresAt === null || v.expiresAt > now) {
              const ttlMs = v.expiresAt !== null ? Math.max(0, v.expiresAt - now) : undefined;
              store.set(k, v.value, ttlMs);
            }
          } else if (typeof v === "string") {
            store.set(k, v);
          }
        }
      }

      // Restore hashes
      if (data.hashes && typeof data.hashes === "object") {
        for (const [hk, hmap] of Object.entries(data.hashes as Record<string, Record<string, string>>)) {
          for (const [field, val] of Object.entries(hmap)) {
            store.hset(hk, field, val);
          }
        }
      }

      // Restore sets
      if (data.sets && typeof data.sets === "object") {
        for (const [sk, members] of Object.entries(data.sets as Record<string, string[]>)) {
          store.sadd(sk, members);
        }
      }

      logger.info("RDB snapshot restored successfully", { keys: store.dbsize() });
      return true;
    } catch (err) {
      logger.error("Error restoring RDB snapshot", { error: String(err) });
      return false;
    }
  }
}
