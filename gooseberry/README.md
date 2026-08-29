# gooseberry workspace

This directory contains the Bun workspace for the Gooseberry controller, Web UI, Goose ACP client, and browser integration. The product contract is [`../docs/baseline.md`](../docs/baseline.md).

## Checks

The workspace uses Bun 1.3 or newer.

```bash
bun install
bun run lint
bun run typecheck
bun run test
bun run build
```

## Layout

```text
apps/controller/       controller and host bootstrap
webui/                 React/Vite browser client
packages/goose-client/ Goose ACP client and normalization
packages/              controller support and shared contracts
```

The separate Go [`gooseberry-browser`](../gooseberry-browser/) service keeps Chromium away from Goose credentials and project mounts. Validate it with `CGO_ENABLED=0 go test ./...` and `CGO_ENABLED=0 go vet ./...` from that directory. Compose is the supported runtime.
