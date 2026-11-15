import net from "net";
import { MiniRedisServer } from "../dist/server/tcp-server.js";
import { RespEncoder } from "../dist/protocol/resp/encoder.js";

const PORT = 6401;

export async function runThroughputBenchmark(numRequests: number = 5000): Promise<Record<string, number>> {
  const server = new MiniRedisServer({ port: PORT, enableAof: false });
  await server.listen();

  const client = net.createConnection({ port: PORT });
  await new Promise<void>((r) => client.once("connect", () => r()));

  const send = (args: string[]): Promise<void> => {
    return new Promise((resolve) => {
      client.once("data", () => resolve());
      client.write(RespEncoder.commandToBuffer(args));
    });
  };

  const results: Record<string, number> = {};

  // 1. PING Throughput
  const t0 = performance.now();
  for (let i = 0; i < numRequests; i++) {
    await send(["PING"]);
  }
  const pingSec = (performance.now() - t0) / 1000;
  results["PING"] = Math.round(numRequests / pingSec);

  // 2. SET Throughput
  const t1 = performance.now();
  for (let i = 0; i < numRequests; i++) {
    await send(["SET", `bench:t:${i}`, "value_payload"]);
  }
  const setSec = (performance.now() - t1) / 1000;
  results["SET"] = Math.round(numRequests / setSec);

  // 3. GET Throughput
  const t2 = performance.now();
  for (let i = 0; i < numRequests; i++) {
    await send(["GET", `bench:t:${i}`]);
  }
  const getSec = (performance.now() - t2) / 1000;
  results["GET"] = Math.round(numRequests / getSec);

  // 4. INCR Throughput
  await send(["SET", "bench:t:counter", "0"]);
  const t3 = performance.now();
  for (let i = 0; i < numRequests; i++) {
    await send(["INCR", "bench:t:counter"]);
  }
  const incrSec = (performance.now() - t3) / 1000;
  results["INCR"] = Math.round(numRequests / incrSec);

  client.destroy();
  await server.close();

  return results;
}

if (process.argv[1] && process.argv[1].endsWith("throughput.js")) {
  runThroughputBenchmark().then((res) => {
    console.log("Throughput Benchmark Results (ops/sec):", res);
  });
}
