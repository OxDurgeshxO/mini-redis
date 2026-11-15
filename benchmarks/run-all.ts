import fs from "fs";
import { runThroughputBenchmark } from "./throughput.js";
import { runLatencyBenchmark } from "./latency.js";
import { runConcurrencyBenchmark } from "./concurrency.js";
import { runMemoryBenchmark } from "./memory.js";
import { runPersistenceBenchmark } from "./persistence.js";

async function main() {
  console.log("=================================================");
  console.log("      ⚡ MINI-REDIS BENCHMARK HARNESS v2.0       ");
  console.log("=================================================\n");

  console.log("1. Measuring Throughput (ops/sec)...");
  const throughput = await runThroughputBenchmark(3000);
  console.log("   Throughput:", throughput);

  console.log("\n2. Measuring Latency Distribution (p50/p95/p99/p999)...");
  const latency = await runLatencyBenchmark(2000);
  console.log("   Latency:", latency);

  console.log("\n3. Measuring Concurrency Scaling (10, 50, 100 clients)...");
  const concurrency = await runConcurrencyBenchmark();
  console.log("   Concurrency:", concurrency);

  console.log("\n4. Measuring Memory Efficiency & Overhead...");
  const memory = runMemoryBenchmark();
  console.log("   Memory:", memory);

  console.log("\n5. Measuring Persistence Impact & Recovery...");
  const persistence = runPersistenceBenchmark(1500);
  console.log("   Persistence:", persistence);

  const report = {
    timestamp: new Date().toISOString(),
    system: {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch
    },
    throughput,
    latency,
    concurrency,
    memory,
    persistence
  };

  fs.writeFileSync("benchmark-results.json", JSON.stringify(report, null, 2), "utf-8");
  console.log("\n✅ Benchmark completed. Results saved to benchmark-results.json\n");
}

main().catch((err) => {
  console.error("Benchmark error:", err);
  process.exit(1);
});
