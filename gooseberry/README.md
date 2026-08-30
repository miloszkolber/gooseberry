# Application workspace

One Go module serves the application and browser API. The React/Vite frontend communicates with it through a small browser protocol; there is no JavaScript server.

```text
main.go       startup, coordinated shutdown and health check
controller/   Goose ACP, application HTTP/MCP, projects and persistence
browser/      browser HTTP API, command policy and Chromium lifecycle
contracts/    browser wire types and envelope validation
webui/        React application, feature state and presentation
scripts/      dependency and source checks
Dockerfile    multi-stage build for the single runtime image
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

`bun run test` includes the contract, frontend and Go tests. `bun run build` writes the executable to `dist/gooseberry` and static assets to `webui/dist`. Bun is a build/test dependency only; the final image contains neither Bun nor Node.

See [development](../docs/development.md) for focused validation and performance boundaries, [architecture](../docs/architecture.md) for state ownership, and [deployment](../docs/deployment.md) for the supported one-container runtime.
