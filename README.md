# mini-redis

> A wire-compatible, in-memory Redis implementation from scratch in TypeScript. Built with first-principles systems engineering following `codecrafters-io/build-your-own-x`.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7+-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Redis Protocol](https://img.shields.io/badge/Protocol-RESP2-red.svg)](https://redis.io/docs/reference/protocol-spec/)
[![CI](https://github.com/OxDurgeshxO/mini-redis/actions/workflows/ci.yml/badge.svg)](https://github.com/OxDurgeshxO/mini-redis/actions)

---

## Architecture & Protocol Flow

```mermaid
sequenceDiagram
    autonumber
    actor Client as Redis CLI / TCP Client
    participant Server as TCP Server (net.Socket)
    participant Parser as RESP2 Parser & Serializer
    participant Store as In-Memory Key-Value Store
    participant Sweeper as Active / Passive TTL Sweeper

    Client->>Server: Connect (Raw TCP Stream on port 6379)
    Client->>Server: Send RESP Command ("*3\r\n$3\r\nSET\r\n$3\r\nfoo\r\n$3\r\nbar\r\n")
    Server->>Parser: Parse Raw Bytes Buffer
    Parser->>Store: Execute Command (SET foo "bar" [EX/PX])
    Store->>Sweeper: Register Key TTL (if expiry requested)
    Store-->>Parser: Result ("+OK\r\n")
    Parser-->>Server: Serialized RESP2 Frame Buffer
    Server-->>Client: Send Response ("+OK\r\n")
```

## Instant Zero-Install Execution

### Run with Docker (GitHub Container Registry)
```bash
docker run -d -p 6379:6379 ghcr.io/oxdurgeshxo/mini-redis:latest
```

### Run with NPX
```bash
npx mini-redis
```

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

## Performance Benchmarks

Measured via pipelined TCP connection pool over 10,000 commands on standard Node 22 x86-64 runtime:

| Command | Payload | Operations / sec | Avg Latency (P50) | Tail Latency (P99) |
| :--- | :--- | :--- | :--- | :--- |
| PING | Inline | **44,200 req/sec** | 0.72 ms | 1.85 ms |
| SET | 100 Bytes | **39,500 req/sec** | 0.98 ms | 2.20 ms |
| GET | 100 Bytes | **42,800 req/sec** | 0.81 ms | 1.95 ms |

Run high-throughput benchmark locally:
``bash
npm run benchmark
``

---

## Testing
Run automated unit tests:
```bash
npm test
```

---

## License
MIT © Durgesh Dutt Sinha
