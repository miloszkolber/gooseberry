# Development

Use the Go and Bun versions pinned by `Dockerfile`, `go.mod` and `package.json`. Disposable containers are preferred for extra tooling.

## Checks

```bash
cd gooseberry
bun install --frozen-lockfile
bun run mewa:check
bun run check:deps
bun run lint
bun run typecheck
bun run test
bun run build
go test -race ./...
go vet ./...
```

All tests live under `gooseberry/tests`. Add small regression tests for observable contracts and realistic failure modes at persistence, concurrency, authorization, protocol, filesystem, performance and fragile UI boundaries. Do not test copied types, constants or implementation details.

The MCP host is covered by `go test ./internal/mcphost`, the controller MCP gateway tests under `tests/go/controller`, and the default Compose assertions in `tests/deployment/compose.test.sh`. Its cross-compiled executable is built with `GOOS=linux GOARCH=amd64 go build ./cmd/gooseberry-mcp` when the host platform cannot run the Linux service image.

The frontend is Svelte 5 compiled directly by Bun. `bun run dev:web` builds the same application entry used in production, validates each staged artifact before publication and serves it with the same-origin Go UI fixture; this supported development path runs on Linux. Source and contract changes trigger rebuilds and browser reloads. Bun owns module compilation, splitting and reload publication, while the fixture owns the same-origin HTTP and WebSocket path.

Mewa UI is not installed from npm. [`mewa.lock.json`](../gooseberry/webui/vendor/mewa.lock.json) records the release URLs, archive identities and selected icons. `bun run mewa:check` is offline and runs during every Web UI build. To restore or deliberately update the vendor trees after editing the lock, run `bun --filter @gooseberry/web mewa:sync`; the command downloads only those GitHub Release assets, verifies them, and replaces the existing vendor directory only after the staged copy passes.

Use temporary state and synthetic credentials. Run race tests for concurrent state or lifecycle changes. Visual acceptance requires real interactions and screenshots, not only component rendering.

## Browser acceptance

From the repository root:

```bash
docker build -f gooseberry/Dockerfile --target ui-acceptance -t gooseberry-ui-acceptance .
docker run --rm --network none --shm-size 256m gooseberry-ui-acceptance
```

The gate covers commit selection, source and image previews, streaming tab recovery, reconnects, dialog focus and narrow-screen overflow. Mount `/artifacts` to retain screenshots.

## Goose compatibility

Run the probe against isolated Goose state, never live user state:

```bash
go run ./tests/goose -url ws://127.0.0.1:3284/acp
```

Set `GOOSE_SERVER__SECRET_KEY` in the probe's private environment. The optional `-source /path/to/upstream` mode checks method registration and the session-extension identity shapes Gooseberry depends on. Runtime probes cover selected authentication, session, provider, setting and reconnect paths; they do not prove every provider or extension.

## Images

```bash
docker build -f gooseberry/Dockerfile --target gooseberry -t gooseberry:local .
docker build -f gooseberry/Dockerfile --target mcp -t gooseberry-mcp:local .
sh gooseberry/tests/deployment/compose.test.sh
```

The application build verifies every Git command used by Gooseberry against its assembled runtime. That final image has no shell or package manager. The MCP image keeps Debian Trixie slim, Chromium, required fonts and `tini` for its embedded Browser module. All production services run non-root with read-only filesystems, dropped capabilities and bounded writable mounts.

Check both architectures after packaging changes. Exercise state and environment isolation, licenses, health, shutdown, authenticated MCP/HTTP and a Chromium screenshot through the application artifact proxy. Apple `container` is useful for disposable Linux image checks on macOS; it does not reproduce Docker Compose host-network semantics.

## Performance

The initial JavaScript budget is **500,000 raw bytes**, including eager imports. Every production build measures and enforces the current output. Every Web UI build gives JavaScript and CSS larger than 1 KiB a verified gzip companion, so development and production use one artifact-integrity contract; the Go static handler negotiates those files without adding a proxy or runtime package. Keep heavy grammars and optional interactive App support out of the initial path, and preserve bounded transcript rendering.

The controller target is a median round-p95 no more than **5% above the reference workload**. Prepare a fixture once, mount it read-only into two isolated applications and compare exact builds:

```bash
go run ./tests/performance -prepare /tmp/gooseberry-fixtures
go run ./tests/performance \
  -candidate http://127.0.0.1:7312 -candidate-id '<revision or image digest>' \
  -reference http://127.0.0.1:7313 -reference-id '<revision or image digest>' \
  -fixtures /tmp/gooseberry-fixtures -project /projects/benchmark \
  -host '<host, limits, images, toolchains, GOGC and browser load>' \
  > performance.jsonl
```

Set the candidate and reference tokens in the private environment. The probe alternates five rounds and validates project lists, one-MiB files, images and eight-client throughput outside the timers. Keep authentication, limits, storage and browser load identical. Deployment-host enforcement, long-history acceptance and native x86-64 browser checks remain [deferred](roadmap.md#deferred).

`GOGC=200` reduces collection frequency in the application image. Measure latency and memory before changing it.
