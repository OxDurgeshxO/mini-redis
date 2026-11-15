import test from "node:test";
import assert from "node:assert";
import { MiniRedisServer } from "../dist/server.js";
import { RespEncoder } from "../dist/resp.js";

test("MiniRedis Command Execution Suite", async (t) => {
  const server = new MiniRedisServer(6380);

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
});
