# Mewa Code

Mewa Code is a focused Web UI and ACP host for the Pi Coding Agent.

Read these files before changing the product:

1. `docs/product-baseline.md` is the canonical product definition.
2. `docs/architecture.md` defines the intended boundaries.
3. `docs/current-state.md` records implementation reality and remaining conflicts.
4. `docs/implementation-plan.md` defines the ordered rewrite phases.

Product and engineering documentation belongs under `docs/`. Runtime prompt text may remain beside the small extension or loader that owns it.

## Current priority

Simplify the ThinkRail-derived foundation into the baseline. Delete features, dependencies, tests, protocol methods, state, and documents outside the retained product.

Do not preserve code because an inherited abstraction or test describes it. Update or delete that material with its feature. Prefer a focused vertical slice over adapting a generic workbench.

## Pi boundary

- Run Pi in-process through its public SDK.
- Keep Pi authoritative for providers, models, credentials, normal prompts and tools, explicit user settings, retry, compaction, project trust, usage/cost, and canonical JSONL sessions.
- Do not build competing provider, model, credential, session, usage, or tool registries.
- Push Pi softly through small SDK extensions rather than patching its core behavior.
- Keep the complete Pi package family on one exact stable version and automate atomic updates.
- Never bundle provider runtime implementations into the browser client.

## Product boundary

- A project is one or more admitted directory roots. It may contain zero, one, or several Git repositories.
- Group persistent Pi sessions by project, not by one required Git repository or worktree.
- Keep Git observational: discovery, branch/HEAD, status, changed files, and readable diffs. Agents change Git through Bash.
- Keep a bounded read-only file tree and Shiki source preview. Do not add editing, Monaco, LSP, debugger, or collaborative IDE behavior.
- Keep goals/tasks, structured subagents, multi-image turns, Pi-reported usage, isolated browser QA, web access, optional Signet, and provider authentication.
- Keep Web UI and ACP. Do not add a TUI or Web UI terminal.
- Use one bundled monospaced font and a simple system light/dark palette. Do not add theme or skills management UI.

## SSH boundary

- Preserve Pi's public `bash` schema and renderer while executing commands through the host SSH account.
- SSH is infrastructure, not a model-facing tool.
- Do not add SFTP or a generic remote-workspace framework.
- Do not forward provider credentials, controller/browser tokens, or unrelated controller state to remote commands.

## Engineering approach

- Prefer deletion over compatibility for unshipped inherited behavior.
- Add an abstraction only when retained behavior requires it.
- Keep browser-host and ACP contracts as small as the baseline permits.
- Remove dead protocol methods, state, dependencies, generated assets, and tests with their feature.
- Preserve user data formats only when real current users may have that data.
- Keep source comments for non-obvious hazards; keep product decisions in `docs/`.
- Keep final Docker images non-root, read-only, multi-stage, and free of source, tests, compilers, caches, and unused native runtimes.

## Source naming

- Source directories and source, test, component, and script filenames use lowercase kebab-case.
- Conventional lowercase entry and barrel names such as `index.ts`, `main.tsx`, and `vite.config.ts` remain unchanged; suffixes such as `.test.tsx` stay dot-separated.
- React components, types, and exports may use PascalCase inside files, but filesystem paths remain kebab-case.
- `bun run check:filenames` enforces this convention across Mewa Code and the browser service.

## Verification

- Run the narrowest relevant check during development.
- Test observable retained behavior and meaningful security/failure boundaries.
- Delete tests that exist only for removed features.
- Use broader integration/image checks for changes crossing Pi, SSH, browser, ACP, or persistence boundaries.
- Before committing, review for stale imports, protocol fields, scripts, documentation, generated files, and dependency-lock entries.

## Current stack

The foundation uses Bun, TypeScript, React, Zustand, and Pi's in-process SDK. Treat these as current implementation choices, not permanent product scope.
