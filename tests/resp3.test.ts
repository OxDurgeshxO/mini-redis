import test from "node:test";
import assert from "node:assert";
import { MiniRedisServer } from "../dist/server.js";

test("RESP3 Protocol & Data Types Suite", async (t) => {
  const server = new MiniRedisServer({ port: 6382 });

  await t.test("HELLO 3 switches protocol and returns server metadata map", () => {
    const res = server.executeCommand(["HELLO", "3"], 3);
    const text = res.toString("utf-8");
    // Should start with RESP3 Map prefix '%' with 5 key-value pairs
    assert.strictEqual(text.startsWith("%5\r\n"), true);
    assert.strictEqual(text.includes("$6\r\nserver\r\n$10\r\nmini-redis\r\n"), true);
    assert.strictEqual(text.includes("$5\r\nproto\r\n$1\r\n3\r\n"), true);
  });

  await t.test("HSET, HGET, and HGETALL under RESP3 vs RESP2", () => {
    const hsetRes = server.executeCommand(["HSET", "user:101", "name", "Durgesh", "role", "Architect"]);
    assert.strictEqual(hsetRes.toString("utf-8"), ":2\r\n");

    const hgetRes = server.executeCommand(["HGET", "user:101", "name"]);
    assert.strictEqual(hgetRes.toString("utf-8"), "$7\r\nDurgesh\r\n");

    // Under RESP3, HGETALL returns %2
    const hgetAllResp3 = server.executeCommand(["HGETALL", "user:101"], 3);
    assert.strictEqual(hgetAllResp3.toString("utf-8").startsWith("%2\r\n"), true);

    // Under RESP2, HGETALL returns *4
    const hgetAllResp2 = server.executeCommand(["HGETALL", "user:101"], 2);
    assert.strictEqual(hgetAllResp2.toString("utf-8").startsWith("*4\r\n"), true);
  });

  await t.test("SADD, SMEMBERS, and SISMEMBER under RESP3 vs RESP2", () => {
    const saddRes = server.executeCommand(["SADD", "tags:ai", "cv", "nlp", "llm"]);
    assert.strictEqual(saddRes.toString("utf-8"), ":3\r\n");

    // Under RESP3, SISMEMBER returns boolean '#t' or '#f'
    const isMemberTrue = server.executeCommand(["SISMEMBER", "tags:ai", "cv"], 3);
    assert.strictEqual(isMemberTrue.toString("utf-8"), "#t\r\n");

    const isMemberFalse = server.executeCommand(["SISMEMBER", "tags:ai", "blockchain"], 3);
    assert.strictEqual(isMemberFalse.toString("utf-8"), "#f\r\n");

    // Under RESP2, SISMEMBER returns integer :1 or :0
    const isMemberResp2 = server.executeCommand(["SISMEMBER", "tags:ai", "cv"], 2);
    assert.strictEqual(isMemberResp2.toString("utf-8"), ":1\r\n");

    // Under RESP3, SMEMBERS returns Set prefix '~'
    const smembersResp3 = server.executeCommand(["SMEMBERS", "tags:ai"], 3);
    assert.strictEqual(smembersResp3.toString("utf-8").startsWith("~3\r\n"), true);
  });

  await t.test("GET returns RESP3 null '_' vs RESP2 '$-1'", () => {
    const nullResp3 = server.executeCommand(["GET", "nonexistent_key"], 3);
    assert.strictEqual(nullResp3.toString("utf-8"), "_\r\n");

    const nullResp2 = server.executeCommand(["GET", "nonexistent_key"], 2);
    assert.strictEqual(nullResp2.toString("utf-8"), "$-1\r\n");
  });
});
