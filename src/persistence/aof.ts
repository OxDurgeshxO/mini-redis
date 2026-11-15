import fs from "fs";
import path from "path";
import { RespEncoder } from "../protocol/resp/encoder.js";
import { RespParser } from "../protocol/resp/parser.js";
import { KeyValueStore } from "../storage/memory-store.js";
import { FsyncPolicy } from "../protocol/resp/types.js";
import { AofCompactor } from "./compaction.js";
import { logger } from "../observability/logger.js";

export { FsyncPolicy };

export class AofEngine {
  private filepath: string;
  private policy: FsyncPolicy;
  private fd: number | null = null;
  private syncTimer: NodeJS.Timeout | null = null;
  private bufferQueue: Buffer[] = [];
  private isWriting = false;

  constructor(filepath: string = "appendonly.aof", policy: FsyncPolicy = "everysec") {
    this.filepath = filepath;
    this.policy = policy;
  }

  public init(): void {
    const dir = path.dirname(this.filepath);
    if (dir && dir !== "." && !fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.fd = fs.openSync(this.filepath, "a+");

    if (this.policy === "everysec") {
      this.syncTimer = setInterval(() => {
        this.flush(true);
      }, 1000);
      this.syncTimer.unref();
    }
  }

  public write(args: string[]): void {
    if (!this.fd) return;

    const cmdBuffer = RespEncoder.commandToBuffer(args);
    this.bufferQueue.push(cmdBuffer);

    if (this.policy === "always") {
      this.flush(true);
    } else {
      this.flush(false);
    }
  }

  public flush(sync: boolean = false): void {
    if (!this.fd || this.bufferQueue.length === 0 || this.isWriting) return;

    this.isWriting = true;
    try {
      const combined = Buffer.concat(this.bufferQueue);
      this.bufferQueue = [];
      fs.writeSync(this.fd, combined, 0, combined.length, null);

      if (sync) {
        fs.fsyncSync(this.fd);
      }
    } catch (err) {
      logger.error("Error writing AOF buffer", { error: String(err) });
    } finally {
      this.isWriting = false;
    }
  }

  public replay(store: KeyValueStore): number {
    if (!fs.existsSync(this.filepath)) return 0;

    const fileContent = fs.readFileSync(this.filepath);
    if (fileContent.length === 0) return 0;

    const parser = new RespParser();
    parser.append(fileContent);

    let replayedCommands = 0;
    while (true) {
      const args = parser.parse();
      if (!args || args.length === 0) break;

      const cmd = args[0].toUpperCase();
      if (cmd === "SET") {
        const key = args[1];
        const val = args[2];
        let ttlMs: number | undefined;
        let nx = false;
        let xx = false;

        for (let i = 3; i < args.length; i++) {
          const opt = args[i].toUpperCase();
          if (opt === "PX" && i + 1 < args.length) {
            ttlMs = parseInt(args[i + 1], 10);
            i++;
          } else if (opt === "EX" && i + 1 < args.length) {
            ttlMs = parseInt(args[i + 1], 10) * 1000;
            i++;
          } else if (opt === "NX") {
            nx = true;
          } else if (opt === "XX") {
            xx = true;
          }
        }
        store.set(key, val, ttlMs, nx, xx);
      } else if (cmd === "DEL") {
        for (let i = 1; i < args.length; i++) {
          store.delete(args[i]);
        }
      } else if (cmd === "HSET") {
        const key = args[1];
        for (let i = 2; i < args.length; i += 2) {
          if (i + 1 < args.length) {
            store.hset(key, args[i], args[i + 1]);
          }
        }
      } else if (cmd === "SADD") {
        const key = args[1];
        const members = args.slice(2);
        store.sadd(key, members);
      } else if (cmd === "INCR") {
        store.incr(args[1], 1);
      } else if (cmd === "DECR") {
        store.incr(args[1], -1);
      } else if (cmd === "APPEND") {
        store.append(args[1], args[2]);
      } else if (cmd === "EXPIRE") {
        store.expire(args[1], parseInt(args[2], 10));
      } else if (cmd === "PERSIST") {
        store.persist(args[1]);
      } else if (cmd === "RENAME") {
        store.rename(args[1], args[2]);
      } else if (cmd === "FLUSHDB") {
        store.flushdb();
      }

      replayedCommands++;
    }

    logger.info("AOF replay complete", { filepath: this.filepath, replayedCommands });
    return replayedCommands;
  }

  public rewrite(store: KeyValueStore): boolean {
    this.flush(true);
    if (this.fd !== null) {
      try {
        fs.closeSync(this.fd);
      } catch {}
      this.fd = null;
    }
    const success = AofCompactor.rewrite(store, this.filepath);
    this.fd = fs.openSync(this.filepath, "a+");
    return success;
  }

  public bgrewriteaof(store: KeyValueStore): Promise<boolean> {
    return new Promise((resolve) => {
      setImmediate(() => {
        const result = this.rewrite(store);
        resolve(result);
      });
    });
  }

  public close(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
    this.flush(true);
    if (this.fd) {
      try {
        fs.closeSync(this.fd);
      } catch {}
      this.fd = null;
    }
  }
}
