# Performance

## Budgets

- Initial JavaScript: **500,000 raw bytes**, including eager imports.
- Controller p95: at most **5% above the reference workload**.
- Deployment-host, long-history and native x86-64 acceptance remain open.

## Reference measurements

30 August 2026: native arm64 Apple container, four CPUs, 3 GiB, isolated timing window. Go 1.27.0 uses `CGO_ENABLED=0`, stripped binaries and `GOGC=200`.

This measures the combined-runtime optimization build. It is not current two-image or deployment-host acceptance. Chromium and model inference are excluded.

Five rounds rotate backend order: 500 project lists, 300 one-MiB reads, 60 warmed PNG transfers, then eight clients × 100 requests. Content/hash validation is outside timers. Values are medians of round-level p95.

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

Repeat end-to-end checks on the deployment host with browser activity. Measure reconnect-to-interactive time, streaming and long histories separately. See [development](development.md) for methodology.
