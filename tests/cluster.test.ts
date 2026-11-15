import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { crc16, extractHashTag, keyToSlot, TOTAL_HASH_SLOTS } from "../dist/cluster/hash_slot.js";
import { ClusterManager } from "../dist/cluster/cluster_manager.js";
import { CommandRouter } from "../dist/server/router.js";
import { KeyValueStore } from "../dist/storage/memory-store.js";

describe("Redis Cluster Hash Slot (CRC16)", () => {
  it("computes CRC16 for known string test vectors", () => {
    // "123456789" standard CRC-16/CCITT-FALSE vector: 0x31C3 (12739)
    const crc = crc16("123456789");
    assert.equal(crc, 0x31c3);
  });

  it("extracts hash tags correctly from Redis keys", () => {
    assert.equal(extractHashTag("user:100"), "user:100");
    assert.equal(extractHashTag("{user:100}:profile"), "user:100");
    assert.equal(extractHashTag("prefix:{user:100}:suffix"), "user:100");
    // Empty tag {} falls back to full key
    assert.equal(extractHashTag("{}empty"), "{}empty");
  });

  it("routes keys with identical hash tags to identical hash slots", () => {
    const slot1 = keyToSlot("{athlete:marcus}:reps");
    const slot2 = keyToSlot("{athlete:marcus}:calories");
    const slot3 = keyToSlot("{athlete:marcus}:profile");

    assert.equal(slot1, slot2);
    assert.equal(slot2, slot3);
    assert.ok(slot1 >= 0 && slot1 < TOTAL_HASH_SLOTS);
  });

  it("ensures slots always map within [0, 16383]", () => {
    const keys = ["foo", "bar", "baz", "athlete:1", "session:abc", "counter"];
    for (const k of keys) {
      const slot = keyToSlot(k);
      assert.ok(slot >= 0 && slot < 16384, `Slot ${slot} for key ${k} is out of bounds`);
    }
  });

  it("ClusterManager generates valid CLUSTER NODES topology and -MOVED redirection", () => {
    const cm = new ClusterManager({
      nodeId: "node-1-abc",
      ip: "10.0.0.1",
      port: 6379,
      startSlot: 0,
      endSlot: 8191,
    });
    cm.addPeer({
      id: "node-2-def",
      ip: "10.0.0.2",
      port: 6380,
      cport: 16380,
      flags: ["master"],
      masterId: "-",
      startSlot: 8192,
      endSlot: 16383,
    });

    const nodes = cm.getClusterNodes();
    assert.ok(nodes.includes("node-1-abc 10.0.0.1:6379@16379 myself,master"));
    assert.ok(nodes.includes("node-2-def 10.0.0.2:6380@16380 master"));

    // Check slot locality and redirection
    const localRes = cm.checkKeyAccess("{user:100}:reps");
    assert.ok(typeof localRes.slot === "number");

    // Force key access outside local slot range
    const remoteAccess = cm.checkKeyAccess("test-remote-key-999");
    if (!cm.isSlotLocal(remoteAccess.slot)) {
      assert.ok(remoteAccess.redirection?.startsWith(`-MOVED ${remoteAccess.slot} 10.0.0.2:6380`));
    }
  });

  it("CommandRouter processes CLUSTER KEYSLOT, INFO, and SLOTS commands", () => {
    const store = new KeyValueStore();
    const router = new CommandRouter(store);

    const keyslotRes = router.dispatch(["CLUSTER", "KEYSLOT", "athlete:100"]);
    const expectedSlot = keyToSlot("athlete:100");
    assert.equal(keyslotRes.response.toString(), `:${expectedSlot}\r\n`);

    const infoRes = router.dispatch(["CLUSTER", "INFO"]);
    assert.ok(infoRes.response.toString().includes("cluster_state:ok"));

    const slotsRes = router.dispatch(["CLUSTER", "SLOTS"]);
    assert.ok(slotsRes.response.toString().startsWith("*"));
  });
});
