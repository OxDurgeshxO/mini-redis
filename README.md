# mini-redis

> A wire-compatible, in-memory Redis implementation from scratch in TypeScript with RESP2/RESP3 protocol, AOF write-ahead logging, RDB snapshotting, and Node Single Executable Application (SEA) binary compilation. Built with first-principles systems engineering following `codecrafters-io/build-your-own-x`.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7+-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Redis Protocol](https://img.shields.io/badge/Protocol-RESP2%20%7C%20RESP3-red.svg)](https://redis.io/docs/reference/protocol-spec/)
[![Persistence](https://img.shields.io/badge/Persistence-AOF%20%2B%20RDB-green.svg)](https://redis.io/docs/management/persistence/)

---

## Architecture & Features

- **RESP2 & RESP3 Parser & Serializer:** Implements the official Redis Serialization Protocol with full support for RESP3 Maps (`%`), Sets (`~`), Doubles (`,`), Booleans (`#`), Verbatim Strings (`=`), and Nulls (`_`).
- **Protocol Handshake (`HELLO`):** Seamless protocol version negotiation allowing modern Redis SDKs and `redis-cli` to switch between RESP2 and RESP3 dynamically.
- **Append-Only File (AOF) Persistence Engine:** Real-time write-ahead logging with configurable `fsync` policies (`always`, `everysec`, `no`), automated startup replay, and non-blocking background compaction (`BGREWRITEAOF`).
- **RDB Disk Persistence Engine:** Binary `.rdb` point-in-time snapshot generator with atomic temp-file flushing and automatic state restoration on server boot.
- **Advanced Data Structures:** In-memory string key-values with millisecond TTL (`PX`/`EX`), Hashes (`HSET`, `HGET`, `HGETALL`), and Sets (`SADD`, `SMEMBERS`, `SISMEMBER`).
- **Node Single Executable Application (SEA):** Configured for standalone native executable compilation without external Node runtime prerequisites.

---

## Supported Commands

| Command | Syntax | Description |
| :--- | :--- | :--- |
| `HELLO` | `HELLO [proto]` | Protocol handshake; switches connection between RESP2 and RESP3 |
| `PING` | `PING [msg]` | Returns `+PONG` or echoes custom payload |
| `ECHO` | `ECHO <msg>` | Returns `<msg>` as a bulk string |
| `SET` | `SET <key> <val> [PX ms] [EX sec]` | Sets key with optional millisecond/second expiration |
| `GET` | `GET <key>` | Returns stored bulk string or `$-1` / `_` (RESP3 null) |
| `DEL` | `DEL <key> [key2...]` | Deletes keys and returns count of removed entries |
| `EXISTS` | `EXISTS <key> [key2...]` | Checks presence of keys, returns integer count |
| `DBSIZE` | `DBSIZE` | Returns current active key count across all data types |
| `HSET` | `HSET <key> <field> <val> ...` | Sets field-value pairs in hash; returns count of added fields |
| `HGET` | `HGET <key> <field>` | Returns stored field value or null |
| `HGETALL` | `HGETALL <key>` | Returns RESP3 Map or RESP2 flattened array of all entries |
| `SADD` | `SADD <key> <member> ...` | Adds members to set; returns count of newly added members |
| `SMEMBERS` | `SMEMBERS <key>` | Returns RESP3 Set or RESP2 array of all members |
| `SISMEMBER` | `SISMEMBER <key> <member>` | Checks set membership; returns boolean (`#t`/`#f`) or integer (`1`/`0`) |
| `SAVE` | `SAVE` | Synchronously flushes RDB snapshot to disk |
| `BGSAVE` | `BGSAVE` | Asynchronously dumps point-in-time snapshot to disk in background |
| `BGREWRITEAOF` | `BGREWRITEAOF` | Asynchronously rewrites and compacts AOF log file |

---

## Quick Start

### 1. Build and Run
```bash
npm install
npm run build
npm start
```

### 2. Run with AOF Persistence
```bash
node dist/index.js --port 6379 --aof --aof-path appendonly.aof
```

### 3. Connect via official `redis-cli`
```bash
# Connect and negotiate RESP3
redis-cli -p 6379 HELLO 3

# Hash operations
redis-cli -p 6379 HSET user:100 name "Durgesh" role "Architect"
redis-cli -p 6379 HGETALL user:100

# Set operations
redis-cli -p 6379 SADD tags:skills "cv" "redis" "compilers"
redis-cli -p 6379 SMEMBERS tags:skills
```

### 4. Build Standalone Single Executable (Node SEA)
```bash
npm run build:sea
```

---

## Test & Verification

Run the 20-test verification suite covering commands, RESP3 types, and AOF persistence:
```bash
npm test
```
