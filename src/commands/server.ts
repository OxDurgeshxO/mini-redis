import { KeyValueStore } from "../storage/memory-store.js";
import { RespEncoder } from "../protocol/resp/encoder.js";
import { ProtocolVersion } from "../protocol/resp/types.js";
import { AofEngine } from "../persistence/aof.js";
import { RdbSnapshotEngine } from "../persistence/rdb-snapshot.js";
import { metrics } from "../observability/metrics.js";

export class ServerCommands {
  public static ping(args: string[]): Buffer {
    const msg = args[1];
    return RespEncoder.pong(msg);
  }

  public static echo(args: string[], proto: ProtocolVersion): Buffer {
    if (args.length !== 2) {
      return RespEncoder.error("wrong number of arguments for 'echo' command");
    }
    return RespEncoder.bulkString(args[1], proto);
  }

  public static info(args: string[], store: KeyValueStore, proto: ProtocolVersion): Buffer {
    const stats = metrics.getStats();
    const memBytes = store.getEstimatedMemory();
    const infoText = [
      "# Server",
      "redis_version:7.2.4-mini",
      "mini_redis_version:2.0.0",
      `uptime_in_seconds:${stats.uptimeSeconds}`,
      `connected_clients:${stats.connectedClients}`,
      "",
      "# Memory",
      `used_memory:${memBytes}`,
      `used_memory_human:${(memBytes / 1024).toFixed(2)}K`,
      `maxmemory:${store.getConfig("maxmemory")}`,
      `maxmemory_policy:${store.getConfig("maxmemory-policy")}`,
      "",
      "# Stats",
      `total_commands_processed:${stats.totalCommandsProcessed}`,
      `expired_keys:${stats.expiredKeysTotal}`,
      `evicted_keys:${stats.evictedKeysTotal}`,
      `total_keys:${store.dbsize()}`,
      ""
    ].join("\r\n");

    return RespEncoder.bulkString(infoText, proto);
  }

  public static command(): Buffer {
    return RespEncoder.array(["ping", "set", "get", "del", "incr", "decr", "info"]);
  }

  public static flushdb(store: KeyValueStore): Buffer {
    store.flushdb();
    return RespEncoder.ok();
  }

  public static dbsize(store: KeyValueStore): Buffer {
    return RespEncoder.integer(store.dbsize());
  }

  public static config(args: string[], store: KeyValueStore, proto: ProtocolVersion): Buffer {
    if (args.length < 2) {
      return RespEncoder.error("wrong number of arguments for 'config' command");
    }
    const sub = args[1].toUpperCase();
    if (sub === "GET" && args.length === 3) {
      const param = args[2];
      const val = store.getConfig(param);
      if (val === null) {
        return RespEncoder.array([], proto);
      }
      return RespEncoder.array([param, val], proto);
    }
    if (sub === "SET" && args.length === 4) {
      const ok = store.setConfig(args[2], args[3]);
      if (!ok) {
        return RespEncoder.error("Unsupported CONFIG parameter or invalid value");
      }
      return RespEncoder.ok();
    }
    return RespEncoder.error("syntax error in CONFIG command");
  }

  public static client(args: string[], activeClientsCount: number, proto: ProtocolVersion): Buffer {
    if (args.length < 2) {
      return RespEncoder.error("wrong number of arguments for 'client' command");
    }
    const sub = args[1].toUpperCase();
    if (sub === "LIST") {
      const listStr = `id=1 addr=127.0.0.1:6379 name= age=10 idle=0 flags=N db=0 sub=0 psub=0 multi=-1 qbuf=0 qbuf-free=0 obl=0 oll=0 omem=0 events=r cmd=client\n`;
      return RespEncoder.bulkString(listStr, proto);
    }
    return RespEncoder.ok();
  }

  public static save(store: KeyValueStore, rdbEngine?: RdbSnapshotEngine): Buffer {
    if (!rdbEngine) {
      return RespEncoder.error("RDB persistence is disabled");
    }
    const ok = rdbEngine.save(store);
    return ok ? RespEncoder.ok() : RespEncoder.error("Failed to save snapshot");
  }

  public static bgsave(store: KeyValueStore, rdbEngine?: RdbSnapshotEngine): Buffer {
    if (!rdbEngine) {
      return RespEncoder.error("RDB persistence is disabled");
    }
    rdbEngine.bgsave(store);
    return RespEncoder.simpleString("Background saving started");
  }

  public static bgrewriteaof(store: KeyValueStore, aofEngine?: AofEngine): Buffer {
    if (!aofEngine) {
      return RespEncoder.error("AOF persistence is disabled");
    }
    aofEngine.bgrewriteaof(store);
    return RespEncoder.simpleString("Background append only file rewriting started");
  }

  public static hello(args: string[], proto: ProtocolVersion): Buffer {
    const ver = args[1] ? parseInt(args[1], 10) : 3;
    const protoVer: ProtocolVersion = ver === 3 ? 3 : 2;
    const info: [string, string][] = [
      ["server", "mini-redis"],
      ["version", "2.0.0"],
      ["proto", protoVer.toString()],
      ["mode", "standalone"],
      ["role", "master"]
    ];
    return RespEncoder.map(info, protoVer);
  }
}
