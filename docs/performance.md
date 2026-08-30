# Performance

Measurements from 30 August 2026 use a native arm64 Apple container with four CPUs and 3 GiB of memory. No other verification containers ran during the timed comparisons. They cover the combined-runtime optimization build, not the separate application/browser images or the deployment host.

## File reads

Profiling project listing found repeated blocking-mode changes in Go's regular-file opening path. Opening with the nonblocking flag avoids those changes and prevents a path replaced by a named pipe from blocking before its descriptor is checked. Regular-file, size, fresh-path and backup checks remain in place.

Three five-second microbenchmark runs gave these median results:

| Operation | Before | After |
| --- | ---: | ---: |
| Read bounded project JSON | 3.06 µs | 2.29 µs |
| List projects, including path validation | 5.38 µs | 4.53 µs |

Allocations are unchanged. These timings measure controller work, not browser-perceived latency. Nonblocking mode does not make regular-file disk I/O asynchronous; see the [Linux open documentation](https://man7.org/linux/man-pages/man2/open.2.html).

## Inactive history

Eviction used to serialize every eligible closed chat whenever a session operation released its reference. Six unchanged one-MiB histories took 4.57–4.66 ms per sweep and allocated about 6.34 MB while holding the session lock.

The controller now caches the encoded byte count of unchanged inactive transcripts. Operations and incoming notifications invalidate that count. The same repeated-sweep fixture takes 0.26–0.29 µs and allocates 720 bytes. A changed transcript still needs measuring; this does not make its first serialization free. A regression test checks both reuse and eviction after a late tool update grows the transcript past the unchanged eight-MiB budget.

## End-to-end comparison

The release-equivalent comparison uses Go 1.27.0, `CGO_ENABLED=0`, stripped release binaries and `GOGC=200`. All three backends run separately in the same non-root, read-only runtime container. The Bun 1.3.14 backend is the retained pre-migration reference, not a runtime dependency.

Each backend runs five rounds, rotating execution order. Each round includes 500 project-list requests, 300 one-MiB file requests, 60 PNG transfers after warmup, and eight concurrent clients making 100 requests each. File contents and PNG hashes are checked outside the latency timer. The table reports the median of the five round-level p95 values.

| Workload | Previous Go image | Optimized Go | Bun reference | Optimized Go versus Bun |
| --- | ---: | ---: | ---: | ---: |
| Project list | 0.170 ms | 0.171 ms | 0.164 ms | +4.27% |
| One-MiB file | 6.319 ms | 6.689 ms | 6.640 ms | +0.74% |
| PNG over HTTP | 1.443 ms | 1.436 ms | 1.822 ms | −21.19% |

The optimized Go build handled about 43,945 requests/second in the eight-client workload, compared with 36,663 for Bun. Median loaded RSS was 20.23 MiB versus 138.61 MiB; idle RSS was 8.73 MiB versus 84.12 MiB. Median listener startup was 3.38 ms versus 182.17 ms. The browser listener was idle; Chromium startup and model inference are not included.

The optimized Go results pass the existing 5% limit against Bun in this comparison. They do not establish a repeatable end-to-end improvement over the previous Go image: individual rounds varied substantially, and the median file-read time was higher. In two earlier release comparisons, project-list p95 was 5.65–6.56% higher than Bun, outside the 5% limit. A development build with CGO enabled also missed it; that build does not match the image and is not release evidence. These are optimization-comparison timings, not acceptance results for the current images.

## Still to verify

- Repeat the same comparison on a quiet deployment host, including concurrent Chromium activity. Do not widen the 5% limit or select only favorable rounds.
- Measure long histories, reconnect-to-interactive time and streaming updates in the frontend. A backend benchmark does not cover those interactions.
- Run native x86-64 measurements. Emulated functional checks do not establish native performance.
