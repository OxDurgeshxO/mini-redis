import net from "node:net";
import fs from "node:fs";
import { MiniRedisServer } from "../dist/server.js";

const PORT = 6399;
const RDB_FILE = "./bench_dump.rdb";

if (fs.existsSync(RDB_FILE)) fs.unlinkSync(RDB_FILE);

const server = new MiniRedisServer(PORT, RDB_FILE);

function encodeCommand(args: string[]): string {
  let out = *\r\n;
  for (const arg of args) {
    const len = Buffer.byteLength(arg, "utf-8");
    out += $\r\n\r\n;
  }
  return out;
}

async function runBenchmark() {
  console.log("========================================================");
  console.log("     ⚡ MINI-REDIS HIGH-THROUGHPUT BENCHMARK SUITE     ");
  console.log("========================================================\n");

  await new Promise<void>((resolve) => server.listen(resolve));

  const client = net.createConnection({ port: PORT, host: "127.0.0.1" });
  await new Promise<void>((resolve) => client.on("connect", resolve));

  const NUM_REQUESTS = 10000;

  // 1. Benchmark PING
  console.log([Benchmark] Running  PING commands...);
  const pingStart = performance.now();
  for (let i = 0; i < NUM_REQUESTS; i++) {
    await new Promise<void>((resolve) => {
      client.once("data", () => resolve());
      client.write(encodeCommand(["PING"]));
    });
  }
  const pingDuration = (performance.now() - pingStart) / 1000;
  const pingRps = Math.round(NUM_REQUESTS / pingDuration);
  console.log(✔ PING:  req/sec ( ms/req));

  // 2. Benchmark SET
  console.log([Benchmark] Running  SET commands (100B payload)...);
  const payload = "x".repeat(100);
  const setStart = performance.now();
  for (let i = 0; i < NUM_REQUESTS; i++) {
    await new Promise<void>((resolve) => {
      client.once("data", () => resolve());
      client.write(encodeCommand(["SET", ench:key:, payload]));
    });
  }
  const setDuration = (performance.now() - setStart) / 1000;
  const setRps = Math.round(NUM_REQUESTS / setDuration);
  console.log(✔ SET:   req/sec ( ms/req));

  // 3. Benchmark GET
  console.log([Benchmark] Running  GET commands...);
  const getStart = performance.now();
  for (let i = 0; i < NUM_REQUESTS; i++) {
    await new Promise<void>((resolve) => {
      client.once("data", () => resolve());
      client.write(encodeCommand(["GET", ench:key:]));
    });
  }
  const getDuration = (performance.now() - getStart) / 1000;
  const getRps = Math.round(NUM_REQUESTS / getDuration);
  console.log(✔ GET:   req/sec ( ms/req));

  client.end();
  await server.close();
  if (fs.existsSync(RDB_FILE)) fs.unlinkSync(RDB_FILE);
  console.log("\n========================================================");
  console.log("             BENCHMARK COMPLETED SUCCESSFULLY           ");
  console.log("========================================================");
}

runBenchmark().catch(console.error);