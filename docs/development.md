# Development

The application lives in `gooseberry/`. Keep code with the responsibility it serves, give state one owner and preserve behavior when moving it. [Architecture](architecture.md) describes the layout; [ACP coverage](acp.md) lists the integration surface.

## Checks

Use the Go and Bun versions selected in `Dockerfile`, `go.mod` and `package.json`. Dependencies are recorded in `bun.lock` and `go.sum`.

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

Run the relevant test first during development. The complete commands check contracts, frontend and Go code; the production build also checks generated styles and the JavaScript budget.

TypeScript tests live under `gooseberry/tests/contracts` and `gooseberry/tests/webui`, grouped by the code they exercise. `bunfig.toml` uses hoisted dependency resolution so these tests share the application dependencies without a separate test package; `bun run typecheck` includes `tests/tsconfig.json`. Go tests stay beside their packages so they can test private behavior without adding exports or a custom runner. Goose distribution tests stay in `goose/tests`.

From the repository root, deployment changes also need:

```bash
sh gooseberry/tests/deployment/setup-deployment.test.sh
sh goose/tests/install-goose.test.sh
```

These shell fixtures run on Linux and macOS. The deployed service requires Linux. Apple `container` can run disposable build/test environments on macOS, but an OCI run alone does not verify Docker Compose host networking.

## What to test

Prefer a regression case in an existing test over a second framework or broad snapshot suite.

| Area | Important cases |
| --- | --- |
| ACP and reconnects | Notification order, old connection events, duplicate retries, missing acknowledgements, concurrent chats and slow readers. |
| Persistence and paths | Corrupt/interrupted writes, backup recovery, file limits, same-size changes, moved symlinks and multiple roots. |
| Objectives and permissions | Session authentication, ownership, single-use replies, cancellation and concurrent updates. |
| Goose settings | Exact method parameters, hidden secrets, cancelled login, agent source IDs and recipe scans. |
| Browser use | Allowed commands, authentication, cancellation, process cleanup and output/state/artifact limits. |
| UI state | Welcome snapshots, stale async results, subscription cleanup, streaming immutability, focus and responsive navigation. |

Use the race detector for session, reconnect and process-lifecycle changes. Integration checks should use temporary state and synthetic credentials. Tests that call real providers or execute tools need a deliberately chosen environment.

## Images

Build from the repository root:

```bash
docker build -f gooseberry/Dockerfile -t gooseberry:local .
```

The root `.dockerignore` limits the build context. Legal notices come from the repository root. The Dockerfile uses Debian Trixie for the runtime, native-platform build stages and Go cross-compilation for the target architecture. Bun builds static frontend files; no build runtime is included in the final image.

For packaging changes, check both architectures, non-root execution, read-only mounts, licenses and the absence of source/build tools. Exercise both listeners, Goose-unavailable readiness, listener failure and normal shutdown. Test external authenticated MCP and an actual Chromium interaction with a decodable screenshot that survives the artifact proxy unchanged.

## Performance

The initial JavaScript budget is **500,000 raw bytes**. The bundle check follows Vite's manifest, including eager imports. Large views and language grammars should load on demand. Keep virtualization and avoid making the workspace subscribe to every transcript chunk.

Controller p95 must not regress by more than **5%** against the comparison workload. Measure project listing, one-MiB file reads, image delivery and concurrent clients using identical inputs and authentication. Warm both builds, alternate their order, retain per-round results and check response contents outside the timer. Authorization, recovery, replay and I/O limits are not optional performance costs.

The [performance notes](performance.md) record measured improvements, comparison results and remaining acceptance work. Local results do not establish deployment-host latency; throughput improvements do not waive the p95 limit.

The controller reuses decoded project metadata only when freshly read bytes match, avoids duplicate work within a request and retains encoded replay responses without copying them. Path checks remain fresh. `GOGC=200` trades some memory for less collection work; change it only after measuring.

## UI and changes

For UI changes, exercise desktop and narrow layouts with deterministic project/session data. Check panes, images, source previews, long histories, streaming, errors, permissions, questions, keyboard focus and scrolling. Screenshots and interaction checks are still needed; matching markup or passing unit tests does not prove visual behavior.

Use lowercase kebab-case for TypeScript paths and conventional Go filenames. Keep browser types small and explicit. Keep accessibility, virtualization and highlighting in their existing libraries.

Before submitting, check related imports, protocol fields, generated files, locks, `docker-compose.yaml`, workflows and docs. Future work belongs in [roadmap](roadmap.md). [Goose distribution](goose.md) describes release checks; [deployment](deployment.md) describes user-controlled updates.
