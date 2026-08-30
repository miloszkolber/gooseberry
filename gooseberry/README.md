# Application workspace

One Go module builds the application and browser service as separate executables. The React/Vite frontend communicates with the application through a small WebSocket protocol; there is no JavaScript server.

```text
main.go       application startup, shutdown and health check
cmd/browser/  browser-service entry point and health check
controller/   Goose ACP, application HTTP/MCP, projects and persistence
browser/      browser MCP/HTTP API, guidance, artifacts and Chromium lifecycle
contracts/    frontend wire types and envelope validation
webui/        React application, feature state and presentation
scripts/      dependency and source checks
Dockerfile    multi-stage build with gooseberry and browser runtime targets
```

Use Go and Bun versions pinned in `Dockerfile` and `package.json`. Prefer disposable build containers when these tools are not installed locally.

```bash
bun install --frozen-lockfile
bun run check:deps
bun run lint
bun run typecheck
bun run test
bun run build
go test -race ./...
go vet ./...
```

`bun run test` includes the contract, frontend and Go tests. `bun run build` writes the application executable to `dist/gooseberry` and static assets to `webui/dist`. Build the standalone browser with `go build -trimpath -o dist/gooseberry-browser ./cmd/browser`. Docker builds both executables into their respective images. Bun is a build/test dependency only; neither final image contains Bun or Node.

See [development](../docs/development.md) for focused validation and performance boundaries, [architecture](../docs/architecture.md) for state ownership, and [deployment](../docs/deployment.md) for the two-service Compose configuration.
