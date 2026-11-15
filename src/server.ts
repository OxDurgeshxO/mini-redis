import net from "net";
import { RespParser, RespEncoder, ProtocolVersion } from "./resp.js";
import { KeyValueStore } from "./store.js";
import { AofEngine, FsyncPolicy } from "./persistence/aof.js";

export interface ServerOptions {
  port?: number;
  rdbPath?: string;
  aofPath?: string;
  enableAof?: boolean;
  fsyncPolicy?: FsyncPolicy;
}

export class MiniRedisServer {
  private server: net.Server;
  private store: KeyValueStore = new KeyValueStore();
  private port: number;
  private rdbPath: string;
  private aofEngine?: AofEngine;
  private enableAof: boolean;

  constructor(optionsOrPort?: number | ServerOptions, rdbPath?: string) {
    if (typeof optionsOrPort === "number") {
      this.port = optionsOrPort;
      this.rdbPath = rdbPath ?? "dump.rdb";
      this.enableAof = false;
      this.store.loadRdb(this.rdbPath);
    } else {
      const options = optionsOrPort ?? {};
      this.port = options.port ?? 6379;
      this.rdbPath = options.rdbPath ?? "dump.rdb";
      this.enableAof = options.enableAof ?? false;

      // Load snapshot or replay AOF on boot
      if (this.enableAof) {
        const aofPath = options.aofPath ?? "appendonly.aof";
        this.aofEngine = new AofEngine(aofPath, options.fsyncPolicy ?? "everysec");
        this.aofEngine.init();
        this.aofEngine.replay(this.store);
      } else {
        this.store.loadRdb(this.rdbPath);
      }
    }

    this.server = net.createServer((socket: net.Socket) => {
      this.handleConnection(socket);
    });
  }

  private handleConnection(socket: net.Socket): void {
    const parser = new RespParser();
    let clientProto: ProtocolVersion = 2; // Default to RESP2 until HELLO 3

    socket.on("data", (data: Buffer) => {
      parser.append(data);

      while (true) {
        const commandArgs = parser.parse();
        if (!commandArgs || commandArgs.length === 0) break;

        const cmd = commandArgs[0].toUpperCase();
        if (cmd === "HELLO") {
          const targetVer = commandArgs[1] ? parseInt(commandArgs[1], 10) : 3;
          if (targetVer === 3) {
            clientProto = 3;
          } else {
            clientProto = 2;
          }
        }

        const response = this.executeCommand(commandArgs, clientProto);
        socket.write(response);
      }
    });

    socket.on("error", (_err: Error) => {
      // Gracefully handle client disconnects
    });
  }

  public executeCommand(args: string[], proto: ProtocolVersion = 2): Buffer {
    const cmd = args[0].toUpperCase();

    switch (cmd) {
      case "HELLO": {
        const ver = args[1] ? parseInt(args[1], 10) : 3;
        const protoVer: ProtocolVersion = ver === 3 ? 3 : 2;
        const info: [string, string][] = [
          ["server", "mini-redis"],
          ["version", "1.1.0"],
          ["proto", protoVer.toString()],
          ["mode", "standalone"],
          ["role", "master"]
        ];
        return RespEncoder.map(info, protoVer);
      }

      case "PING": {
        const message = args[1];
        return RespEncoder.pong(message);
      }

      case "ECHO": {
        if (args.length < 2) return RespEncoder.error("wrong number of arguments for 'echo' command");
        return RespEncoder.bulkString(args[1]);
      }

      case "SET": {
        if (args.length < 3) return RespEncoder.error("wrong number of arguments for 'set' command");
        const key = args[1];
        const value = args[2];
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

        this.store.set(key, value, ttlMs);
        if (this.aofEngine) {
          this.aofEngine.write(args);
        }
        return RespEncoder.ok();
      }

      case "GET": {
        if (args.length < 2) return RespEncoder.error("wrong number of arguments for 'get' command");
        const key = args[1];
        const val = this.store.get(key);
        return val === null ? RespEncoder.null(proto) : RespEncoder.bulkString(val);
      }

      case "DEL": {
        if (args.length < 2) return RespEncoder.error("wrong number of arguments for 'del' command");
        let deletedCount = 0;
        for (let i = 1; i < args.length; i++) {
          if (this.store.delete(args[i])) {
            deletedCount++;
          }
        }
        if (deletedCount > 0 && this.aofEngine) {
          this.aofEngine.write(args);
        }
        return RespEncoder.integer(deletedCount);
      }

      case "EXISTS": {
        if (args.length < 2) return RespEncoder.error("wrong number of arguments for 'exists' command");
        let existsCount = 0;
        for (let i = 1; i < args.length; i++) {
          if (this.store.exists(args[i])) {
            existsCount++;
          }
        }
        return RespEncoder.integer(existsCount);
      }

      case "DBSIZE": {
        return RespEncoder.integer(this.store.size());
      }

      // --- Hash Commands ---
      case "HSET": {
        if (args.length < 4 || (args.length - 2) % 2 !== 0) {
          return RespEncoder.error("wrong number of arguments for 'hset' command");
        }
        const key = args[1];
        let count = 0;
        for (let i = 2; i + 1 < args.length; i += 2) {
          count += this.store.hset(key, args[i], args[i + 1]);
        }
        if (this.aofEngine) {
          this.aofEngine.write(args);
        }
        return RespEncoder.integer(count);
      }

      case "HGET": {
        if (args.length < 3) return RespEncoder.error("wrong number of arguments for 'hget' command");
        const key = args[1];
        const field = args[2];
        const val = this.store.hget(key, field);
        return val === null ? RespEncoder.null(proto) : RespEncoder.bulkString(val);
      }

      case "HGETALL": {
        if (args.length < 2) return RespEncoder.error("wrong number of arguments for 'hgetall' command");
        const key = args[1];
        const entries = this.store.hgetall(key);
        return RespEncoder.map(entries, proto);
      }

      // --- Set Commands ---
      case "SADD": {
        if (args.length < 3) return RespEncoder.error("wrong number of arguments for 'sadd' command");
        const key = args[1];
        const members = args.slice(2);
        const added = this.store.sadd(key, members);
        if (added > 0 && this.aofEngine) {
          this.aofEngine.write(args);
        }
        return RespEncoder.integer(added);
      }

      case "SMEMBERS": {
        if (args.length < 2) return RespEncoder.error("wrong number of arguments for 'smembers' command");
        const key = args[1];
        const members = this.store.smembers(key);
        return RespEncoder.set(members, proto);
      }

      case "SISMEMBER": {
        if (args.length < 3) return RespEncoder.error("wrong number of arguments for 'sismember' command");
        const key = args[1];
        const member = args[2];
        const exists = this.store.sismember(key, member);
        return proto === 3 ? RespEncoder.boolean(exists) : RespEncoder.integer(exists ? 1 : 0);
      }

      // --- Persistence Commands ---
      case "SAVE": {
        try {
          this.store.saveRdb(this.rdbPath);
          return RespEncoder.ok();
        } catch (err: any) {
          return RespEncoder.error(`save failed: ${err.message}`);
        }
      }

      case "BGSAVE": {
        setImmediate(() => {
          try {
            this.store.saveRdb(this.rdbPath);
          } catch {
            // Background save error handling
          }
        });
        return RespEncoder.simpleString("Background saving started");
      }

      case "BGREWRITEAOF": {
        if (!this.aofEngine) {
          return RespEncoder.error("AOF persistence is not enabled");
        }
        setImmediate(async () => {
          try {
            await this.aofEngine!.rewrite(this.store);
          } catch {
            // Background rewrite error handling
          }
        });
        return RespEncoder.simpleString("Background append only file rewriting started");
      }

      case "COMMAND": {
        return RespEncoder.ok();
      }

      default:
        return RespEncoder.error(`unknown command '${args[0]}'`);
    }
  }

  public listen(callback?: () => void): void {
    this.server.listen(this.port, "0.0.0.0", callback);
  }

  public close(): Promise<void> {
    if (this.aofEngine) {
      this.aofEngine.close();
    }
    return new Promise((resolve) => {
      this.server.close(() => resolve());
    });
  }
}
