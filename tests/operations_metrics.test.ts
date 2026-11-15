import { test } from "node:test";
import assert from "node:assert";
import http from "http";
import { MiniRedisServer } from "../dist/server/tcp-server.js";
import { metrics } from "../dist/observability/metrics.js";

const TEST_PORT = 6389;
const METRICS_PORT = 9129;

test("Operations, Metrics & Observability Suite", async (t) => {
  const server = new MiniRedisServer({
    port: TEST_PORT,
    metricsPort: METRICS_PORT,
    enableAof: false
  });
  await server.listen();

  const httpGet = (path: string): Promise<{ status: number; body: string }> => {
    return new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${METRICS_PORT}${path}`, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve({ status: res.statusCode || 0, body: data }));
        res.on("error", reject);
      });
    });
  };

  await t.test("INFO command returns server and memory statistics", () => {
    server.executeCommand(["SET", "stat:key", "value"]);
    const infoRes = server.executeCommand(["INFO"]);
    const infoText = infoRes.toString("utf-8");

    assert(infoText.includes("redis_version:"));
    assert(infoText.includes("used_memory:"));
    assert(infoText.includes("total_keys:1"));
  });

  await t.test("DBSIZE command accurately returns active key count", () => {
    const sizeBefore = server.executeCommand(["DBSIZE"]);
    assert.strictEqual(sizeBefore.toString("utf-8"), ":1\r\n");

    server.executeCommand(["SET", "stat:key2", "value2"]);
    const sizeAfter = server.executeCommand(["DBSIZE"]);
    assert.strictEqual(sizeAfter.toString("utf-8"), ":2\r\n");
  });

  await t.test("CONFIG GET and SET runtime configuration changes", () => {
    const setRes = server.executeCommand(["CONFIG", "SET", "maxmemory-policy", "allkeys-lru"]);
    assert.strictEqual(setRes.toString("utf-8"), "+OK\r\n");

    const getRes = server.executeCommand(["CONFIG", "GET", "maxmemory-policy"]);
    assert(getRes.toString("utf-8").includes("allkeys-lru"));
  });

  await t.test("CLIENT LIST command returns connected client list", () => {
    const clientRes = server.executeCommand(["CLIENT", "LIST"]);
    assert(clientRes.toString("utf-8").includes("id="));
  });

  await t.test("Prometheus /metrics endpoint exposes valid telemetry", async () => {
    const res = await httpGet("/metrics");
    assert.strictEqual(res.status, 200);
    assert(res.body.includes("mini_redis_uptime_seconds"));
    assert(res.body.includes("mini_redis_commands_total"));
    assert(res.body.includes("mini_redis_keys_total"));
  });

  await t.test("Health check /healthz endpoint returns 200 healthy", async () => {
    const res = await httpGet("/healthz");
    assert.strictEqual(res.status, 200);
    const json = JSON.parse(res.body);
    assert.strictEqual(json.status, "healthy");
  });

  await server.close();
});
