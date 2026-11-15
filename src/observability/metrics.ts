import http from "http";

export class MetricsRegistry {
  private commandCounts: Map<string, number> = new Map();
  private connectedClients = 0;
  private totalCommandsProcessed = 0;
  private expiredKeysTotal = 0;
  private evictedKeysTotal = 0;
  private latencyBuckets: Map<string, number[]> = new Map(); // command -> latencies ms
  private startTime = Date.now();
  private httpServer: http.Server | null = null;

  public incrementCommand(command: string): void {
    const cmd = command.toUpperCase();
    this.commandCounts.set(cmd, (this.commandCounts.get(cmd) ?? 0) + 1);
    this.totalCommandsProcessed++;
  }

  public recordLatency(command: string, latencyMs: number): void {
    const cmd = command.toUpperCase();
    let list = this.latencyBuckets.get(cmd);
    if (!list) {
      list = [];
      this.latencyBuckets.set(cmd, list);
    }
    list.push(latencyMs);
    if (list.length > 5000) {
      list.shift(); // Bound memory
    }
  }

  public setConnectedClients(count: number): void {
    this.connectedClients = count;
  }

  public incrementExpiredKeys(count: number = 1): void {
    this.expiredKeysTotal += count;
  }

  public incrementEvictedKeys(count: number = 1): void {
    this.evictedKeysTotal += count;
  }

  public getSnapshot(memoryBytes: number, totalKeys: number): string {
    const uptimeSec = Math.floor((Date.now() - this.startTime) / 1000);
    const lines: string[] = [
      "# HELP mini_redis_uptime_seconds Number of seconds server has been running.",
      "# TYPE mini_redis_uptime_seconds gauge",
      `mini_redis_uptime_seconds ${uptimeSec}`,
      "",
      "# HELP mini_redis_connected_clients Current number of connected client sockets.",
      "# TYPE mini_redis_connected_clients gauge",
      `mini_redis_connected_clients ${this.connectedClients}`,
      "",
      "# HELP mini_redis_memory_bytes Current estimated memory usage in bytes.",
      "# TYPE mini_redis_memory_bytes gauge",
      `mini_redis_memory_bytes ${memoryBytes}`,
      "",
      "# HELP mini_redis_keys_total Total active keys in the database.",
      "# TYPE mini_redis_keys_total gauge",
      `mini_redis_keys_total ${totalKeys}`,
      "",
      "# HELP mini_redis_commands_total Total number of commands executed by type.",
      "# TYPE mini_redis_commands_total counter"
    ];

    for (const [cmd, count] of this.commandCounts.entries()) {
      lines.push(`mini_redis_commands_total{command="${cmd}"} ${count}`);
    }

    lines.push(
      "",
      "# HELP mini_redis_expired_keys_total Total keys expired via active or lazy TTL.",
      "# TYPE mini_redis_expired_keys_total counter",
      `mini_redis_expired_keys_total ${this.expiredKeysTotal}`,
      "",
      "# HELP mini_redis_evicted_keys_total Total keys evicted due to maxmemory policy.",
      "# TYPE mini_redis_evicted_keys_total counter",
      `mini_redis_evicted_keys_total ${this.evictedKeysTotal}`,
      ""
    );

    return lines.join("\n");
  }

  public getStats() {
    return {
      uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
      connectedClients: this.connectedClients,
      totalCommandsProcessed: this.totalCommandsProcessed,
      expiredKeysTotal: this.expiredKeysTotal,
      evictedKeysTotal: this.evictedKeysTotal
    };
  }

  public startHttpServer(port: number = 9121, getMemoryAndKeys: () => { memoryBytes: number; keysCount: number }): void {
    if (this.httpServer) return;

    this.httpServer = http.createServer((req, res) => {
      if (req.url === "/metrics") {
        const { memoryBytes, keysCount } = getMemoryAndKeys();
        const payload = this.getSnapshot(memoryBytes, keysCount);
        res.writeHead(200, { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" });
        res.end(payload);
      } else if (req.url === "/healthz" || req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "healthy", timestamp: new Date().toISOString() }));
      } else {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not Found\n");
      }
    });

    this.httpServer.listen(port, () => {
      // Background metrics server listening
    });

    this.httpServer.on("error", () => {
      // Port in use or permission error; handled gracefully
    });
  }

  public stopHttpServer(): void {
    if (this.httpServer) {
      this.httpServer.close();
      this.httpServer = null;
    }
  }
}

export const metrics = new MetricsRegistry();
