import { KeyValueStore } from "../dist/storage/memory-store.js";

export interface MemoryStats {
  keyCount: number;
  totalPayloadBytes: number;
  estimatedMemoryBytes: number;
  avgBytesPerKey: number;
  processHeapUsedMB: number;
}

export function runMemoryBenchmark(): Record<string, MemoryStats> {
  const counts = [1000, 5000, 10000];
  const results: Record<string, MemoryStats> = {};

  for (const count of counts) {
    const store = new KeyValueStore();
    const payload = "v".repeat(64);
    let totalPayload = 0;

    for (let i = 0; i < count; i++) {
      const key = `mem:key:${i}`;
      store.set(key, payload);
      totalPayload += Buffer.byteLength(key, "utf-8") + Buffer.byteLength(payload, "utf-8");
    }

    const estimatedMem = store.getEstimatedMemory();
    const heapUsed = Math.round(process.memoryUsage().heapUsed / (1024 * 1024) * 100) / 100;

    results[`${count}_keys`] = {
      keyCount: count,
      totalPayloadBytes: totalPayload,
      estimatedMemoryBytes: estimatedMem,
      avgBytesPerKey: Math.round(estimatedMem / count),
      processHeapUsedMB: heapUsed
    };

    store.destroy();
  }

  return results;
}

if (process.argv[1] && process.argv[1].endsWith("memory.js")) {
  console.log("Memory Benchmark Results:", JSON.stringify(runMemoryBenchmark(), null, 2));
}
