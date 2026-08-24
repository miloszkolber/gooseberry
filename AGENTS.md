# Mewa Code

Mewa Code is a focused web interface for the Pi Coding Agent.

Read these files first:

1. `docs/product-baseline.md` is the canonical product baseline.
2. `docs/foundation-inventory.md` inventories the imported implementation and its coupling.

Product and engineering documentation belongs under `docs/`. Runtime prompt assets may remain beside their loaders.

## Current priority

Simplify the ThinkRail-derived foundation. Delete features, dependencies, tests, and documents outside the product baseline.

Do not preserve code because an inherited spec or test describes it. Update or delete that material with its feature.

Keep changes aligned with the baseline implementation order. Avoid unrelated redesigns while removing a feature.

## Pi boundary

- Run Pi in-process through its public SDK.
- Keep Pi authoritative for prompts, tools, providers, models, settings, extensions, retries, compaction, usage, cost, and JSONL sessions.
- Do not build duplicate provider, model, credential, session, or usage registries.
- Ship the documented Mewa Pi profile with browser QA, web search, memory, goals, subagents, and the protected-state guard.
- Keep defaults visible and preserve explicit Pi user settings.
- Integrate each retained Pi tool with a clear web UI renderer or control.
- Keep the complete Pi package family on one exact stable version.
- Never bundle provider runtime code into the browser client.

## Product boundary

- Treat a local Git repository as a project.
- Use the repository's normal working tree by default.
- Keep optional worktrees, lightweight files, text editing, and terminals.
- Group persistent Pi sessions by repository.
- Keep Git behavior local. Do not add GitHub requirements.
- Keep website, desktop, release, workflow, spec-graph, review, and forced worktree-first systems outside baseline scope.
- Restore isolated `mewa-browser` behavior. Never run Chromium with Pi credentials or repository mounts.
- Protect Pi and Mewa state roots from project-scoped browsing and tools.

## Engineering approach

- Prefer deletion over compatibility for unshipped inherited behavior.
- Add an abstraction only when retained baseline behavior requires it.
- Keep the browser-host interface as small as retained behavior permits.
- Remove dead protocol methods, state, dependencies, and tests with their feature.
- Preserve user data formats only when current Mewa users can have that data.
- Keep source comments for non-obvious hazards. Put product decisions in the baseline.
- Keep final Docker images non-root, read-only, multi-stage, and free of build or test tooling.

## Verification

- Run the narrowest relevant check during development.
- Test observable retained behavior and meaningful failures.
- Delete tests that exist only for removed features.
- Use broad end-to-end tests only for changes crossing the real browser-host boundary.
- Do not require the inherited full suite for an isolated deletion.
- Review the final diff for stale imports, scripts, documentation, protocol fields, and generated files.

## Current stack

The imported foundation uses Bun, TypeScript, React, Zustand, and an in-process Pi SDK. Treat this as current state, not permanent product scope.
