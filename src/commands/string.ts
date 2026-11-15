import { KeyValueStore } from "../storage/memory-store.js";
import { RespEncoder } from "../protocol/resp/encoder.js";
import { ProtocolVersion } from "../protocol/resp/types.js";

export class StringCommands {
  public static set(args: string[], store: KeyValueStore, proto: ProtocolVersion): Buffer {
    if (args.length < 3) {
      return RespEncoder.error("wrong number of arguments for 'set' command");
    }

    const key = args[1];
    const val = args[2];
    let ttlMs: number | undefined;
    let nx = false;
    let xx = false;
    let returnOld = false;

    for (let i = 3; i < args.length; i++) {
      const opt = args[i].toUpperCase();
      if (opt === "EX" && i + 1 < args.length) {
        const sec = parseInt(args[i + 1], 10);
        if (isNaN(sec) || sec <= 0) return RespEncoder.error("value is not an integer or out of range");
        ttlMs = sec * 1000;
        i++;
      } else if (opt === "PX" && i + 1 < args.length) {
        const ms = parseInt(args[i + 1], 10);
        if (isNaN(ms) || ms <= 0) return RespEncoder.error("value is not an integer or out of range");
        ttlMs = ms;
        i++;
      } else if (opt === "NX") {
        nx = true;
      } else if (opt === "XX") {
        xx = true;
      } else if (opt === "GET") {
        returnOld = true;
      } else {
        return RespEncoder.error("syntax error");
      }
    }

    if (nx && xx) {
      return RespEncoder.error("syntax error");
    }

    const oldVal = returnOld ? store.get(key) : null;
    const ok = store.set(key, val, ttlMs, nx, xx);

    if (returnOld) {
      return RespEncoder.bulkString(oldVal, proto);
    }

    if (!ok) {
      return RespEncoder.null(proto);
    }

    return RespEncoder.ok();
  }

  public static get(args: string[], store: KeyValueStore, proto: ProtocolVersion): Buffer {
    if (args.length !== 2) {
      return RespEncoder.error("wrong number of arguments for 'get' command");
    }
    const val = store.get(args[1]);
    return RespEncoder.bulkString(val, proto);
  }

  public static del(args: string[], store: KeyValueStore): Buffer {
    if (args.length < 2) {
      return RespEncoder.error("wrong number of arguments for 'del' command");
    }
    let count = 0;
    for (let i = 1; i < args.length; i++) {
      if (store.delete(args[i])) {
        count++;
      }
    }
    return RespEncoder.integer(count);
  }

  public static incr(args: string[], store: KeyValueStore): Buffer {
    if (args.length !== 2) {
      return RespEncoder.error("wrong number of arguments for 'incr' command");
    }
    try {
      const res = store.incr(args[1], 1);
      return RespEncoder.integer(res);
    } catch (e: any) {
      return RespEncoder.error(e.message);
    }
  }

  public static decr(args: string[], store: KeyValueStore): Buffer {
    if (args.length !== 2) {
      return RespEncoder.error("wrong number of arguments for 'decr' command");
    }
    try {
      const res = store.incr(args[1], -1);
      return RespEncoder.integer(res);
    } catch (e: any) {
      return RespEncoder.error(e.message);
    }
  }

  public static append(args: string[], store: KeyValueStore): Buffer {
    if (args.length !== 3) {
      return RespEncoder.error("wrong number of arguments for 'append' command");
    }
    const len = store.append(args[1], args[2]);
    return RespEncoder.integer(len);
  }

  public static strlen(args: string[], store: KeyValueStore): Buffer {
    if (args.length !== 2) {
      return RespEncoder.error("wrong number of arguments for 'strlen' command");
    }
    const len = store.strlen(args[1]);
    return RespEncoder.integer(len);
  }
}
