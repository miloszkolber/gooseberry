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

The MCP host is covered by `go test ./tests/go/mcphost`, the controller MCP gateway tests under `tests/go/controller`, and the default Compose assertions in `tests/deployment/compose.test.sh`. Its cross-compiled executable is built with `GOOS=linux GOARCH=amd64 go build ./cmd/gooseberry-mcp` when the host platform cannot run the Linux service image. See the [module checklist](mcp.md#add-a-module) when extending the host.

The frontend is Svelte 5 compiled directly by Bun. `bun run dev:web` builds the same application entry used in production, validates each staged artifact before publication and serves it with the same-origin Go UI fixture; this supported development path runs on Linux. Source and contract changes trigger rebuilds and browser reloads. Bun owns module compilation, splitting and reload publication, while the fixture owns the same-origin HTTP and WebSocket path.

Mewa UI is not installed from npm. [`mewa.lock.json`](../gooseberry/webui/vendor/mewa.lock.json) records the release URLs, archive identities and selected icons. `bun run mewa:check` is offline and runs during every Web UI build. To restore or deliberately update the vendor trees after editing the lock, run `bun --filter @gooseberry/web mewa:sync`; the command downloads only those GitHub Release assets, verifies them, and replaces the existing vendor directory only after the staged copy passes.

Use temporary state and synthetic credentials. Run race tests for concurrent state or lifecycle changes. Visual acceptance requires real interactions and screenshots, not only component rendering.

## Browser acceptance

From the repository root:

```bash
docker build -f gooseberry/Dockerfile --target ui-acceptance -t gooseberry-ui-acceptance .
docker run --rm --network none --shm-size 256m gooseberry-ui-acceptance
```

The gate covers commit selection, source and image previews, streaming tab recovery, reconnects, arbitrary ACP selector IDs, dialog focus and narrow-screen overflow. A second Goose-shaped fixture checks provider configuration semantics, settings drafts, failed credential/prompt/permission replies, attachment retention, IME Enter, and inner-panel geometry at 320, 390, 768, 1024 and 1440 pixels in both themes. Mount `/artifacts` to retain screenshots.

The Browser Go suite checks controller-panel lease expiry, renewal, rejected adoption, command/cleanup races, restart recovery and failed-close retries. For an isolated real Chromium check, compile its test binary in the Linux build environment and run it inside the Browser automation image:

```bash
go test -c -o /out/browser-tests ./tests/go/browser
# Inside the disposable Browser runtime, with the binary mounted at /checks:
GOOSEBERRY_TEST_AGENT_BROWSER=/usr/local/bin/agent-browser \
GOOSEBERRY_TEST_BROWSER_CONFIG=/app/config.json \
  /checks/browser-tests -test.run '^TestRealBrowserPanelLeaseLifecycle$' -test.v
```

This opt-in test uses temporary state, a synthetic local page and a shortened lease. It verifies actual navigation, screenshot delivery, leased-panel cleanup and an unrelated browser session remaining usable. It skips when the executable environment variable is absent. It does not use Goose state or provider credentials.

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

The initial JavaScript budget is **500,000 raw bytes**, including eager imports. Every production build measures and enforces the current output. Every Web UI build gives JavaScript and CSS larger than 1 KiB a verified gzip companion, so development and production use one artifact-integrity contract; the Go static handler negotiates those files without adding a proxy or runtime package. Keep heavy grammars and optional interactive App support out of the initial path, and retain paged transcript loading. `content-visibility` skips offscreen layout/paint; it is not DOM virtualization or a cap on active transcript memory.

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

Measure projection CPU separately from browser rendering with:

```bash
bun --tsconfig-override tests/tsconfig.json tests/performance/transcript.ts
```

This opt-in synthetic probe reports hydration, incremental text plus row derivation, and heap allocation at 100, 1,000 and 10,000 messages. It does not measure browser paint, native keyboard behavior or deployment RSS. Keep those distinctions when recording performance results.

The `ui-acceptance` image also contains an opt-in Chromium history probe:

```bash
docker build -f gooseberry/Dockerfile --target ui-acceptance -t gooseberry-ui:local .
docker run --rm -e GOOSEBERRY_UI_HISTORY_ROUNDS=1000 \
  -v "$PWD/history-artifacts:/artifacts" gooseberry-ui:local sh /app/run-history-measurement
```

Each round contains a prompt and a formatted answer; the fixture adds its regular final round. After initial fonts, Markdown and visible code settle, the probe loads every older page through the UI, records retained rows/elements and Chromium heap estimates, requires anchor drift within 2 pixels, and traverses the transcript while observing frame intervals and long tasks. It also checks native find, code selection across scrolling, historical link focus, jump-control focus and final-message visibility, transcript announcement policy and retained row identity. Set `GOOSEBERRY_UI_HISTORY_ROUNDS` from 1 to 5,000 and optionally `HISTORY_VIEWPORT_WIDTH`/`HISTORY_VIEWPORT_HEIGHT`. Reduced motion is the default; set `HISTORY_REDUCED_MOTION=false` to check normal scrolling, and retain the measured preference from the result. Results and a screenshot are written to `/artifacts`. These are synthetic paging/frame measurements and coarse heap estimates, not chunk-to-paint traces, peak memory, native-device acceptance or deployment-host performance limits.

History replay is unpaced by default so the browser probe also exercises burst replay through the bounded ACP adapter. `GOOSEBERRY_UI_HISTORY_INTERVAL_MS` optionally adds 0–100 ms per round for controlled load comparisons. The Go race suite separately verifies 10,000 mixed notifications, ordered completion, request-handler callbacks, pretty-printed WebSocket JSON and cancellation while notification processing is stalled.
