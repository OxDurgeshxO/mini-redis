import net from "net";
import { KeyValueStore } from "../storage/memory-store.js";
import { CommandRouter } from "./router.js";
import { ClientConnection } from "./connection.js";
import { AofEngine, FsyncPolicy } from "../persistence/aof.js";
import { RdbSnapshotEngine } from "../persistence/rdb-snapshot.js";
import { RecoveryManager } from "../persistence/recovery.js";
import { ProtocolVersion, EvictionPolicy } from "../protocol/resp/types.js";
import { metrics } from "../observability/metrics.js";
import { logger } from "../observability/logger.js";

export interface ServerOptions {
  port?: number;
  maxClients?: number;
  rdbPath?: string;
  aofPath?: string;
  enableAof?: boolean;
  fsyncPolicy?: FsyncPolicy;
  maxMemoryBytes?: number;
  evictionPolicy?: EvictionPolicy;
  metricsPort?: number;
}

export class MiniRedisServer {
  private server: net.Server;
  private store: KeyValueStore;
  private router: CommandRouter;
  private connections: Map<string, ClientConnection> = new Map();
  private aofEngine?: AofEngine;
  private rdbEngine?: RdbSnapshotEngine;
  private port: number;
  private maxClients: number;
  private nextConnectionId = 1;
  private isShuttingDown = false;

  constructor(optionsOrPort?: number | ServerOptions, legacyRdbPath?: string) {
    let options: ServerOptions = {};
    if (typeof optionsOrPort === "number") {
      options = {
        port: optionsOrPort,
        rdbPath: legacyRdbPath ?? "dump.rdb",
        enableAof: false
      };
    } else if (optionsOrPort) {
      options = optionsOrPort;
    }

    this.port = options.port ?? 6379;
    this.maxClients = options.maxClients ?? 10000;

    // 1. Initialize Storage
    this.store = new KeyValueStore({
      maxMemoryBytes: options.maxMemoryBytes,
      evictionPolicy: options.evictionPolicy
    });

    // 2. Initialize Persistence Engines
    const rdbPath = options.rdbPath ?? "dump.rdb";
    this.rdbEngine = new RdbSnapshotEngine(rdbPath);

    const enableAof = options.enableAof ?? false;
    if (enableAof) {
      const aofPath = options.aofPath ?? "appendonly.aof";
      this.aofEngine = new AofEngine(aofPath, options.fsyncPolicy ?? "everysec");
      this.aofEngine.init();
    }

    // 3. Database Recovery
    RecoveryManager.recover(this.store, this.aofEngine, this.rdbEngine, enableAof);

    // 4. Initialize Command Router
    this.router = new CommandRouter(this.store, this.aofEngine, this.rdbEngine);

    // 5. Initialize TCP Listener
    this.server = net.createServer((socket: net.Socket) => {
      this.handleNewConnection(socket);
    });

    // 6. Metrics HTTP listener (port default 9121 or options.metricsPort)
    if (options.metricsPort !== undefined && options.metricsPort > 0) {
      metrics.startHttpServer(options.metricsPort, () => ({
        memoryBytes: this.store.getEstimatedMemory(),
        keysCount: this.store.dbsize()
      }));
    }
  }

  private handleNewConnection(socket: net.Socket): void {
    if (this.isShuttingDown || this.connections.size >= this.maxClients) {
      socket.write(Buffer.from("-ERR max number of clients reached\r\n", "utf-8"));
      socket.destroy();
      return;
    }

    const connectionId = `conn_${this.nextConnectionId++}`;
    const conn = new ClientConnection(
      connectionId,
      socket,
      this.router,
      () => {
        this.connections.delete(connectionId);
        metrics.setConnectedClients(this.connections.size);
      }
    );

    this.connections.set(connectionId, conn);
    metrics.setConnectedClients(this.connections.size);
  }

  public executeCommand(args: string[], proto: ProtocolVersion = 2): Buffer {
    const { response } = this.router.dispatch(args, proto, this.connections.size);
    return response;
  }

  public listen(port?: number): Promise<void> {
    const targetPort = port ?? this.port;
    return new Promise((resolve, reject) => {
      this.server.listen(targetPort, () => {
        logger.info(`mini-redis server listening on port ${targetPort}`, {
          port: targetPort,
          maxClients: this.maxClients
        });
        resolve();
      });
      this.server.on("error", (err) => reject(err));
    });
  }

  public async close(): Promise<void> {
    this.isShuttingDown = true;

    // 1. Drain and close all client connections
    for (const [_, conn] of this.connections) {
      conn.destroy();
    }
    this.connections.clear();

    // 2. Stop storage TTL scheduler
    this.store.destroy();

    // 3. Flush and close AOF engine
    if (this.aofEngine) {
      this.aofEngine.close();
    }

    // 4. Stop metrics HTTP server
    metrics.stopHttpServer();

    // 5. Close TCP server
    return new Promise((resolve) => {
      this.server.close(() => {
        logger.info("mini-redis server shutdown cleanly");
        resolve();
      });
    });
  }

  public getStore(): KeyValueStore {
    return this.store;
  }
}
