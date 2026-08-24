---
id: module-browser-e2e
type: module-design
status: active
title: Browser E2E harness
parent: architecture
depends-on: [module-server, module-web, module-cli]
references: [module-ci-release]
tags: [testing, playwright, e2e]
---

## Responsibility

The real-browser system gate for Mewa Code's host/UI integration: build the shipped web client, boot an
isolated host, seed real git and persistence fixtures, drive Chromium through the wire, and clean up every
machine-global resource it used. The default suite excludes provider-backed `@agent` tests, which remain
explicit, authenticated, and on demand.

## Execution model

`bun run e2e` is the complete no-agent gate. It builds the web bundle once and runs machine-adaptive,
process-level Playwright shards. A shard owns one host and one Playwright worker. Serial execution inside
that lane preserves destructive reset semantics, while lane-qualified state and ports make lanes
independent. Reports merge into one normal result and `--last-failed` remains a valid serial repair loop.

The automatic count is half the available CPU parallelism, clamped to 1–8. Developers may explicitly select
1–16 lanes. `e2e:serial` is the stable debugging fallback. A focused invocation defaults to one lane unless
its shard count is explicit. Browser modifier tests use the page's browser-reported platform rather than the
runner host so emulated branches exercise the correct product behavior.

Provider-backed browser tests (`e2e:agent`) and the headless workflow suite are not parallelized by this
runner. Concurrent provider turns alter rate limits, cost, and determinism. The compiled-binary suite is a
distinct artifact gate and runs in its own namespace.

## Isolation contract

Every concurrent lane derives a distinct data dir, HOME, PI agent dir, fixture repository, binary cache,
restart artifacts, picker/editor/provider control files, and host/restart/binary ports. Port allocation is
stable and collision-safe across worktrees. Different worktrees may run concurrently, while two complete
invocations in one worktree remain sequential. No path may fall back to `~/.mewa-code`, the developer's home,
config trees, or the real PI agent dir. A sandboxed home is handed to the host as both `HOME` and
`USERPROFILE`, because Pi's Windows home resolution reads `USERPROFILE`.

## Boundary

- **Owns:** browser scenarios and fixtures under `e2e/`, their Playwright configuration and runner
  entrypoints, isolation and port-allocation rules, report orchestration, and the public `e2e*` commands.
- **Consumes:** the built web artifact, the host's public boot/wire behavior, sanctioned server test-fixture
  exports, git, Chromium, and Playwright.
- **Forbidden:** fake application backends, provider fakes in production boot paths, browser imports into
  product modules, tests depending on developer state, or parallel workers sharing one mutable host.

## Verification policy

During iteration, run affected specs and use Playwright's last-failed mode. Flake repairs replace expensive
setup with equivalent fixture state and wait for observable readiness. Blanket retries, arbitrary sleeps, and
assertion weakening are not synchronization policy. Before handoff, every app-affecting change runs the
complete `bun run e2e` no-agent gate. Binary-only regressions remain covered by `e2e:binary` against the
compiled host, with default and custom PI agent directories. Real agent behavior remains covered by selected
`@agent` suites rather than a fake agent.
