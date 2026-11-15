import { ProtocolVersion } from "./types.js";

export class RespEncoder {
  public static simpleString(str: string): Buffer {
    return Buffer.from(`+${str}\r\n`, "utf-8");
  }

  public static error(msg: string): Buffer {
    if (msg.startsWith("ERR ") || msg.startsWith("WRONGTYPE ") || msg.startsWith("NOAUTH ")) {
      return Buffer.from(`-${msg}\r\n`, "utf-8");
    }
    return Buffer.from(`-ERR ${msg}\r\n`, "utf-8");
  }

  public static blobError(msg: string): Buffer {
    const len = Buffer.byteLength(msg, "utf-8");
    return Buffer.from(`!${len}\r\n${msg}\r\n`, "utf-8");
  }

  public static integer(num: number): Buffer {
    return Buffer.from(`:${Math.floor(num)}\r\n`, "utf-8");
  }

  public static double(num: number): Buffer {
    if (Number.isNaN(num)) return Buffer.from(",nan\r\n", "utf-8");
    if (num === Infinity) return Buffer.from(",inf\r\n", "utf-8");
    if (num === -Infinity) return Buffer.from(",-inf\r\n", "utf-8");
    return Buffer.from(`,${num}\r\n`, "utf-8");
  }

  public static boolean(val: boolean): Buffer {
    return Buffer.from(val ? "#t\r\n" : "#f\r\n", "utf-8");
  }

  public static bulkString(str: string | null, proto: ProtocolVersion = 2): Buffer {
    if (str === null) {
      return proto === 3 ? Buffer.from("_\r\n", "utf-8") : Buffer.from("$-1\r\n", "utf-8");
    }
    const byteLen = Buffer.byteLength(str, "utf-8");
    return Buffer.from(`$${byteLen}\r\n${str}\r\n`, "utf-8");
  }

  public static array(elements: (string | null)[], proto: ProtocolVersion = 2): Buffer {
    const header = Buffer.from(`*${elements.length}\r\n`, "utf-8");
    const parts: Buffer[] = [header];
    for (const elem of elements) {
      parts.push(this.bulkString(elem, proto));
    }
    return Buffer.concat(parts);
  }

  public static rawArray(buffers: Buffer[]): Buffer {
    const header = Buffer.from(`*${buffers.length}\r\n`, "utf-8");
    return Buffer.concat([header, ...buffers]);
  }

  public static null(proto: ProtocolVersion = 2): Buffer {
    return proto === 3 ? Buffer.from("_\r\n", "utf-8") : Buffer.from("$-1\r\n", "utf-8");
  }

  public static map(entries: [string, string][], proto: ProtocolVersion = 2): Buffer {
    if (proto === 3) {
      const header = Buffer.from(`%${entries.length}\r\n`, "utf-8");
      const parts: Buffer[] = [header];
      for (const [k, v] of entries) {
        parts.push(this.bulkString(k, 3));
        parts.push(this.bulkString(v, 3));
      }
      return Buffer.concat(parts);
    }
    // In RESP2, maps are flattened into arrays
    const flat: string[] = [];
    for (const [k, v] of entries) {
      flat.push(k, v);
    }
    return this.array(flat, 2);
  }

  public static set(members: string[], proto: ProtocolVersion = 2): Buffer {
    if (proto === 3) {
      const header = Buffer.from(`~${members.length}\r\n`, "utf-8");
      const parts: Buffer[] = [header];
      for (const m of members) {
        parts.push(this.bulkString(m, 3));
      }
      return Buffer.concat(parts);
    }
    return this.array(members, 2);
  }

  public static ok(): Buffer {
    return this.simpleString("OK");
  }

  public static pong(msg?: string): Buffer {
    if (msg !== undefined) {
      return this.bulkString(msg);
    }
    return this.simpleString("PONG");
  }

  public static commandToBuffer(args: string[]): Buffer {
    return this.array(args, 2);
  }
}
