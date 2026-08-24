# Mewa Code

Mewa Code is a focused web interface for the [`pi`](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) coding agent. It organizes local Git repositories and their persistent Pi sessions while leaving models, credentials, prompts, tools, extensions, compaction, retry, usage, cost, and canonical JSONL history under Pi's authority.

The canonical product scope is [`goal-and-requirements.md`](goal-and-requirements.md). The current branch is an oversized ThinkRail-derived foundation. Worktree-first navigation, IDE layout, editor, terminal, review, spec, workflow, website, packaging, and bundled tool systems are implementation inventory to reduce or remove, not the product definition.

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

Run the current imported launcher with `bun run --filter @mewa-code/cli dev`. Binary packaging exists in the foundation but is not part of the simplification baseline.

## Architecture

- **Engine host** — `packages/server` and `packages/shared`, currently launched by `apps/cli`, run Pi in-process and serve the browser connection.
- **Shared client-host types** — `packages/contracts` reflects the imported transport surface.
- **Web client** — `apps/web` contains the current React browser interface.

The product baseline is [`goal-and-requirements.md`](goal-and-requirements.md). [`architecture.md`](architecture.md) and module `SPEC.md` files describe the imported implementation until it is simplified. They do not expand product scope.

## Repo layout

```
apps/
  cli/        current entrypoint: boot host and open browser
  web/        browser UI client
  desktop/    inherited deferred launcher, not baseline scope
  website/    inherited unpublished preview, removal candidate
packages/
  server/     createServer(): Bun.serve + AgentSessionManager
  contracts/  the wire, types-only
  shared/     server-side helpers
  spec-graph/ inherited extension, not baseline scope
```

## Development checks

Run the narrowest check or focused test for the code being changed. Use repository-wide type checking or builds when a change crosses package boundaries. The inherited full unit and end-to-end suites are not routine gates during simplification, and tests for removed features should be deleted with those features.

## Privacy

Mewa Code does not include product analytics, PostHog, Google Tag Manager, tracking pixels, or hidden
telemetry. Local credentials, files, transcripts, and Pi's canonical session files remain on the host unless
an explicit feature or configured extension sends them elsewhere. Requests to the selected model provider
transmit prompts and supplied context according to that provider's terms. The unpublished website preview
is static and does not load tracking SDKs.

## Contributing

Contributions are welcome. See [`CONTRIBUTING.md`](CONTRIBUTING.md) and the
[`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).

## License

Licensed under the [Apache License 2.0](LICENSE).
