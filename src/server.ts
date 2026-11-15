import net from "net";
import { RespParser, RespEncoder } from "./resp.js";
import { KeyValueStore } from "./store.js";

export class MiniRedisServer {
  private server: net.Server;
  private store: KeyValueStore = new KeyValueStore();
  private port: number;

  constructor(port: number = 6379) {
    this.port = port;
    this.server = net.createServer((socket: net.Socket) => {
      this.handleConnection(socket);
    });
  }

  private handleConnection(socket: net.Socket): void {
    const parser = new RespParser();

    socket.on("data", (data: Buffer) => {
      parser.append(data);

      while (true) {
        const commandArgs = parser.parse();
        if (!commandArgs || commandArgs.length === 0) break;

        const response = this.executeCommand(commandArgs);
        socket.write(response);
      }
    });

    socket.on("error", (err: Error) => {
      // Gracefully handle client disconnects
    });
  }

  public executeCommand(args: string[]): Buffer {
    const cmd = args[0].toUpperCase();

    switch (cmd) {
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

        // Parse optional arguments: PX <ms> or EX <sec>
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
        return RespEncoder.ok();
      }

      case "GET": {
        if (args.length < 2) return RespEncoder.error("wrong number of arguments for 'get' command");
        const key = args[1];
        const val = this.store.get(key);
        return RespEncoder.bulkString(val);
      }

      case "DEL": {
        if (args.length < 2) return RespEncoder.error("wrong number of arguments for 'del' command");
        let deletedCount = 0;
        for (let i = 1; i < args.length; i++) {
          if (this.store.delete(args[i])) {
            deletedCount++;
          }
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

      case "COMMAND": {
        // Handle redis-cli handshake COMMAND DOCS
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
    return new Promise((resolve) => {
      this.server.close(() => resolve());
    });
  }
}
