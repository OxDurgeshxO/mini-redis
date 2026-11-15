import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { MiniRedisServer } from "../dist/server.js";

const TEST_RDB = path.resolve("./test_dump.rdb");

test("MiniRedis Command Execution Suite", async (t) => {
  // Clean up any test rdb file before starting
  if (fs.existsSync(TEST_RDB)) fs.unlinkSync(TEST_RDB);

  const server = new MiniRedisServer(6380, TEST_RDB);

  await t.test("PING command returns +PONG", () => {
    const res = server.executeCommand(["PING"]);
    assert.strictEqual(res.toString("utf-8"), "+PONG\r\n");
  });

  await t.test("PING with custom argument returns bulk string", () => {
    const res = server.executeCommand(["PING", "hello-world"]);
    assert.strictEqual(res.toString("utf-8"), "$11\r\nhello-world\r\n");
  });

  await t.test("ECHO command echoes string", () => {
    const res = server.executeCommand(["ECHO", "test-payload"]);
    assert.strictEqual(res.toString("utf-8"), "$12\r\ntest-payload\r\n");
  });

  await t.test("SET and GET key-value cycle", () => {
    const setRes = server.executeCommand(["SET", "user:durgesh", "active"]);
    assert.strictEqual(setRes.toString("utf-8"), "+OK\r\n");

    const getRes = server.executeCommand(["GET", "user:durgesh"]);
    assert.strictEqual(getRes.toString("utf-8"), "$6\r\nactive\r\n");
  });

  await t.test("EXISTS checks presence", () => {
    const existsRes = server.executeCommand(["EXISTS", "user:durgesh"]);
    assert.strictEqual(existsRes.toString("utf-8"), ":1\r\n");

    const notFound = server.executeCommand(["EXISTS", "nonexistent"]);
    assert.strictEqual(notFound.toString("utf-8"), ":0\r\n");
  });

  await t.test("DEL removes keys and returns count", () => {
    const delRes = server.executeCommand(["DEL", "user:durgesh"]);
    assert.strictEqual(delRes.toString("utf-8"), ":1\r\n");

    const getRes = server.executeCommand(["GET", "user:durgesh"]);
    assert.strictEqual(getRes.toString("utf-8"), "$-1\r\n"); // Null bulk string
  });

  await t.test("SET with PX expiration expires accurately", async () => {
    server.executeCommand(["SET", "temp:key", "temporary", "PX", "50"]);
    
    // Immediate get should work
    const immediate = server.executeCommand(["GET", "temp:key"]);
    assert.strictEqual(immediate.toString("utf-8"), "$9\r\ntemporary\r\n");

    // Wait 60ms
    await new Promise((r) => setTimeout(r, 60));

    const expired = server.executeCommand(["GET", "temp:key"]);
    assert.strictEqual(expired.toString("utf-8"), "$-1\r\n");
  });

  await t.test("SAVE command writes RDB snapshot to disk", () => {
    server.executeCommand(["SET", "persist:key", "durable-value"]);
    const saveRes = server.executeCommand(["SAVE"]);
    assert.strictEqual(saveRes.toString("utf-8"), "+OK\r\n");
    assert.strictEqual(fs.existsSync(TEST_RDB), true);

    const contents = fs.readFileSync(TEST_RDB);
    assert.strictEqual(contents.subarray(0, 9).toString("utf-8"), "REDIS0009");
  });

  await t.test("BGSAVE command triggers background snapshot", async () => {
    const bgsaveRes = server.executeCommand(["BGSAVE"]);
    assert.strictEqual(bgsaveRes.toString("utf-8"), "+Background saving started\r\n");
    await new Promise((r) => setTimeout(r, 20));
    assert.strictEqual(fs.existsSync(TEST_RDB), true);
  });

  await t.test("Server restores snapshot data on restart", () => {
    const freshServer = new MiniRedisServer(6381, TEST_RDB);
    const restored = freshServer.executeCommand(["GET", "persist:key"]);
    assert.strictEqual(restored.toString("utf-8"), "$13\r\ndurable-value\r\n");
  });

  // Cleanup test rdb file
  if (fs.existsSync(TEST_RDB)) fs.unlinkSync(TEST_RDB);
});
