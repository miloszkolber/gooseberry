# gooseberry workspace

This directory contains the Bun workspace for the Gooseberry controller, Web UI, Goose ACP client, and browser integration. The product contract is [`../docs/baseline.md`](../docs/baseline.md).

## Development

Requirements are Bun 1.3 or newer, Node.js 22.19 or newer, and a running Goose v1.48.0 service with a configured provider.

```bash
bun install
bun run dev
```

Use `bun run dev:server` and `bun run dev:web` to run either side separately.

## Layout

```text
apps/controller/       controller and host bootstrap
webui/                 React/Vite browser client
packages/goose-client/ Goose ACP client and normalization
packages/              controller support and shared contracts
```

The separate [`gooseberry-browser`](../gooseberry-browser/) service keeps Chromium away from Goose credentials and repository mounts. Compose uses host networking and admitted same-path project mounts.
