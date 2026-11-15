import fs from "fs";
import path from "path";
import { KeyValueStore } from "../storage/memory-store.js";
import { RespEncoder } from "../protocol/resp/encoder.js";
import { logger } from "../observability/logger.js";

export class AofCompactor {
  public static rewrite(store: KeyValueStore, targetFilepath: string): boolean {
    try {
      const dir = path.dirname(targetFilepath);
      if (dir && dir !== "." && !fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const tempFilepath = `${targetFilepath}.rewrite.${Date.now()}`;
      const fd = fs.openSync(tempFilepath, "w");

      const buffers: Buffer[] = [];
      const now = Date.now();

      // Write string entries
      for (const entry of store.getAllEntries()) {
        const cmd = ["SET", entry.key, entry.value];
        if (entry.expiresAt !== null) {
          const ttlMs = entry.expiresAt - now;
          if (ttlMs > 0) {
            cmd.push("PX", ttlMs.toString());
          }
        }
        buffers.push(RespEncoder.commandToBuffer(cmd));
      }

      // Write hash entries
      for (const h of store.getAllHashes()) {
        for (const [field, val] of h.fields) {
          buffers.push(RespEncoder.commandToBuffer(["HSET", h.key, field, val]));
        }
      }

      // Write set entries
      for (const s of store.getAllSets()) {
        if (s.members.length > 0) {
          buffers.push(RespEncoder.commandToBuffer(["SADD", s.key, ...s.members]));
        }
      }

      if (buffers.length > 0) {
        const combined = Buffer.concat(buffers);
        fs.writeSync(fd, combined, 0, combined.length, null);
      }

      fs.fsyncSync(fd);
      fs.closeSync(fd);

      // Safe replace on Windows/POSIX
      if (fs.existsSync(targetFilepath)) {
        try {
          fs.unlinkSync(targetFilepath);
        } catch {}
      }
      fs.renameSync(tempFilepath, targetFilepath);

      logger.info("AOF rewrite compacted successfully", {
        targetFilepath,
        compactedCommands: buffers.length
      });
      return true;
    } catch (err) {
      logger.error("AOF rewrite failed", { error: String(err) });
      return false;
    }
  }
}
