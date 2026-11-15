# Changelog: mini-redis

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [2.0.0] - 2026-11-16

### Added
- **Streaming RESP2 Protocol Parser**: Full zero-copy capable parser supporting arrays, bulk strings, integers, simple strings, nulls, and inline commands.
- **Pipelining & Partial Framing**: Accumulates fragmented TCP packets across network boundaries and processes pipelined command streams.
- **Dual Persistence Subsystems**:
  - Write-ahead AOF engine with configurable `appendfsync` policies (`always`, `everysec`, `no`).
  - Atomic AOF rewrite and compaction (`BGREWRITEAOF`).
  - RDB point-in-time snapshotting with `REDIS0009` envelope and cryptographic SHA-256 integrity verification.
  - Automatic boot recovery sequence replaying snapshots and log journals.
- **Memory Management & Eviction**:
  - Enforces configurable `maxmemory` ceilings.
  - Eviction policies: `noeviction`, `allkeys-lru`, and `volatile-ttl`.
- **TTL Schedulers**: Hybrid active background sampling sweeps + lazy read expiration.
- **Observability**:
  - Embedded Prometheus HTTP exporter on `:9121/metrics`.
  - Kubernetes health probes on `:9121/healthz`.
  - Structured JSON logging with configurable log severity levels.
- **Testing & Benchmarks**:
  - 46 automated tests across protocol conformance, AOF crash-recovery, fast-check property fuzzing, and operations.
  - Multi-dimensional benchmark suite measuring throughput (ops/sec), p50/p95/p99 latency, concurrency scaling, and memory efficiency.
- **Deployment**:
  - Multi-stage Docker image with container health checks.
  - Production Kubernetes deployment manifest (`k8s/deployment.yaml`).
  - Full documentation suite (`ARCHITECTURE.md`, `PROTOCOL.md`, `COMMANDS.md`, `PERSISTENCE.md`, `BENCHMARKS.md`, `OPERATIONS.md`, `ROADMAP.md`, `OVERVIEW.md`).

---

## [1.1.0] - 2026-11-15
### Added
- Initial experimental RESP3 protocol handshake (`HELLO 3`).
- Basic AOF logging prototype.
- GitHub Packages publish workflow.
