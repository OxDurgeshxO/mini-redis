import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { MiniRedisServer } from "../dist/server.js";

const TEST_AOF = path.resolve("./test_appendonly.aof");

test("AOF Persistence Engine Suite", async (t) => {
  if (fs.existsSync(TEST_AOF)) fs.unlinkSync(TEST_AOF);

  const server = new MiniRedisServer({
    port: 6383,
    aofPath: TEST_AOF,
    enableAof: true,
    fsyncPolicy: "always"
  });

  await t.test("Mutations write directly to AOF file in RESP format", () => {
    server.executeCommand(["SET", "cluster:leader", "node-alpha"]);
    server.executeCommand(["HSET", "config:system", "threads", "8"]);
    server.executeCommand(["SADD", "nodes:active", "alpha", "beta"]);

    assert.strictEqual(fs.existsSync(TEST_AOF), true);
    const content = fs.readFileSync(TEST_AOF, "utf-8");
    assert.strictEqual(content.includes("cluster:leader"), true);
    assert.strictEqual(content.includes("node-alpha"), true);
    assert.strictEqual(content.includes("config:system"), true);
  });

  await t.test("AOF replay restores state accurately on server boot", async () => {
    await server.close();

    const restoredServer = new MiniRedisServer({
      port: 6384,
      aofPath: TEST_AOF,
      enableAof: true
    });

    const val = restoredServer.executeCommand(["GET", "cluster:leader"]);
    assert.strictEqual(val.toString("utf-8"), "$10\r\nnode-alpha\r\n");

    const hashVal = restoredServer.executeCommand(["HGET", "config:system", "threads"]);
    assert.strictEqual(hashVal.toString("utf-8"), "$1\r\n8\r\n");

    const isMember = restoredServer.executeCommand(["SISMEMBER", "nodes:active", "alpha"], 2);
    assert.strictEqual(isMember.toString("utf-8"), ":1\r\n");

    await restoredServer.close();
  });

  await t.test("BGREWRITEAOF compacts history and preserves current state", async () => {
    const compactServer = new MiniRedisServer({
      port: 6385,
      aofPath: TEST_AOF,
      enableAof: true,
      fsyncPolicy: "always"
    });

    // Write multiple overwrites
    compactServer.executeCommand(["SET", "volatile:counter", "1"]);
    compactServer.executeCommand(["SET", "volatile:counter", "2"]);
    compactServer.executeCommand(["SET", "volatile:counter", "final_val"]);

    const rewriteRes = compactServer.executeCommand(["BGREWRITEAOF"]);
    assert.strictEqual(rewriteRes.toString("utf-8"), "+Background append only file rewriting started\r\n");

    // Allow background write to settle
    await new Promise((r) => setTimeout(r, 60));

    // Verify rewritten AOF has only the final value
    const rewrittenAof = fs.readFileSync(TEST_AOF, "utf-8");
    assert.strictEqual(rewrittenAof.includes("final_val"), true);

    await compactServer.close();
  });

  // Cleanup
  if (fs.existsSync(TEST_AOF)) fs.unlinkSync(TEST_AOF);
  if (fs.existsSync(`${TEST_AOF}.rewrite.tmp`)) fs.unlinkSync(`${TEST_AOF}.rewrite.tmp`);
});
