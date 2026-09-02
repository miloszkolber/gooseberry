# Development

Use the Go and Bun versions pinned in `Dockerfile`, `go.mod` and `package.json`. Prefer disposable containers for tooling.

## Checks

```bash
cd gooseberry
bun install --frozen-lockfile
bun run check:deps
bun run lint
bun run typecheck
bun run test
bun run build
go test -race ./...
go vet ./...
```

TypeScript tests live in `tests/contracts` and `tests/webui`; Go package tests stay beside their code. Bun's hoisted dependencies serve the shared tests, and typechecking includes `tests/tsconfig.json`. The build produces both executables, static assets and the bundle-budget check.

Add focused regressions for brittle boundaries:

- Reconnect/replay, stale notifications, concurrent chats and slow clients.
- Interrupted persistence, backups, read limits, symlinks and multiple roots.
- Session ownership, single-use permissions/questions and secret handling.
- Browser authentication, cancellation, cleanup and quotas.
- Stale UI reads, tab closure, streaming, keyboard focus and narrow layouts.

Use temporary state and synthetic credentials. Run race tests for concurrent state or lifecycle changes. Visual acceptance requires actual interactions and screenshots.

Run the browser gate from the repository root. It uses a disposable image, a synthetic ACP agent and the browser service's Chromium package layer:

```bash
docker build -f gooseberry/Dockerfile --target ui-acceptance -t gooseberry-ui-acceptance .
docker run --rm --network none --shm-size 256m gooseberry-ui-acceptance
```

The gate covers commit selection, source/image previews, streaming tab recovery, reconnect, dialog focus and narrow-screen overflow. Mount `/artifacts` when you want to keep its screenshots.

## Goose compatibility

Against an isolated Goose service:

```bash
go run ./tests/goose -url ws://127.0.0.1:3284/acp
```

Set `GOOSE_SERVER__SECRET_KEY` in the probe's private environment. It checks authentication, selected session/provider/settings responses and reconnect persistence, including a preference write. Keep it away from live user state.

Optional `-source /path/to/upstream` checks method registrations. Runtime probes do not establish every provider, tool or extension's compatibility; see [ACP coverage](acp.md).

## Images

From the repository root:

```bash
docker build -f gooseberry/Dockerfile --target gooseberry -t gooseberry:local .
docker build -f gooseberry/Dockerfile --target browser -t gooseberry-browser:local .
sh gooseberry/tests/deployment/compose.test.sh
```

The Compose fixture requires Docker Compose and `jq`; it checks configuration, not running services. Apple `container` supports isolated Linux checks on macOS but does not establish Compose host-network behavior.

For packaging changes, check both architectures, state/environment isolation, non-root/read-only operation, licenses, health and shutdown. Exercise authenticated MCP, HTTP commands and a Chromium screenshot through the application artifact proxy.

## Performance

The initial JavaScript budget is **500,000 raw bytes**, including eager imports. Keep large views/grammars lazy and transcript lists virtualized.

The controller comparison target is no more than **5%** above the reference workload. Deployment-host enforcement is deferred. The opt-in [comparison probe](performance.md#run-a-comparison) measures project lists, one-MiB files, images and concurrent clients. Keep authorization, replay and I/O limits intact.

[Performance](performance.md) owns measurements and targets. `GOGC=200` trades memory for fewer collections; measure before changing it.
