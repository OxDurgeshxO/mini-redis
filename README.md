# mini-redis

> A wire-compatible, in-memory Redis implementation from scratch in TypeScript. Built with first-principles systems engineering following `codecrafters-io/build-your-own-x`.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7+-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Redis Protocol](https://img.shields.io/badge/Protocol-RESP2-red.svg)](https://redis.io/docs/reference/protocol-spec/)

---

## Architecture & Features

- **RESP Parser & Serializer:** Implements the official Redis Serialization Protocol (Simple Strings, Errors, Integers, Bulk Strings, Arrays) over raw TCP streams.
- **Asynchronous Event Loop:** Native Node.js `net` socket server handling concurrent clients without external runtime dependencies.
- **In-Memory Key-Value Store:** Memory map supporting atomic `SET`, `GET`, `DEL`, `EXISTS`, and `DBSIZE`.
- **TTL Expiration Engine:** High-resolution millisecond key expiration (`PX` and `EX` flags) with active memory garbage collection on access.
- **RDB Disk Persistence Engine:** Binary `.rdb` point-in-time snapshot generator with atomic temp-file flushing and automatic state restoration on server boot.

---

## Supported Commands

| Command | Syntax | Description |
| :--- | :--- | :--- |
| `PING` | `PING [msg]` | Returns `+PONG` or echoes custom bulk string |
| `ECHO` | `ECHO <msg>` | Returns `<msg>` as a bulk string |
| `SET` | `SET <key> <val> [PX ms] [EX sec]` | Sets key with optional millisecond/second expiration |
| `GET` | `GET <key>` | Returns stored bulk string or `$-1` if expired / not found |
| `DEL` | `DEL <key> [key2...]` | Deletes keys and returns count of removed entries |
| `EXISTS` | `EXISTS <key> [key2...]` | Checks presence of keys, returns integer count |
| `DBSIZE` | `DBSIZE` | Returns current active key count |
| `SAVE` | `SAVE` | Synchronously flushes RDB snapshot to disk |
| `BGSAVE` | `BGSAVE` | Asynchronously dumps point-in-time snapshot to disk in background |

---

## Quick Start

### 1. Build and Run
```bash
npm install
npm run build
npm start
```

### 2. Connect via official `redis-cli`
```bash
redis-cli -p 6379 PING
# Output: PONG

redis-cli -p 6379 SET session:token "xyz987" PX 5000
# Output: OK

redis-cli -p 6379 GET session:token
# Output: "xyz987" (returns nil after 5 seconds)
```

---

## Testing
Run automated unit tests:
```bash
npm test
```

---

## License
MIT © Durgesh Dutt Sinha
