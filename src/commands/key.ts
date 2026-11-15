import { KeyValueStore } from "../storage/memory-store.js";
import { RespEncoder } from "../protocol/resp/encoder.js";
import { ProtocolVersion } from "../protocol/resp/types.js";

export class KeyCommands {
  public static exists(args: string[], store: KeyValueStore): Buffer {
    if (args.length < 2) {
      return RespEncoder.error("wrong number of arguments for 'exists' command");
    }
    let count = 0;
    for (let i = 1; i < args.length; i++) {
      if (store.exists(args[i])) {
        count++;
      }
    }
    return RespEncoder.integer(count);
  }

  public static expire(args: string[], store: KeyValueStore): Buffer {
    if (args.length !== 3) {
      return RespEncoder.error("wrong number of arguments for 'expire' command");
    }
    const seconds = parseInt(args[2], 10);
    if (isNaN(seconds)) {
      return RespEncoder.error("value is not an integer or out of range");
    }
    const ok = store.expire(args[1], seconds);
    return RespEncoder.integer(ok ? 1 : 0);
  }

  public static ttl(args: string[], store: KeyValueStore): Buffer {
    if (args.length !== 2) {
      return RespEncoder.error("wrong number of arguments for 'ttl' command");
    }
    const ttlVal = store.ttl(args[1]);
    return RespEncoder.integer(ttlVal);
  }

  public static persist(args: string[], store: KeyValueStore): Buffer {
    if (args.length !== 2) {
      return RespEncoder.error("wrong number of arguments for 'persist' command");
    }
    const ok = store.persist(args[1]);
    return RespEncoder.integer(ok ? 1 : 0);
  }

  public static keys(args: string[], store: KeyValueStore, proto: ProtocolVersion): Buffer {
    if (args.length !== 2) {
      return RespEncoder.error("wrong number of arguments for 'keys' command");
    }
    const matching = store.keys(args[1]);
    return RespEncoder.array(matching, proto);
  }

  public static type(args: string[], store: KeyValueStore): Buffer {
    if (args.length !== 2) {
      return RespEncoder.error("wrong number of arguments for 'type' command");
    }
    const t = store.type(args[1]);
    return RespEncoder.simpleString(t);
  }

  public static rename(args: string[], store: KeyValueStore): Buffer {
    if (args.length !== 3) {
      return RespEncoder.error("wrong number of arguments for 'rename' command");
    }
    const oldKey = args[1];
    const newKey = args[2];
    if (oldKey === newKey) {
      return RespEncoder.ok();
    }
    const ok = store.rename(oldKey, newKey);
    if (!ok) {
      return RespEncoder.error("no such key");
    }
    return RespEncoder.ok();
  }
}
