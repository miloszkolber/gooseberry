# Gooseberry

Gooseberry is a focused Web UI for Goose.

Read these files before changing the product:

1. `docs/baseline.md` is the canonical current product definition.
2. `docs/architecture.md` defines the intended boundaries.
3. `docs/integration.md` defines the Goose service boundary.
4. `docs/acp.md` records the current ACP projection.
5. `docs/goose.md` documents Goose integration and Gooseberry additions.
6. `docs/models.md` defines provider and model projection.
7. `docs/security.md` defines authority and credential boundaries.
8. `docs/deployment.md` defines host Goose and Compose deployment.
9. `docs/roadmap.md` contains candidate future improvements.

Product and engineering documentation belongs under `docs/`. Runtime prompt text may remain beside the small integration that owns it.

## Maintenance priority

Preserve the focused current baseline. Keep features, dependencies, tests, protocol methods, state, and documents aligned with it. Prefer a focused vertical slice over a generic workbench. Record accepted future improvements in `docs/roadmap.md`.

## Goose boundary

- Run the pinned upstream Goose distribution at `/usr/local/bin/goose`; `goose/version` and `goose/source-commit` own the release and source identity. Keep upstream Rust runtime code unchanged.
- Permit only the exact generated `Cargo.lock` correction checked by `goose/source-policy.sh` and documented in `docs/goose.md`. Record it in provenance, preserve third-party dependency entries and build with `--locked`; unexpected source or lockfile changes must fail verification, not broaden the exception.
- Keep Goose authoritative for sessions, history, providers, models, tools, compaction, permissions, recipes, and scheduler state.
- Do not build competing provider, model, credential, session, usage, or tool registries.
- Use the Goose ACP service boundary and small Gooseberry adapters rather than forking Goose.

## Product boundary

- A project is one or more admitted directory roots. It may contain zero, one, or several Git repositories.
- Group persistent Goose sessions by project, not by one required Git repository or worktree.
- Keep Git observational in the UI: discovery, branch/HEAD, status, changed files, and readable diffs. Agents change Git through Goose tools.
- Keep a bounded read-only file tree and Shiki source preview. Do not add editing, Monaco, LSP, debugger, or collaborative IDE behavior.
- Keep goals/tasks, custom agents and summon, multi-image turns, bounded browser QA, web access, optional Signet, and Goose provider configuration.
- Keep the Web UI focused. Do not add a TUI or Web UI terminal.

## Runtime boundaries

- Goose runs as a host user service on loopback. One host-networked Gooseberry container runs one Go executable with application and browser HTTP listeners.
- Objective updates use MCP on the application listener. Browser automation uses a lazy skill and the browser HTTP listener. Both remain accessible to trusted external host-network services.
- Browser subprocess environments are filtered, but the browser shares the container filesystem. Do not describe this as separate-container filesystem isolation.

## Engineering approach

- Keep only behavior required by the baseline. Add an abstraction only when retained behavior requires it.
- Keep browser-host contracts as small as the baseline permits.
- Remove dead protocol methods, state, dependencies, generated assets, and tests with their feature.
- Keep final Docker images non-root, read-only, multi-stage, and free of source, tests, compilers, caches, and unused native runtimes.

## Source naming

- Source directories and source, test, component, and script filenames use lowercase kebab-case.
- Conventional lowercase entry and barrel names such as `index.ts`, `main.tsx`, and `vite.config.ts` remain unchanged. React components, types, and exports may use PascalCase inside files.
- Go files use conventional lowercase names, including underscores and the required `_test.go` suffix.
- `bun run check:filenames` enforces this convention across the application.

## Verification

- Run the narrowest relevant check during development.
- Test observable retained behavior and meaningful security/failure boundaries.
- Use broader integration/image checks for changes crossing Goose, browser, or persistence boundaries.
- Before committing, review stale imports, protocol fields, scripts, documentation, generated files, and dependency-lock entries.

## Current stack

The controller and browser packages share one Go module and executable. The frontend uses TypeScript, React, Zustand, and Vite, with Bun as a build/test tool only. The controller uses the pinned Coder ACP SDK and WebSocket library. Treat these as current implementation choices, not permanent product scope.
