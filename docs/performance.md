# Performance

## Budgets

- Initial JavaScript: **500,000 raw bytes**, including eager imports.
- Controller comparison target: at most **5% above the reference workload**.
- Deployment-host enforcement, long-history and native x86-64 acceptance are deferred.

## Run a comparison

Use two isolated applications with fresh state and the same read-only fixture mount. Set `GOOSEBERRY_BENCH_CANDIDATE_TOKEN` and `GOOSEBERRY_BENCH_REFERENCE_TOKEN` to their synthetic login tokens in the private environment.

From `gooseberry/`:

```bash
go run ./tests/performance -prepare /tmp/gooseberry-fixtures
# Mount that directory at /projects/benchmark in both applications.
go run ./tests/performance \
  -candidate http://127.0.0.1:7312 -candidate-id '<revision or image digest>' \
  -reference http://127.0.0.1:7313 -reference-id '<revision or image digest>' \
  -fixtures /tmp/gooseberry-fixtures -project /projects/benchmark \
  -host '<host, CPU/RAM limits, images, Go/Bun versions, GOGC, browser load>' \
  > performance.jsonl
```

The probe alternates five rounds, validates payloads outside timers and retains every sample. It fails on request errors, unexpected project/file contents or a median round-p95 more than 5% above the reference. RPC timing includes encoding, response decoding and the replay ACK; eight-client throughput includes connections and validation. Run identical idle-browser and active-Chromium sets, recording the browser workload with the host details. Keep both applications' limits and storage equivalent.

Use `-unauthenticated` only for an explicitly labelled legacy comparison. The probe checks the requested authentication mode. It does not measure startup, RSS, browser rendering or deployment isolation. Keep full result files with the exact build identities; do not compare a new fixture or timing method directly with the table below.

## Reference measurements

30 August 2026: native arm64 Apple container, four CPUs, 3 GiB, isolated timing window. Go 1.27.0 uses `CGO_ENABLED=0`, stripped binaries and `GOGC=200`.

This measures the combined-runtime optimization build with authentication disabled. It is not current two-image or deployment-host acceptance. Chromium and model inference are excluded. Source revisions were not recorded for the dirty builds, so this table is diagnostic evidence rather than a reproducible release gate.

Five rounds rotate backend order: 60 warmed PNG transfers, 500 project lists, 300 one-MiB reads, then eight clients × 100 requests. The text fixture includes one extra newline byte; the PNG is 787,362 bytes. Content/hash validation is outside timers. Values are medians of round-level p95.

| Workload | Previous Go | Optimized Go | Bun 1.3.14 reference | Go/reference |
| --- | ---: | ---: | ---: | ---: |
| Project list | 0.170 ms | 0.171 ms | 0.164 ms | +4.27% |
| One-MiB file | 6.319 ms | 6.689 ms | 6.640 ms | +0.74% |
| PNG | 1.443 ms | 1.436 ms | 1.822 ms | −21.19% |

| Metric | Optimized Go | Bun reference |
| --- | ---: | ---: |
| Eight-client throughput | 43,945 requests/s | 36,663 requests/s |
| Loaded / idle RSS | 20.23 / 8.73 MiB | 138.61 / 84.12 MiB |
| Listener startup | 3.38 ms | 182.17 ms |

This set passes the p95 limit; other comparable sets show project-list p95 5.65–6.56% above the reference. Variation prevents a repeatable end-to-end improvement claim over the previous Go build.

## Focused checks

Nonblocking regular-file opens preserve path, size and backup checks while avoiding FIFO hangs. Three five-second runs give median project-JSON reads of 2.29 µs and project lists of 4.53 µs, with unchanged allocations.

Inactive-history accounting caches encoded sizes and invalidates them on operations/notifications. Rechecking six unchanged one-MiB histories takes 0.26–0.29 µs and 720 allocated bytes. Changed histories still require serialization; regression tests cover late growth beyond the eight-MiB budget.

Browser history opens on the newest page and loads older pages on demand. Pages target at most 100 normalized messages and two MiB, then extend to a user-round boundary so tools and activity remain together. An unusually large round can exceed the byte target. The newest snapshot stays linearized with live events until its response is queued; older immutable pages copy under the session lock and encode after release, keeping their serialization out of the streaming path.

Deployment-host acceptance remains deferred. Its scope is recorded in the [roadmap](roadmap.md#deferred); see [development](development.md) for the comparison method.
