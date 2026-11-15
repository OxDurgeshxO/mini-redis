# Operational Runbook & Production Deployment: mini-redis

## 1. Container Deployment (Docker)

`mini-redis` includes a multi-stage Docker build with built-in health check probes:

```bash
# Build production Docker image
docker build -t mini-redis:v2.0.0 .

# Run with persistent volume and exposed metrics
docker run -d \
  --name mini-redis \
  -p 6379:6379 \
  -p 9121:9121 \
  -v mini_redis_data:/data \
  -e REDIS_AOF=true \
  -e REDIS_AOF_PATH=/data/appendonly.aof \
  -e REDIS_RDB_PATH=/data/dump.rdb \
  mini-redis:v2.0.0
```

---

## 2. Kubernetes Deployment (`k8s/deployment.yaml`)

Production Kubernetes manifest featuring:
- Readiness and liveness probes against `:9121/healthz`
- Prometheus scrape annotations on `:9121/metrics`
- PersistentVolumeClaim for durable storage
- Graceful termination lifecycle hooks (`terminationGracePeriodSeconds: 30`)

---

## 3. Prometheus Observability & Alerting

### Metric Scraping Configuration
Add this scrape job to your `prometheus.yml`:
```yaml
scrape_configs:
  - job_name: 'mini-redis'
    static_configs:
      - targets: ['mini-redis-service:9121']
    metrics_path: '/metrics'
    scrape_interval: 10s
```

### Key Production Alerts
1. **Saturation Alert (`mini_redis_connected_clients > 8000`)**: Indicates connection leak or client pool misconfiguration.
2. **Eviction Spike (`rate(mini_redis_evicted_keys_total[5m]) > 100`)**: Database approaching `maxmemory` limit.
3. **High Latency Alert (`mini_redis_command_latency_seconds_bucket > 0.05`)**: Investigate disk I/O contention during AOF sync.

---

## 4. Graceful Shutdown & Connection Draining

When receiving `SIGINT` or `SIGTERM`:
1. Server stops accepting new client connections.
2. Active client sockets are cleanly processed and drained.
3. In-flight AOF buffers are flushed and `fsync`ed to physical disk.
4. Background timers (TTL scheduler, sync intervals) are stopped.
5. Sockets and HTTP metrics listeners are closed.
