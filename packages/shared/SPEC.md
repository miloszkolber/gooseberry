---
id: module-shared
type: module-design
status: active
title: Shared server-side utilities
parent: architecture
depends-on: []
references: []
tags: [v1, host]
---

## Responsibility

Cross-cutting runtime utilities used by the engine host and its launchers. Server-side only, never bundled
into `apps/web`. Exposed through explicit subpath exports, not a barrel.

## Boundary

- **Owns:** host-side helpers that are neither engine- nor transport-specific.
- **Public surface:** `@mewa-code/shared/shellEnv` → `resolveShellEnv()`, `pathLooksComplete()`, and
  `localeRepair()`; `@mewa-code/shared/freePort` → `findFreePort()` and `isPortFree()`;
  `@mewa-code/shared/startupMark` → the static wordmark plus responsive/ANSI rendering and the
  interactive-output gate; `@mewa-code/shared/paths` → worktree-relative path conventions
  (`WORKSPACE_INTERNAL_DIR`, `WORKSPACE_CONTEXT_DIR`, `WORKSPACE_TODOS_DIR`); and
  `@mewa-code/shared/codedError` → `CodedError` and `errorCodeOf()`.
- **Allowed deps:** Bun/Node runtime (`@types/bun`).
- **Forbidden:** importing `server`, `web`, or any `pi` package, and being imported by `web`.

## Contents

- **/shellEnv** — `resolveShellEnv()` repairs the environment inherited by GUI-launched hosts. It restores a
  useful login-shell `PATH` when needed and selects a UTF-8 `LANG` only when no locale is configured. Both
  repairs update `process.env`, which reaches PTY terminals and the in-process agent's bash tool. Failures
  leave the existing environment unchanged.
- **/freePort** — `findFreePort(preferred, host?)` scans upward from the preferred port and falls back to an
  OS-assigned ephemeral port. `isPortFree(port, host?)` performs the underlying single-port probe.
- **/startupMark** — the launcher boot signature, rendered from the Mewa Code identity, caller-supplied
  status, and resolved endpoint. Wide terminals use the lockup, medium terminals stack it, and narrow or
  non-interactive output uses only the text identity. `NO_COLOR` and `TERM=dumb` select plain UTF-8 output.
- **/codedError** — `CodedError(code, message)` carries a wire `WsErrorCode` across the server handler
  boundary. `errorCodeOf()` extracts it without importing either the web client or the host composition root.
- **/paths** — names the repo-local `.mewa-code` scratch directory and its `context/` and `context/todos/`
  children. These are distinct from the home state directory `~/.mewa-code`, which belongs to server
  persistence.

## Get right (shellEnv)

- Run once at startup, before creating any `AgentSession`.
- No-op on Windows or when `pathLooksComplete()` detects a user-managed PATH.
- Otherwise run the user's login shell with a bounded timeout, parse NUL-separated environment entries, and
  replace only `PATH`. Any failure leaves it untouched.
- Set only `LANG` when `LC_ALL`, `LC_CTYPE`, and `LANG` are all absent. Preserve category-specific locale
  settings supplied by the user.

## Get right (freePort)

- Detect occupancy by probing with a TCP connect, not by catching a bind error. `Bun.serve` can share a busy
  localhost port on some platforms.
- Scan predictably from `preferred` and use an OS-assigned ephemeral port only after the scan range is full.

## Get right (startupMark)

- Keep the wordmark and status renderer pure so source and compiled launchers share the same output.
- Never emit terminal control sequences when output is not interactive or color is disabled.
