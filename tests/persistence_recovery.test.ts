import { test } from "node:test";
import assert from "node:assert";
import fs from "fs";
import { KeyValueStore } from "../dist/storage/memory-store.js";
import { AofEngine } from "../dist/persistence/aof.js";
import { RdbSnapshotEngine } from "../dist/persistence/rdb-snapshot.js";
import { RecoveryManager } from "../dist/persistence/recovery.js";

const TEST_AOF = "recovery_test.aof";
const TEST_RDB = "recovery_test.rdb";

test("Persistence, Recovery & Eviction Suite", async (t) => {
  t.beforeEach(() => {
    if (fs.existsSync(TEST_AOF)) fs.unlinkSync(TEST_AOF);
    if (fs.existsSync(TEST_RDB)) fs.unlinkSync(TEST_RDB);
  });

  t.afterEach(() => {
    if (fs.existsSync(TEST_AOF)) fs.unlinkSync(TEST_AOF);
    if (fs.existsSync(TEST_RDB)) fs.unlinkSync(TEST_RDB);
  });

  await t.test("AOF crash simulation & recovery", () => {
    const aof = new AofEngine(TEST_AOF, "always");
    aof.init();

    // Write a series of mutations
    aof.write(["SET", "usr:100", "Alice"]);
    aof.write(["SET", "usr:101", "Bob"]);
    aof.write(["INCR", "counter"]);
    aof.write(["INCR", "counter"]);
    aof.write(["DEL", "usr:100"]);
    aof.close();

    // Recover into fresh store
    const freshStore = new KeyValueStore();
    const replayEngine = new AofEngine(TEST_AOF, "no");
    const replayed = replayEngine.replay(freshStore);

    assert.strictEqual(replayed, 5);
    assert.strictEqual(freshStore.get("usr:100"), null);
    assert.strictEqual(freshStore.get("usr:101"), "Bob");
    assert.strictEqual(freshStore.get("counter"), "2");
  });

  await t.test("RDB snapshot with SHA-256 integrity check and restoration", () => {
    const store = new KeyValueStore();
    store.set("snap:a", "val-a");
    store.hset("snap:hash", "field1", "val1");
    store.sadd("snap:set", ["member1", "member2"]);

    const rdb = new RdbSnapshotEngine(TEST_RDB);
    const saved = rdb.save(store);
    assert.strictEqual(saved, true);
    assert.strictEqual(fs.existsSync(TEST_RDB), true);

    const freshStore = new KeyValueStore();
    const restored = rdb.restore(freshStore);
    assert.strictEqual(restored, true);
    assert.strictEqual(freshStore.get("snap:a"), "val-a");
    assert.strictEqual(freshStore.hget("snap:hash", "field1"), "val1");
    assert.strictEqual(freshStore.sismember("snap:set", "member1"), true);
  });

  await t.test("RDB corrupted file rejection", () => {
    const store = new KeyValueStore();
    store.set("tamper:key", "original");

    const rdb = new RdbSnapshotEngine(TEST_RDB);
    rdb.save(store);

    // Tamper with data payload without updating checksum
    const content = fs.readFileSync(TEST_RDB, "utf-8");
    const tampered = content.replace("original", "tampered_val");
    fs.writeFileSync(TEST_RDB, tampered, "utf-8");

    const restoreStore = new KeyValueStore();
    const restored = rdb.restore(restoreStore);
    assert.strictEqual(restored, false); // Must fail integrity verification
  });

  await t.test("Memory Eviction: noeviction throws OOM error", () => {
    const store = new KeyValueStore({
      maxMemoryBytes: 200, // Very tight memory limit
      evictionPolicy: "noeviction"
    });

    store.set("k1", "small");
    assert.throws(() => {
      // Trying to write a large payload exceeding maxmemory
      store.set("k2", "x".repeat(300));
    }, /OOM command not allowed/);
  });

  await t.test("Memory Eviction: allkeys-lru evicts least recently accessed key", () => {
    const store = new KeyValueStore({
      maxMemoryBytes: 180,
      evictionPolicy: "allkeys-lru"
    });

    store.set("oldest", "val1");
    store.set("newest", "val2");

    // Access "newest" to refresh its lastAccessedAt
    store.get("newest");

    // Write a new key that forces eviction
    store.set("latest", "val3");

    // Oldest key should have been evicted
    assert.strictEqual(store.get("oldest"), null);
    assert.strictEqual(store.get("latest"), "val3");
  });

  await t.test("TTL expiration: lazy vs active sweeps", async () => {
    const store = new KeyValueStore();
    store.set("expire:quick", "temp", 20); // 20ms TTL

    await new Promise((r) => setTimeout(r, 40));

    // Lazy expiration on read
    assert.strictEqual(store.get("expire:quick"), null);
    assert.strictEqual(store.exists("expire:quick"), false);
  });
});
