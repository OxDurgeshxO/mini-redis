export class RespParser {
  private buffer: Buffer = Buffer.alloc(0);

  public append(data: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, data]);
  }

  public parse(): string[] | null {
    if (this.buffer.length === 0) return null;

    // RESP Commands are arrays of bulk strings: *<num_elements>\r\n$<len>\r\n<string>\r\n...
    const firstByte = this.buffer[0];
    if (firstByte === 42) { // '*' Array prefix
      const crlfIndex = this.buffer.indexOf("\r\n");
      if (crlfIndex === -1) return null;

      const numElements = parseInt(this.buffer.subarray(1, crlfIndex).toString("utf-8"), 10);
      let offset = crlfIndex + 2;
      const elements: string[] = [];

      for (let i = 0; i < numElements; i++) {
        if (offset >= this.buffer.length) return null;
        if (this.buffer[offset] !== 36) return null; // '$' Bulk string prefix

        const lenCrlf = this.buffer.indexOf("\r\n", offset);
        if (lenCrlf === -1) return null;

        const strLen = parseInt(this.buffer.subarray(offset + 1, lenCrlf).toString("utf-8"), 10);
        const strStart = lenCrlf + 2;
        const strEnd = strStart + strLen;

        if (this.buffer.length < strEnd + 2) return null; // Wait for full string + \r\n

        elements.push(this.buffer.subarray(strStart, strEnd).toString("utf-8"));
        offset = strEnd + 2;
      }

      // Consume the parsed command from buffer
      this.buffer = this.buffer.subarray(offset);
      return elements;
    }

    // Inline command fallback (e.g. "PING\r\n")
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

  public static integer(num: number): Buffer {
    return Buffer.from(`:${num}\r\n`, "utf-8");
  }

  public static bulkString(str: string | null): Buffer {
    if (str === null) {
      return Buffer.from("$-1\r\n", "utf-8");
    }
    const byteLen = Buffer.byteLength(str, "utf-8");
    return Buffer.from(`$${byteLen}\r\n${str}\r\n`, "utf-8");
  }

  public static ok(): Buffer {
    return this.simpleString("OK");
  }

  public static pong(arg?: string): Buffer {
    return arg ? this.bulkString(arg) : this.simpleString("PONG");
  }
}
