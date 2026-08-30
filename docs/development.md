# Development

Keep changes focused on the [product baseline](baseline.md). Organize code by responsibility, keep one owner for each piece of state and preserve observable behavior. The [architecture](architecture.md) explains package and state boundaries; [ACP coverage](acp.md) defines the Goose projection.

## Build and check

The application workspace is `gooseberry/`. Go and Bun build versions are pinned in its `Dockerfile` and `package.json`; JavaScript dependencies use the frozen `bun.lock`, and Go modules use `go.mod` and `go.sum`.

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

`bun run build` builds the Go executable and the production frontend, including generated style checks and the initial-JavaScript budget. `bun run test` includes the contracts, frontend and both Go packages. Run the affected test file or Go test first while developing; the complete checks belong before integration.

Deployment changes also need the shell fixtures from the repository root:

```bash
sh scripts/setup-deployment.test.sh
sh goose/tests/install-goose.test.sh
```

The shell fixtures run on Linux and macOS; production deployment requires Linux and Docker Engine/Compose host networking. Apple `container` is useful for disposable Linux builds and checks on macOS, but running an OCI image there alone does not validate Linux Docker Compose networking or native x86-64 performance. Avoid installing build dependencies permanently when a disposable pinned-tool image suffices.

## Tests that earn their maintenance

Prefer a small regression in an existing boundary fixture over a parallel test framework or broad snapshots. Important boundaries include:

| Change | Relevant evidence |
| --- | --- |
| ACP, reconnect or replay | Notification ordering, stale connection generations, exactly-once execution identity, lost acknowledgements, concurrent sessions and slow-reader isolation. |
| Persistence or paths | Interrupted/invalid primary writes, last-valid backups, bounded reads, same-size file changes, symlink retargeting and multi-root identity. |
| Objectives and permissions | Session-scoped authentication, project ownership, single-use replies, cancellation and concurrent updates. |
| Goose administration | Exact upstream parameters, secret sanitization, provider-login cancellation, opaque agent IDs and recipe security scans. |
| Browser automation | Command admission, authentication, cancellation, process cleanup, output/artifact/state bounds and byte-exact artifact proxying. |
| Frontend state and interaction | Welcome snapshots, stale async responses, navigation teardown, immutable streaming state, focus-managed dialogs and responsive selection. |

Go fixtures live beside their packages; contract and frontend tests live beside their owners. The race detector is important for reconnect, lifecycle and browser-process changes. Use synthetic credentials and disposable project/state directories for integration runs. Real provider calls, tool execution or permission changes need their own explicit scope.

## Performance gates

The initial frontend JavaScript closure must remain at or below **500,000 raw bytes**. `webui/scripts/check-bundle.ts` follows the production Vite manifest; moving code to another eagerly imported chunk does not evade the budget. Load large surfaces and language grammars on demand, keep virtualization, and avoid subscribing the workspace shell to transcript content.

The controller latency gate is **no p95 regression above 5%** against the accepted comparison workload. Measure project listing, one-MiB file reads and HTTP image delivery separately, and include concurrent clients. Use identical admitted files and authenticated routes, warm both builds, alternate run order and retain per-round results. Verify response contents outside the latency timer. Do not trade path authorization, persistence recovery, replay identity or bounded I/O for a faster score.

The local Linux arm64 sample on 2026-08-30 uses four CPUs, 3 GiB memory, Go 1.25.13 with `GOGC=200`, and a Bun 1.3.14 comparison baseline. Each of five rounds includes 500 project-list requests, 300 one-MiB ASCII reads, 60 PNG transfers and eight concurrent clients making 100 project-list requests each. Two complete comparisons meet the gate. The second run records:

| Operation | Go p95 | Difference from comparison baseline |
| --- | ---: | ---: |
| Project list | 0.147 ms | +0.7% |
| One-MiB text read | 9.722 ms | +3.1% |
| PNG delivery | 2.337 ms | −13.3% |

These are medians of per-round percentiles, not pooled percentiles or production guarantees. The controller-only workload excludes Chromium and model execution; its 22.4 MiB post-workload resident memory is not total application memory. A separate wire fixture covers escaped and UTF-8 text. Target-host validation with representative concurrent browser activity remains necessary.

The implementation avoids repeated decoding of identical freshly read project bytes, duplicate authorization work within a request, and response copies in replay bookkeeping. Root authorization and file bounds remain fresh. `GOGC=200` is the standard Go collection target, trading modestly more controller memory for less collection work; change it only with measurements. There is no custom serializer or memory manager.

## Runtime and visual acceptance

For changes crossing packaging or service boundaries, build the final image for both Linux architectures and inspect its non-root user, read-only root, tmpfs mounts, licenses and absence of build runtimes. Test both HTTP health endpoints with Goose unavailable, failure of either listener, coordinated shutdown and external authenticated objective MCP. Browser automation also needs a real Chromium interaction and a decodable screenshot whose bytes survive the authenticated artifact proxy.

Local combined-runtime evidence covers these boundaries on arm64, including concurrent chats, queues, fork history, synthetic administration and real Chromium. The x86-64 image has an emulated authenticated smoke check, not native performance certification. Synthetic ACP integration and source/markup comparisons do not establish live-provider behavior or visual fidelity.

Fresh frontend visual acceptance remains open. Check desktop and narrow layouts against deterministic project/session fixtures: pane transitions, sidebar refresh, direct images and source previews, long histories, streamed content, loading/error states, permissions, questions, keyboard focus and scrolling. Capture screenshots and exercise the controls; passing unit tests or matching markup alone is insufficient.

## Changes and releases

Use lowercase kebab-case for TypeScript source and directory names; use conventional lowercase Go filenames and `_test.go`. Keep wire projections narrow and explicit. A generated type is useful only when it eliminates genuine duplication without exporting internal Go state or requiring a schema framework. Retain the existing accessibility, virtualization and highlighting libraries.

Before submitting, review imports, protocol fields, generated files, lock entries, Compose, workflows and documentation together. Put proposed directions in [roadmap](roadmap.md), not current-state instructions. See [Goose distribution](goose.md) for scheduled upstream validation and [deployment](deployment.md) for operator-controlled updates.
