# Persistence & Durability Architecture: mini-redis

## 1. Overview of Durability Modes

`mini-redis` provides two distinct durability subsystems:
1. **Append-Only File (AOF)**: Operation logging capturing every state-altering mutation in wire-compatible RESP format.
2. **Redis Database Snapshot (RDB)**: Point-in-time binary snapshotting of in-memory data structures with SHA-256 integrity verification.

By default, **AOF is enabled** with the `everysec` synchronization policy.

---

## 2. AOF Synchronization Policies (`appendfsync`)

| Policy | Behavior | Performance | Data Loss Window |
|---|---|---|---|
| `always` | `fsync` executed synchronously after every single write command. | ~1,100 ops/sec (I/O bound) | 0 seconds (maximum durability) |
| `everysec` *(default)* | Buffered writes flushed to OS cache immediately; background timer runs `fsync` every 1,000ms. | ~85,000 ops/sec | At most 1 second of transactions |
| `no` | Flushed to OS buffer cache; OS flushes to physical disk when ready. | ~100,000 ops/sec | Dependent on OS buffer flush (~30s) |

---

## 3. AOF Log Compaction (`BGREWRITEAOF`)

Over time, write-heavy workloads cause the AOF log to grow indefinitely (e.g. 100,000 `INCR counter` commands). Compaction synthesizes the exact current state of the database into the minimum number of commands:
- 100,000 `INCR counter` -> 1 `SET counter 100000`
- Intermediate writes to deleted keys are omitted entirely.
- Remaining key TTLs are calculated and injected as `PX <remaining_ms>`.

Compaction writes to a temporary file (`appendonly.aof.rewrite.<timestamp>`) and renames it atomically to replace the active log.

---

## 4. RDB Snapshots (`SAVE` & `BGSAVE`)

RDB snapshots freeze the database into an immutable file (`dump.rdb`):
```text
+-------------------+-----------------------------------+------+
| REDIS0009 (9B)    | JSON Envelope with SHA-256 Checksum | 0xFF |
+-------------------+-----------------------------------+------+
```

### Checksum Validation
When restoring an RDB file, the engine recalculates the SHA-256 hash across the serialized dataset. If any byte was corrupted or tampered with on disk, the snapshot is rejected and an error is logged, preventing corrupted state initialization.

---

## 5. Backup & Restore Runbook

### Creating a Hot Backup
1. Trigger background snapshot:
   ```bash
   redis-cli -p 6379 BGSAVE
   ```
2. Wait for `INFO` to show snapshot completion.
3. Copy `dump.rdb` to offsite storage:
   ```bash
   cp dump.rdb /backups/dump-$(date +%Y%m%d%H%M%S).rdb
   ```

### Restoring from Backup
1. Stop the running `mini-redis` instance.
2. Copy the backup file into the data directory as `dump.rdb`:
   ```bash
   cp /backups/dump-20261116.rdb ./dump.rdb
   ```
3. Start `mini-redis` with `--no-aof` (or delete outdated `appendonly.aof`). The server will restore the snapshot on boot.
