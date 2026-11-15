import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { crc16, extractHashTag, keyToSlot, TOTAL_HASH_SLOTS } from "../dist/cluster/hash_slot.js";

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
});
