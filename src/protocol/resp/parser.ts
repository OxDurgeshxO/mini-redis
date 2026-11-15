export class RespParser {
  private buffer: Buffer = Buffer.alloc(0);

  public append(data: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, data]);
  }

  public getRemainingBytes(): number {
    return this.buffer.length;
  }

  public clear(): void {
    this.buffer = Buffer.alloc(0);
  }

  public parse(): string[] | null {
    if (this.buffer.length === 0) return null;

    const firstByte = this.buffer[0];

    // Array prefix '*' or RESP3 Set prefix '~' or Push prefix '>'
    if (firstByte === 42 || firstByte === 126 || firstByte === 62) {
      const crlfIndex = this.buffer.indexOf("\r\n");
      if (crlfIndex === -1) return null;

      const numElementsStr = this.buffer.subarray(1, crlfIndex).toString("utf-8");
      const numElements = parseInt(numElementsStr, 10);

      // Handle null array *-1\r\n or empty *0\r\n
      if (isNaN(numElements) || numElements < 0) {
        this.buffer = this.buffer.subarray(crlfIndex + 2);
        return [];
      }

      let offset = crlfIndex + 2;
      const elements: string[] = [];

      for (let i = 0; i < numElements; i++) {
        if (offset >= this.buffer.length) return null;
        const prefix = this.buffer[offset];

        if (prefix === 36) { // '$' Bulk string
          const lenCrlf = this.buffer.indexOf("\r\n", offset);
          if (lenCrlf === -1) return null;

          const strLenStr = this.buffer.subarray(offset + 1, lenCrlf).toString("utf-8");
          const strLen = parseInt(strLenStr, 10);

          if (strLen === -1) {
            elements.push("");
            offset = lenCrlf + 2;
            continue;
          }

          const strStart = lenCrlf + 2;
          const strEnd = strStart + strLen;

          if (this.buffer.length < strEnd + 2) return null;

          elements.push(this.buffer.subarray(strStart, strEnd).toString("utf-8"));
          offset = strEnd + 2;
        } else if (prefix === 43 || prefix === 58 || prefix === 45) { // '+' Simple string, ':' Integer, '-' Error
          const endCrlf = this.buffer.indexOf("\r\n", offset);
          if (endCrlf === -1) return null;
          elements.push(this.buffer.subarray(offset + 1, endCrlf).toString("utf-8"));
          offset = endCrlf + 2;
        } else {
          // If unexpected byte in array, return null waiting for more or fail gracefully
          return null;
        }
      }

      this.buffer = this.buffer.subarray(offset);
      return elements;
    }

    // Inline command fallback (e.g. "PING\r\n" or "SET a b\r\n")
    const crlfIndex = this.buffer.indexOf("\r\n");
    if (crlfIndex !== -1) {
      const line = this.buffer.subarray(0, crlfIndex).toString("utf-8").trim();
      this.buffer = this.buffer.subarray(crlfIndex + 2);
      if (line.length === 0) {
        return this.parse();
      }
      return line.split(/\s+/);
    }

    return null;
  }
}
