import { KeyValueStore } from "../storage/memory-store.js";
import { RespEncoder } from "../protocol/resp/encoder.js";
import { ProtocolVersion } from "../protocol/resp/types.js";
import { StringCommands } from "../commands/string.js";
import { KeyCommands } from "../commands/key.js";
import { ServerCommands } from "../commands/server.js";
import { AofEngine } from "../persistence/aof.js";
import { RdbSnapshotEngine } from "../persistence/rdb-snapshot.js";
import { metrics } from "../observability/metrics.js";
import { ClusterManager } from "../cluster/cluster_manager.js";
import { keyToSlot } from "../cluster/hash_slot.js";

const MUTATING_COMMANDS = new Set([
  "SET",
  "DEL",
  "INCR",
  "DECR",
  "APPEND",
  "EXPIRE",
  "PERSIST",
  "RENAME",
  "FLUSHDB",
  "HSET",
  "SADD"
]);

export class CommandRouter {
  private store: KeyValueStore;
  private aofEngine?: AofEngine;
  private rdbEngine?: RdbSnapshotEngine;
  private clusterManager: ClusterManager;

  constructor(
    store: KeyValueStore,
    aofEngine?: AofEngine,
    rdbEngine?: RdbSnapshotEngine,
    clusterManager?: ClusterManager
  ) {
    this.store = store;
    this.aofEngine = aofEngine;
    this.rdbEngine = rdbEngine;
    this.clusterManager = clusterManager || new ClusterManager();
  }

  public dispatch(
    args: string[],
    proto: ProtocolVersion = 2,
    activeClientsCount: number = 1
  ): { response: Buffer; newProto?: ProtocolVersion } {
    if (args.length === 0) {
      return { response: RespEncoder.error("empty command") };
    }

    const cmd = args[0].toUpperCase();
    const startTime = process.hrtime.bigint();
    metrics.incrementCommand(cmd);

    let response: Buffer;
    let newProto: ProtocolVersion | undefined;

    try {
      switch (cmd) {
        // --- Connection / Server ---
        case "HELLO": {
          const ver = args[1] ? parseInt(args[1], 10) : 3;
          newProto = ver === 3 ? 3 : 2;
          response = ServerCommands.hello(args, newProto);
          break;
        }
        case "PING":
          response = ServerCommands.ping(args);
          break;
        case "ECHO":
          response = ServerCommands.echo(args, proto);
          break;
        case "INFO":
          response = ServerCommands.info(args, this.store, proto);
          break;
        case "COMMAND":
          response = ServerCommands.command();
          break;
        case "CLUSTER": {
          const subcmd = (args[1] || "").toUpperCase();
          if (subcmd === "KEYSLOT") {
            if (args.length !== 3) {
              response = RespEncoder.error("ERR wrong number of arguments for 'cluster keyslot' command");
            } else {
              response = RespEncoder.integer(keyToSlot(args[2]));
            }
          } else if (subcmd === "NODES") {
            response = RespEncoder.bulkString(this.clusterManager.getClusterNodes(), proto);
          } else if (subcmd === "INFO") {
            response = RespEncoder.bulkString(this.clusterManager.getClusterInfo(), proto);
          } else if (subcmd === "SLOTS") {
            const slots = this.clusterManager.getClusterSlots();
            const slotBuffers = slots.map(slot => {
              const nodeEndpoint = RespEncoder.rawArray([
                RespEncoder.bulkString(slot[2][0]),
                RespEncoder.integer(slot[2][1]),
                RespEncoder.bulkString(slot[2][2])
              ]);
              return RespEncoder.rawArray([
                RespEncoder.integer(slot[0]),
                RespEncoder.integer(slot[1]),
                nodeEndpoint
              ]);
            });
            response = RespEncoder.rawArray(slotBuffers);
          } else {
            response = RespEncoder.error(`ERR unknown cluster subcommand '${args[1]}'`);
          }
          break;
        }
        case "FLUSHDB":
          response = ServerCommands.flushdb(this.store);
          break;
        case "DBSIZE":
          response = ServerCommands.dbsize(this.store);
          break;
        case "CONFIG":
          response = ServerCommands.config(args, this.store, proto);
          break;
        case "CLIENT":
          response = ServerCommands.client(args, activeClientsCount, proto);
          break;

        // --- Persistence ---
        case "SAVE":
          response = ServerCommands.save(this.store, this.rdbEngine);
          break;
        case "BGSAVE":
          response = ServerCommands.bgsave(this.store, this.rdbEngine);
          break;
        case "BGREWRITEAOF":
          response = ServerCommands.bgrewriteaof(this.store, this.aofEngine);
          break;

        // --- Strings ---
        case "SET":
          response = StringCommands.set(args, this.store, proto);
          break;
        case "GET":
          response = StringCommands.get(args, this.store, proto);
          break;
        case "DEL":
          response = StringCommands.del(args, this.store);
          break;
        case "INCR":
          response = StringCommands.incr(args, this.store);
          break;
        case "DECR":
          response = StringCommands.decr(args, this.store);
          break;
        case "APPEND":
          response = StringCommands.append(args, this.store);
          break;
        case "STRLEN":
          response = StringCommands.strlen(args, this.store);
          break;

        // --- Keys ---
        case "EXISTS":
          response = KeyCommands.exists(args, this.store);
          break;
        case "EXPIRE":
          response = KeyCommands.expire(args, this.store);
          break;
        case "TTL":
          response = KeyCommands.ttl(args, this.store);
          break;
        case "PERSIST":
          response = KeyCommands.persist(args, this.store);
          break;
        case "KEYS":
          response = KeyCommands.keys(args, this.store, proto);
          break;
        case "TYPE":
          response = KeyCommands.type(args, this.store);
          break;
        case "RENAME":
          response = KeyCommands.rename(args, this.store);
          break;

        // --- Hashes ---
        case "HSET": {
          if (args.length < 4) {
            response = RespEncoder.error("wrong number of arguments for 'hset' command");
            break;
          }
          let isNewTotal = 0;
          for (let i = 2; i < args.length; i += 2) {
            if (i + 1 < args.length) {
              isNewTotal += this.store.hset(args[1], args[i], args[i + 1]);
            }
          }
          response = RespEncoder.integer(isNewTotal);
          break;
        }
        case "HGET": {
          if (args.length !== 3) {
            response = RespEncoder.error("wrong number of arguments for 'hget' command");
            break;
          }
          const val = this.store.hget(args[1], args[2]);
          response = RespEncoder.bulkString(val, proto);
          break;
        }
        case "HGETALL": {
          if (args.length !== 2) {
            response = RespEncoder.error("wrong number of arguments for 'hgetall' command");
            break;
          }
          const entries = this.store.hgetall(args[1]);
          response = RespEncoder.map(entries, proto);
          break;
        }

        // --- Sets ---
        case "SADD": {
          if (args.length < 3) {
            response = RespEncoder.error("wrong number of arguments for 'sadd' command");
            break;
          }
          const added = this.store.sadd(args[1], args.slice(2));
          response = RespEncoder.integer(added);
          break;
        }
        case "SMEMBERS": {
          if (args.length !== 2) {
            response = RespEncoder.error("wrong number of arguments for 'smembers' command");
            break;
          }
          const members = this.store.smembers(args[1]);
          response = RespEncoder.set(members, proto);
          break;
        }
        case "SISMEMBER": {
          if (args.length !== 3) {
            response = RespEncoder.error("wrong number of arguments for 'sismember' command");
            break;
          }
          const isMem = this.store.sismember(args[1], args[2]);
          response = proto === 3 ? RespEncoder.boolean(isMem) : RespEncoder.integer(isMem ? 1 : 0);
          break;
        }

        default:
          response = RespEncoder.error(`unknown command \`${cmd}\``);
          break;
      }

      // If mutating and command succeeded (not an error response), write to AOF
      if (this.aofEngine && MUTATING_COMMANDS.has(cmd) && response[0] !== 45 /* '-' */) {
        this.aofEngine.write(args);
      }
    } catch (err: any) {
      response = RespEncoder.error(err.message || "server internal error");
    }

    const durationNs = process.hrtime.bigint() - startTime;
    const latencyMs = Number(durationNs) / 1_000_000;
    metrics.recordLatency(cmd, latencyMs);

    return { response, newProto };
  }
}
