#!/usr/bin/env node
import { z } from "zod";
import { MiniRedisServer } from "./server/tcp-server.js";
import { logger } from "./observability/logger.js";
import { FsyncPolicy, EvictionPolicy } from "./protocol/resp/types.js";

const ConfigSchema = z.object({
  port: z.coerce.number().int().min(1).max(65535).default(6379),
  metricsPort: z.coerce.number().int().min(1).max(65535).default(9121),
  maxClients: z.coerce.number().int().min(1).default(10000),
  enableAof: z.boolean().default(true), // AOF is the default durability mode per spec
  aofPath: z.string().default("appendonly.aof"),
  fsyncPolicy: z.enum(["always", "everysec", "no"]).default("everysec"),
  rdbPath: z.string().default("dump.rdb"),
  maxMemoryBytes: z.coerce.number().int().nonnegative().default(0),
  evictionPolicy: z.enum(["noeviction", "allkeys-lru", "volatile-ttl"]).default("noeviction"),
  logLevel: z.enum(["DEBUG", "INFO", "WARN", "ERROR"]).default("INFO")
});

const argv = process.argv.slice(2);
const cliOverrides: Record<string, unknown> = {};

for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === "--port" && i + 1 < argv.length) {
    cliOverrides.port = argv[++i];
  } else if (arg === "--metrics-port" && i + 1 < argv.length) {
    cliOverrides.metricsPort = argv[++i];
  } else if (arg === "--aof") {
    cliOverrides.enableAof = true;
  } else if (arg === "--no-aof") {
    cliOverrides.enableAof = false;
  } else if (arg === "--aof-path" && i + 1 < argv.length) {
    cliOverrides.aofPath = argv[++i];
  } else if (arg === "--rdb-path" && i + 1 < argv.length) {
    cliOverrides.rdbPath = argv[++i];
  } else if (arg === "--fsync" && i + 1 < argv.length) {
    cliOverrides.fsyncPolicy = argv[++i];
  } else if (arg === "--maxmemory" && i + 1 < argv.length) {
    cliOverrides.maxMemoryBytes = argv[++i];
  } else if (arg === "--maxmemory-policy" && i + 1 < argv.length) {
    cliOverrides.evictionPolicy = argv[++i];
  }
}

const rawConfig = {
  port: cliOverrides.port ?? process.env.REDIS_PORT,
  metricsPort: cliOverrides.metricsPort ?? process.env.METRICS_PORT,
  maxClients: cliOverrides.maxClients ?? process.env.REDIS_MAX_CLIENTS,
  enableAof: cliOverrides.enableAof ?? (process.env.REDIS_AOF !== "false"),
  aofPath: cliOverrides.aofPath ?? process.env.REDIS_AOF_PATH,
  fsyncPolicy: cliOverrides.fsyncPolicy ?? process.env.REDIS_FSYNC_POLICY,
  rdbPath: cliOverrides.rdbPath ?? process.env.REDIS_RDB_PATH,
  maxMemoryBytes: cliOverrides.maxMemoryBytes ?? process.env.REDIS_MAX_MEMORY,
  evictionPolicy: cliOverrides.evictionPolicy ?? process.env.REDIS_MAXMEMORY_POLICY,
  logLevel: process.env.LOG_LEVEL
};

const parsed = ConfigSchema.safeParse(rawConfig);
if (!parsed.success) {
  console.error("Configuration validation error:", parsed.error.format());
  process.exit(1);
}

const config = parsed.data;
logger.setLevel(config.logLevel);

const server = new MiniRedisServer({
  port: config.port,
  metricsPort: config.metricsPort,
  maxClients: config.maxClients,
  enableAof: config.enableAof,
  aofPath: config.aofPath,
  fsyncPolicy: config.fsyncPolicy as FsyncPolicy,
  rdbPath: config.rdbPath,
  maxMemoryBytes: config.maxMemoryBytes,
  evictionPolicy: config.evictionPolicy as EvictionPolicy
});

// Graceful shutdown handling
const shutdown = async (signal: string) => {
  logger.info(`Received ${signal}, initiating graceful shutdown...`);
  try {
    await server.close();
    process.exit(0);
  } catch (err) {
    logger.error("Error during graceful shutdown", { error: String(err) });
    process.exit(1);
  }
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

server.listen().then(() => {
  console.log(`⚡ Mini-Redis v2.0.0 listening on port ${config.port} (Metrics on :${config.metricsPort}/metrics)`);
  console.log(`Persistence: AOF=${config.enableAof ? "enabled (" + config.aofPath + ")" : "disabled"}, RDB=${config.rdbPath}`);
  console.log(`Eviction Policy: ${config.evictionPolicy} (MaxMemory: ${config.maxMemoryBytes === 0 ? "unlimited" : config.maxMemoryBytes + "B"})`);
}).catch((err) => {
  logger.error("Server startup error", { error: String(err) });
  process.exit(1);
});
