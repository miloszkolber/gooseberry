# Mewa Code workspace

This directory contains the Bun workspace for the controller, web UI, Pi integration packages, and runtime build scripts. Product scope and acceptance criteria live in [`../docs/product-baseline.md`](../docs/product-baseline.md).

## Development

Requirements are Bun 1.3 or newer, Node.js 22.19 or newer for the in-process Pi engine, Git, and an authenticated Pi provider for agent-backed runs.

```bash
bun install
bun run dev
```

The controller is the headless/web server launcher. Use `bun run dev:server` and `bun run dev:web` to run either side separately. Build, typecheck, lint, and the focused unit tests are available through the root workspace scripts.

The controller requires `MEWA_CODE_TOKEN` for WebSocket and file/artifact access. When using the Vite dev server, allow its local Origin with `MEWA_CODE_ALLOWED_ORIGINS=http://localhost:24269`, then open the UI with `#token=<MEWA_CODE_TOKEN>`. The fragment is captured into session storage and removed before the transport connects.

To run the Agent Client Protocol connector, start the controller with `--acp`. It serves ACP v1 NDJSON on stdin/stdout, so the client supplies an admitted absolute repository workspace as `cwd` in `session/new` or `session/load`.

```bash
MEWA_MOUNT_ROOTS=/path/to/repos bun apps/controller/src/index.ts --acp
```

## Layout

```text
apps/controller/  headless launcher and host bootstrap
webui/            React/Vite browser client
packages/server/  Pi host, HTTP/WebSocket browser transport, and stdio ACP behavior
packages/contracts/  client-host wire and domain types
packages/shared/  server-side helpers
packages/pi-mewa-browser/  Pi browser extension
scripts/          development and controller image helpers
```

The separate [`../mewa-browser/`](../mewa-browser/) service keeps Chromium away from Pi credentials and repository mounts.

In Compose, `MEWA_WORKSPACE_PATH` is mounted at its exact host path and must be listed in `MEWA_MOUNT_ROOTS`. Files, Git, and worktrees use that local mount. Pi bash uses the controller's read-only SSH key and known-hosts mounts to reach the configured host account.
