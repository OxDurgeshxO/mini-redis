import fs from "fs";
import path from "path";
import { RespEncoder, RespParser } from "../resp.js";
import { KeyValueStore } from "../store.js";

export type FsyncPolicy = "always" | "everysec" | "no";

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
        for (let i = 3; i < args.length; i++) {
          const opt = args[i].toUpperCase();
          if (opt === "PX" && i + 1 < args.length) {
            ttlMs = parseInt(args[i + 1], 10);
            i++;
          } else if (opt === "EX" && i + 1 < args.length) {
            ttlMs = parseInt(args[i + 1], 10) * 1000;
            i++;
          }
        }
        store.set(key, val, ttlMs);
      } else if (cmd === "DEL") {
        for (let i = 1; i < args.length; i++) {
          store.delete(args[i]);
        }
      } else if (cmd === "HSET") {
        const key = args[1];
        for (let i = 2; i + 1 < args.length; i += 2) {
          store.hset(key, args[i], args[i + 1]);
        }
      } else if (cmd === "SADD") {
        const key = args[1];
        store.sadd(key, args.slice(2));
      }
      replayedCommands++;
    }

    return replayedCommands;
  }

  public async rewrite(store: KeyValueStore): Promise<void> {
    const tmpPath = `${this.filepath}.rewrite.tmp`;
    const tmpFd = fs.openSync(tmpPath, "w");

    try {
      // Rebuild string commands
      for (const [key, value, remainingTtlMs] of store.getAllStrings()) {
        const args = ["SET", key, value];
        if (remainingTtlMs !== null && remainingTtlMs > 0) {
          args.push("PX", Math.floor(remainingTtlMs).toString());
        }
        const buf = RespEncoder.commandToBuffer(args);
        fs.writeSync(tmpFd, buf, 0, buf.length, null);
      }

      // Rebuild hashes
      for (const [key, fields] of store.getAllHashes()) {
        if (fields.length === 0) continue;
        const args = ["HSET", key];
        for (const [f, v] of fields) {
          args.push(f, v);
        }
        const buf = RespEncoder.commandToBuffer(args);
        fs.writeSync(tmpFd, buf, 0, buf.length, null);
      }

      // Rebuild sets
      for (const [key, members] of store.getAllSets()) {
        if (members.length === 0) continue;
        const args = ["SADD", key, ...members];
        const buf = RespEncoder.commandToBuffer(args);
        fs.writeSync(tmpFd, buf, 0, buf.length, null);
      }

      fs.fsyncSync(tmpFd);
    } finally {
      fs.closeSync(tmpFd);
    }

    // Safely close active fd before atomic swap
    if (this.fd) {
      this.flush(true);
      fs.closeSync(this.fd);
      this.fd = null;
    }

    fs.renameSync(tmpPath, this.filepath);
    this.fd = fs.openSync(this.filepath, "a+");
  }

  public close(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
    if (this.fd) {
      this.flush(true);
      fs.closeSync(this.fd);
      this.fd = null;
    }
  }
}
