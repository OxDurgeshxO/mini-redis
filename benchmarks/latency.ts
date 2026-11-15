import net from "net";
import { MiniRedisServer } from "../dist/server/tcp-server.js";
import { RespEncoder } from "../dist/protocol/resp/encoder.js";

const PORT = 6402;

export interface LatencyDistribution {
  p50: number;
  p95: number;
  p99: number;
  p999: number;
  avg: number;
}

function computePercentiles(samples: number[]): LatencyDistribution {
  samples.sort((a, b) => a - b);
  const n = samples.length;
  const p50 = samples[Math.floor(n * 0.5)];
  const p95 = samples[Math.floor(n * 0.95)];
  const p99 = samples[Math.floor(n * 0.99)];
  const p999 = samples[Math.floor(n * 0.999)];
  const sum = samples.reduce((acc, v) => acc + v, 0);
  return {
    p50: Number(p50.toFixed(3)),
    p95: Number(p95.toFixed(3)),
    p99: Number(p99.toFixed(3)),
    p999: Number(p999.toFixed(3)),
    avg: Number((sum / n).toFixed(3))
  };
}

export async function runLatencyBenchmark(samplesCount: number = 3000): Promise<Record<string, LatencyDistribution>> {
  const server = new MiniRedisServer({ port: PORT, enableAof: false });
  await server.listen();

  const client = net.createConnection({ port: PORT });
  await new Promise<void>((r) => client.once("connect", () => r()));

  const sendMeasured = (args: string[]): Promise<number> => {
    return new Promise((resolve) => {
      const t0 = performance.now();
      client.once("data", () => {
        resolve(performance.now() - t0);
      });
      client.write(RespEncoder.commandToBuffer(args));
    });
  };

  const setLatencies: number[] = [];
  for (let i = 0; i < samplesCount; i++) {
    const lat = await sendMeasured(["SET", `bench:lat:${i}`, "test-value"]);
    setLatencies.push(lat);
  }

  const getLatencies: number[] = [];
  for (let i = 0; i < samplesCount; i++) {
    const lat = await sendMeasured(["GET", `bench:lat:${i}`]);
    getLatencies.push(lat);
  }

  client.destroy();
  await server.close();

  return {
    SET: computePercentiles(setLatencies),
    GET: computePercentiles(getLatencies)
  };
}

if (process.argv[1] && process.argv[1].endsWith("latency.js")) {
  runLatencyBenchmark().then((res) => {
    console.log("Latency Percentiles (ms):", JSON.stringify(res, null, 2));
  });
}
