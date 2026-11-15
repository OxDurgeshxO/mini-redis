export type ProtocolVersion = 2 | 3;

export class RespParser {
  private buffer: Buffer = Buffer.alloc(0);

  public append(data: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, data]);
  }

  public parse(): string[] | null {
    if (this.buffer.length === 0) return null;

    const firstByte = this.buffer[0];

    // Array prefix '*' or Set prefix '~' or Push prefix '>'
    if (firstByte === 42 || firstByte === 126 || firstByte === 62) {
      const crlfIndex = this.buffer.indexOf("\r\n");
      if (crlfIndex === -1) return null;

      const numElements = parseInt(this.buffer.subarray(1, crlfIndex).toString("utf-8"), 10);
      let offset = crlfIndex + 2;
      const elements: string[] = [];

      for (let i = 0; i < numElements; i++) {
        if (offset >= this.buffer.length) return null;
        const prefix = this.buffer[offset];

        if (prefix === 36) { // '$' Bulk string
          const lenCrlf = this.buffer.indexOf("\r\n", offset);
          if (lenCrlf === -1) return null;

          const strLen = parseInt(this.buffer.subarray(offset + 1, lenCrlf).toString("utf-8"), 10);
          const strStart = lenCrlf + 2;
          const strEnd = strStart + strLen;

          if (this.buffer.length < strEnd + 2) return null;

          elements.push(this.buffer.subarray(strStart, strEnd).toString("utf-8"));
          offset = strEnd + 2;
        } else if (prefix === 43 || prefix === 58) { // '+' Simple string or ':' Integer
          const endCrlf = this.buffer.indexOf("\r\n", offset);
          if (endCrlf === -1) return null;
          elements.push(this.buffer.subarray(offset + 1, endCrlf).toString("utf-8"));
          offset = endCrlf + 2;
        } else {
          // Fallback to bulk parsing
          return null;
        }
      }

      this.buffer = this.buffer.subarray(offset);
      return elements;
    }

    // Inline command fallback (e.g. "PING\r\n" or "SET a b\r\n")
    const crlfIndex = this.buffer.indexOf("\r\n");
    if (crlfIndex !== -1) {
      const line = this.buffer.subarray(0, crlfIndex).toString("utf-8");
      this.buffer = this.buffer.subarray(crlfIndex + 2);
      return line.trim().split(/\s+/);
    }

    return null;
  }
}

export class RespEncoder {
  public static simpleString(str: string): Buffer {
    return Buffer.from(`+${str}\r\n`, "utf-8");
  }

  public static error(msg: string): Buffer {
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

  public static bulkString(str: string | null): Buffer {
    if (str === null) {
      return Buffer.from("$-1\r\n", "utf-8");
    }
    const byteLen = Buffer.byteLength(str, "utf-8");
    return Buffer.from(`$${byteLen}\r\n${str}\r\n`, "utf-8");
  }

  public static verbatimString(str: string, format = "txt"): Buffer {
    const totalBytes = 4 + Buffer.byteLength(str, "utf-8");
    return Buffer.from(`=${totalBytes}\r\n${format}:${str}\r\n`, "utf-8");
  }

  public static null(version: ProtocolVersion = 2): Buffer {
    return version === 3 ? Buffer.from("_\r\n", "utf-8") : Buffer.from("$-1\r\n", "utf-8");
  }

  public static ok(): Buffer {
    return this.simpleString("OK");
  }

  public static pong(arg?: string): Buffer {
    return arg ? this.bulkString(arg) : this.simpleString("PONG");
  }

  public static array(elements: Buffer[]): Buffer {
    const header = Buffer.from(`*${elements.length}\r\n`, "utf-8");
    return Buffer.concat([header, ...elements]);
  }

  public static set(elements: string[], version: ProtocolVersion = 2): Buffer {
    if (version === 3) {
      const header = Buffer.from(`~${elements.length}\r\n`, "utf-8");
      const buffers = elements.map((e) => this.bulkString(e));
      return Buffer.concat([header, ...buffers]);
    } else {
      const header = Buffer.from(`*${elements.length}\r\n`, "utf-8");
      const buffers = elements.map((e) => this.bulkString(e));
      return Buffer.concat([header, ...buffers]);
    }
  }

  public static map(entries: [string, string][], version: ProtocolVersion = 2): Buffer {
    if (version === 3) {
      const header = Buffer.from(`%${entries.length}\r\n`, "utf-8");
      const buffers: Buffer[] = [];
      for (const [k, v] of entries) {
        buffers.push(this.bulkString(k));
        buffers.push(this.bulkString(v));
      }
      return Buffer.concat([header, ...buffers]);
    } else {
      // RESP2 flattens maps into an array with 2*N elements
      const header = Buffer.from(`*${entries.length * 2}\r\n`, "utf-8");
      const buffers: Buffer[] = [];
      for (const [k, v] of entries) {
        buffers.push(this.bulkString(k));
        buffers.push(this.bulkString(v));
      }
      return Buffer.concat([header, ...buffers]);
    }
  }

  public static commandToBuffer(args: string[]): Buffer {
    const parts = [Buffer.from(`*${args.length}\r\n`, "utf-8")];
    for (const arg of args) {
      const byteLen = Buffer.byteLength(arg, "utf-8");
      parts.push(Buffer.from(`$${byteLen}\r\n${arg}\r\n`, "utf-8"));
    }
    return Buffer.concat(parts);
  }
}
