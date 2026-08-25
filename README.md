# Mewa Code

Mewa Code is a focused web interface for the [`pi`](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) coding agent. It organizes local Git repositories, optional worktrees, persistent Pi sessions, files, terminals, and local changes. Pi ships with a visible Mewa profile integrating browser QA, web search, memory, goals, and subagents while remaining authoritative for models, credentials, prompts, tools, extensions, compaction, retry, usage, cost, and canonical JSONL history.

The canonical product scope is [`docs/product-baseline.md`](docs/product-baseline.md). Legacy review, spec, workflow, website, release, visualization, todo, template, and GitHub systems have been removed from this focused foundation. The isolated `mewa-browser` service is restored under `mewa-browser/` and exposed to Pi through the focused browser extension package.

This branch is the source foundation for the new product. It does not publish binaries or installers yet. Runtime prerequisites include `git` on PATH. Agent-backed runs require an authenticated Pi provider, which may be configured through supported Pi-backed UI actions. Mewa Code never requires a standalone `pi` executable.

## Quick start

### Prerequisites

- **Bun** ≥ 1.3
- **Node.js** ≥ 22.19 for the in-process Pi engine
- An authenticated Pi provider for agent-backed runs

### Develop

```bash
git clone <repo-url>
cd mewa_code
bun install
bun run dev
```

Run the local launcher with `bun run --filter @mewa-code/cli dev`.

## Architecture

- **Engine host** — `packages/server` and `packages/shared`, currently launched by `apps/cli`, run Pi in-process and serve the browser connection.
- **Shared client-host types** — `packages/contracts` reflects the imported transport surface.
- **Web client** — `apps/web` contains the current React browser interface.

The product baseline is [`docs/product-baseline.md`](docs/product-baseline.md). [`docs/foundation-inventory.md`](docs/foundation-inventory.md) describes the imported implementation until it is simplified. It does not expand product scope.

## Repo layout

```
apps/
  cli/        current entrypoint: boot host and open browser
  web/        browser UI client
  desktop/    inherited deferred launcher, not baseline scope
packages/
  server/     createServer(): Bun.serve + AgentSessionManager
  contracts/  the wire, types-only
  shared/     server-side helpers
```

## Development checks

Run the narrowest check or focused test for the code being changed. Use repository-wide type checking or builds when a change crosses package boundaries. The inherited full unit and end-to-end suites are not routine gates during simplification, and tests for removed features should be deleted with those features.

## Privacy

Mewa Code does not include product analytics, PostHog, Google Tag Manager, tracking pixels, or hidden
telemetry. Local credentials, files, transcripts, and Pi's canonical session files remain on the host unless
an explicit feature or configured extension sends them elsewhere. Requests to the selected model provider
transmit prompts and supplied context according to that provider's terms.

## Contributing

Contributions are welcome. See [`docs/contributing.md`](docs/contributing.md) and the [`docs/code-of-conduct.md`](docs/code-of-conduct.md).

## License

Licensed under the [Apache License 2.0](LICENSE).
