# Gooseberry

Gooseberry is a focused Web UI for Goose.

Read these files before changing the product:

1. `README.md` defines the product surface.
2. `docs/architecture.md` defines process, source and state boundaries.
3. `docs/acp.md` defines the Goose and ACP contract.
4. `docs/security.md` defines authority and credential boundaries.
5. `docs/deployment.md` defines host Goose and container deployment.
6. `docs/development.md` defines verification and performance checks.
7. `docs/roadmap.md` contains candidate future improvements.

Product and engineering documentation belongs under `docs/`. Runtime prompt text may remain beside the small integration that owns it.

Keep documentation short and present-tense: describe the product and direct setup. Give each fact one home and link to it. Omit migration narratives and historical negatives; put proposed work in `docs/roadmap.md`.

## Maintenance priority

Preserve the focused current baseline. Keep features, dependencies, tests, protocol methods, state, and documents aligned with it. Prefer a focused vertical slice over a generic workbench. Record accepted future improvements in `docs/roadmap.md`.

## Goose boundary

- Use an official upstream Goose release installed and managed by the user. `gooseberry/tests/goose/upstream.json` records the supported release and official artifact identities.
- Do not fork or rebuild Goose, package an installer or systemd unit, or add an automatic updater. Optional service configuration belongs in documentation, not a setup script.
- Keep Goose authoritative for sessions, history, providers, models, tools, compaction, permissions, recipes, and scheduler state.
- Do not build competing provider, model, credential, session, usage, or tool registries.
- Use the Goose ACP service boundary and small Gooseberry adapters rather than forking Goose.

## Product boundary

- A project has exactly one admitted directory root. It may contain zero, one, or several Git repositories.
- Group persistent Goose sessions by project, not by one required Git repository or worktree.
- Keep Git observational in the UI: discovery, branch/HEAD, status, changed files, and readable diffs. Agents change Git through Goose tools.
- Keep a bounded read-only file tree and Shiki source preview. Do not add editing, Monaco, LSP, debugger, or collaborative IDE behavior.
- Keep goals/tasks, custom agents and summon, multi-image turns, bounded browser QA, web access, optional Signet, and Goose provider configuration.
- Keep the Web UI focused. Do not add a TUI or Web UI terminal.

## Runtime boundaries

- Goose runs on the host as the user's authenticated loopback service. Two host-networked containers run separate application and browser executables from one Go module.
- Objective updates use session-scoped MCP on the application listener. Browser tools and essential instructions use MCP on the browser listener; its HTTP command and artifact routes remain available. Both MCP endpoints can serve trusted external host-network services.
- The user registers the remote browser extension in private Goose configuration. Do not install host skills or put secrets in model-visible instructions.
- The browser has its own state mount, without project, application-state or Goose-configuration mounts. Its sessions still share one UID and filesystem; host networking is not network isolation.

## Engineering approach

- Keep the documented behavior intact. Add an abstraction only when retained behavior requires it.
- Keep frontend contracts as small as the documented surface permits.
- Classify dormant protocol methods and UI hooks before changing them. Wire retained functionality; do not remove it merely as cleanup.
- Keep final Docker images non-root and read-only, with no source, tests, compilers, caches or unused native runtimes. The application is assembled without a shell or package manager; the browser retains the slim runtime Chromium needs.

## Source naming

- Source directories and source, test, component, and script filenames use lowercase kebab-case.
- Conventional lowercase entry and barrel names such as `index.ts`, `main.tsx`, and `vite.config.ts` remain unchanged. React components, types, and exports may use PascalCase inside files.
- Go files use conventional lowercase names, including underscores and the required `_test.go` suffix.
- `bun run check:filenames` enforces this convention across the application.

## Verification

- Run the narrowest relevant check during development.
- Keep all tests under `gooseberry/tests/`.
- Add small regression tests for observable contracts and realistic failure modes at persistence, concurrency, authorization, protocol, filesystem, performance and fragile UI boundaries.
- Do not test copied types, constants, trivial forwarding or implementation details.
- Use broader integration/image checks for changes crossing Goose, browser, or persistence boundaries.
- Before committing, review stale imports, protocol fields, scripts, documentation, generated files, and dependency-lock entries.

## Git history

- Keep changes in separate, coherent commits. Do not squash or amend commits, or rewrite existing history, unless the user explicitly asks.
- Write outcome-specific imperative subjects. Avoid vague `update`, `cleanup`, or `fixes` subjects and commits that mix unrelated work.
- Use the canonical identity `Miłosz Kolber <143708325+miloszkolber@users.noreply.github.com>`.

## Current stack

The controller and browser packages share one Go module, with separate executables and images. The frontend uses TypeScript, React, Zustand, and Vite, with Bun as a build/test tool only. The controller uses the pinned Coder ACP SDK and WebSocket library. Treat these as current implementation choices, not permanent product scope.
