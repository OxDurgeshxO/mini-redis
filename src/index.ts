#!/usr/bin/env node
import { MiniRedisServer } from "./server.js";

const args = process.argv.slice(2);
let port = parseInt(process.env.REDIS_PORT || "6379", 10);
let enableAof = process.env.REDIS_AOF === "true";
let aofPath = process.env.REDIS_AOF_PATH || "appendonly.aof";
let rdbPath = process.env.REDIS_RDB_PATH || "dump.rdb";

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--port" && i + 1 < args.length) {
    port = parseInt(args[i + 1], 10);
    i++;
  } else if (args[i] === "--aof") {
    enableAof = true;
  } else if (args[i] === "--aof-path" && i + 1 < args.length) {
    aofPath = args[i + 1];
    i++;
  } else if (args[i] === "--rdb-path" && i + 1 < args.length) {
    rdbPath = args[i + 1];
    i++;
  }
}

const server = new MiniRedisServer({
  port,
  rdbPath,
  aofPath,
  enableAof
});

server.listen(() => {
  console.log(`⚡ Mini-Redis v1.1.0 (RESP2/RESP3 + AOF/RDB) listening on port ${port}`);
  console.log(`Persistence: AOF=${enableAof ? "enabled (" + aofPath + ")" : "disabled"}, RDB=${rdbPath}`);
  console.log(`Ready to accept connections from redis-cli and Redis SDKs.`);
});
