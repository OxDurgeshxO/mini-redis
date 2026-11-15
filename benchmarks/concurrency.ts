import net from "net";
import { MiniRedisServer } from "../dist/server/tcp-server.js";
import { RespEncoder } from "../dist/protocol/resp/encoder.js";

const PORT = 6403;

export async function runConcurrencyBenchmark(): Promise<Record<string, number>> {
  const server = new MiniRedisServer({ port: PORT, maxClients: 1000, enableAof: false });
  await server.listen();

  const concurrencyLevels = [10, 50, 100];
  const results: Record<string, number> = {};

  for (const concurrency of concurrencyLevels) {
    const clients: net.Socket[] = [];
    for (let c = 0; c < concurrency; c++) {
      const client = net.createConnection({ port: PORT });
      await new Promise<void>((r) => client.once("connect", () => r()));
      clients.push(client);
    }

    const requestsPerClient = 200;
    const totalRequests = concurrency * requestsPerClient;
    const t0 = performance.now();

    await Promise.all(
      clients.map(async (client, clientIdx) => {
        for (let i = 0; i < requestsPerClient; i++) {
          await new Promise<void>((resolve) => {
            client.once("data", () => resolve());
            client.write(RespEncoder.commandToBuffer(["PING"]));
          });
        }
      })
    );

    const durationSec = (performance.now() - t0) / 1000;
    const rps = Math.round(totalRequests / durationSec);
    results[`concurrency_${concurrency}`] = rps;

    for (const client of clients) {
      client.destroy();
    }
  }

  await server.close();
  return results;
}

if (process.argv[1] && process.argv[1].endsWith("concurrency.js")) {
  runConcurrencyBenchmark().then((res) => {
    console.log("Concurrency Scaling Results (ops/sec):", res);
  });
}
