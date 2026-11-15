import { KeyValueStore } from "../storage/memory-store.js";
import { AofEngine } from "./aof.js";
import { RdbSnapshotEngine } from "./rdb-snapshot.js";
import { logger } from "../observability/logger.js";

export interface PersistenceConfig {
  enableAof: boolean;
  aofPath: string;
  rdbPath: string;
}

export class RecoveryManager {
  public static recover(
    store: KeyValueStore,
    aofEngine?: AofEngine,
    rdbEngine?: RdbSnapshotEngine,
    enableAof: boolean = true
  ): { aofCommands: number; rdbRestored: boolean } {
    let rdbRestored = false;
    let aofCommands = 0;

    // 1. Try loading RDB base snapshot
    if (rdbEngine) {
      rdbRestored = rdbEngine.restore(store);
    }

    // 2. Replay AOF log on top
    if (enableAof && aofEngine) {
      aofCommands = aofEngine.replay(store);
    }

    logger.info("Database recovery sequence finished", {
      rdbRestored,
      aofCommands,
      totalKeys: store.dbsize()
    });

    return { aofCommands, rdbRestored };
  }
}
