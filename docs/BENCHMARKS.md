# Performance Benchmarks & Quality Report: mini-redis

## 1. Test Environment

- **Runtime**: Node.js v26.13.1
- **Operating System**: Windows 11 / Linux (x86_64)
- **Harness**: `benchmarks/run-all.ts`
- **Clients**: Native TCP socket client with pipelining

---

## 2. Throughput Benchmarks (ops/sec)

Operations executed sequentially over TCP loopback:

| Command | Payload Size | Throughput (ops/sec) | Avg Latency (ms/req) |
|---|---|---|---|
| **PING** | N/A | **17,413** | 0.057 ms |
| **SET** | 100 bytes | **18,577** | 0.053 ms |
| **GET** | 100 bytes | **15,626** | 0.064 ms |
| **INCR** | Integer | **20,325** | 0.049 ms |

---

## 3. Latency Distribution (ms)

Percentile latency breakdown measured over 2,000 distinct operations:

| Operation | p50 | p95 | p99 | p999 | Average |
|---|---|---|---|---|---|
| **SET** | **0.050 ms** | 0.196 ms | 0.620 ms | 1.766 ms | 0.075 ms |
| **GET** | **0.053 ms** | 0.163 ms | 0.444 ms | 0.848 ms | 0.069 ms |

---

## 4. Concurrency Scaling

Saturation analysis across concurrent socket connections:

| Concurrent Clients | Total Requests | Throughput (ops/sec) |
|---|---|---|
| **10 clients** | 2,000 | **19,377 ops/sec** |
| **50 clients** | 10,000 | **18,648 ops/sec** |
| **100 clients** | 20,000 | **11,918 ops/sec** |

---

## 5. Memory Efficiency & Overhead

Estimated memory usage and heap allocation tracking:

| Active Keys | Payload Data (B) | Store Estimated (B) | Avg Bytes / Key | Process Heap (MB) |
|---|---|---|---|---|
| **1,000** | 74.8 KB | 138.8 KB | ~139 bytes | 17.5 MB |
| **5,000** | 378.8 KB | 698.8 KB | ~140 bytes | 20.0 MB |
| **10,000** | 758.8 KB | 1.39 MB | ~140 bytes | 17.5 MB |

---

## 6. Persistence Performance Impact

Evaluation of durability overhead across synchronization strategies:

| Persistence Strategy | Write Throughput | Notes |
|---|---|---|
| **AOF (`always`)** | 1,106 ops/sec | Guaranteed synchronous disk flush per command |
| **AOF (`everysec`)** | **85,920 ops/sec** | Buffered writes with background 1-second sync |
| **AOF (`no`)** | 99,211 ops/sec | Maximum write throughput (OS manages flush) |
| **RDB Snapshot Save** | 12.25 ms | Time to serialize and save 5,000 keys with SHA-256 |
| **RDB Snapshot Restore**| 13.45 ms | Time to verify checksum and restore 5,000 keys |
