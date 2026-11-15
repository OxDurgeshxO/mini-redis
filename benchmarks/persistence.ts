import fs from "fs";
import { AofEngine, FsyncPolicy } from "../dist/persistence/aof.js";
import { KeyValueStore } from "../dist/storage/memory-store.js";
import { RdbSnapshotEngine } from "../dist/persistence/rdb-snapshot.js";

const BENCH_AOF = "bench_persist.aof";
const BENCH_RDB = "bench_persist.rdb";

export interface PersistenceMetrics {
  fsync_always_ops_sec: number;
  fsync_everysec_ops_sec: number;
  fsync_no_ops_sec: number;
  rdb_save_time_ms: number;
  rdb_restore_time_ms: number;
}

export function runPersistenceBenchmark(numOperations: number = 2000): PersistenceMetrics {
  const cleanup = () => {
    if (fs.existsSync(BENCH_AOF)) fs.unlinkSync(BENCH_AOF);
    if (fs.existsSync(BENCH_RDB)) fs.unlinkSync(BENCH_RDB);
  };
  cleanup();

  const benchmarkFsync = (policy: FsyncPolicy): number => {
    cleanup();
    const aof = new AofEngine(BENCH_AOF, policy);
    aof.init();
    const t0 = performance.now();
    for (let i = 0; i < numOperations; i++) {
      aof.write(["SET", `bench:p:${i}`, "persistent_val"]);
    }
    aof.flush(true);
    const durationSec = (performance.now() - t0) / 1000;
    aof.close();
    return Math.round(numOperations / durationSec);
  };

  const alwaysRps = benchmarkFsync("always");
  const everysecRps = benchmarkFsync("everysec");
  const noRps = benchmarkFsync("no");

  // RDB snapshot save and restore
  cleanup();
  const store = new KeyValueStore();
  for (let i = 0; i < 5000; i++) {
    store.set(`snap:key:${i}`, "durable-content");
  }
  const rdb = new RdbSnapshotEngine(BENCH_RDB);

  const tSave = performance.now();
  rdb.save(store);
  const saveTimeMs = Number((performance.now() - tSave).toFixed(2));

  const restoreStore = new KeyValueStore();
  const tRestore = performance.now();
  rdb.restore(restoreStore);
  const restoreTimeMs = Number((performance.now() - tRestore).toFixed(2));

  cleanup();
  store.destroy();
  restoreStore.destroy();

  return {
    fsync_always_ops_sec: alwaysRps,
    fsync_everysec_ops_sec: everysecRps,
    fsync_no_ops_sec: noRps,
    rdb_save_time_ms: saveTimeMs,
    rdb_restore_time_ms: restoreTimeMs
  };
}

if (process.argv[1] && process.argv[1].endsWith("persistence.js")) {
  console.log("Persistence Benchmark Results:", JSON.stringify(runPersistenceBenchmark(), null, 2));
}
