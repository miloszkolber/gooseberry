# Mewa Code

Mewa Code is a thin desktop-and-mobile client for the [`pi`](https://www.npmjs.com/package/@earendil-works/pi-coding-agent)
coding agent. It runs Pi in-process and bridges it to a rich, mobile-first UI. Pi owns models,
skills/extensions, compaction, retry behavior, stats, cost, credentials, and canonical JSONL session state.
Mewa Code owns the workspace, editor, terminals, wire, and host lifecycle.

This imported foundation does not yet fully meet that target boundary. It still loads inherited bundled
workflow, web, visualization, spec-graph, todo, and host-bridge extensions while those are separated into
required UI adapters and explicitly enabled optional Pi extensions.

**V1 is a Worktree IDE:** open a git repo as a project, create workspaces as `git worktree`s with their own
branch and cwd, and work across Monaco tabs, git Changes, terminals, a read-only spec-graph viewer, local
review, and multiple concurrent Pi chat sessions.

This branch is the source foundation for the new product. It does not publish binaries or installers yet.
Runtime prerequisites are `git` on PATH and an authenticated Pi provider. Mewa Code never requires a
standalone `pi` executable.

## Quick start

### Prerequisites

- **Bun** ≥ 1.3
- **Node.js** ≥ 22.19 for the in-process Pi engine
- An authenticated Pi provider for agent-backed runs

### Develop

```bash
git clone <repo-url>
cd mewa-code
bun install
bun run dev
```

Run the V1 CLI entrypoint with `bun run --filter @mewa-code/cli dev`, or build a standalone binary with
`bun run build:binary`.

## Architecture

- **Engine host** — `packages/server` and `packages/shared`, launched by `apps/cli`. `createServer()` is a
  `Bun.serve` HTTP+WS host with one in-process Pi `AgentSession` per chat tab.
- **The wire** — `packages/contracts`, the typed and versioned protocol.
- **UI client** — `apps/web`, a mobile-first React client that depends on `packages/contracts` only and can
  ship independently of the host.

The canonical product and design specs are [`goal-and-requirements.md`](goal-and-requirements.md) and
[`architecture.md`](architecture.md). Module boundaries and spec-first workflow are documented in
[`AGENTS.md`](AGENTS.md).

## Repo layout

```
apps/
  cli/        V1 entrypoint: boot host and open browser
  web/        mobile-first UI client
  desktop/    Electrobun launcher, deferred
  website/    unpublished static site preview
packages/
  server/     createServer(): Bun.serve + AgentSessionManager
  contracts/  the wire, types-only
  shared/     server-side helpers
  spec-graph/ portable Pi extension: spec_* tools + skill
```

## Development checks

```bash
bun run check:deps
bun run check:seams
bun run lint
bun run typecheck
bun run test
```

End-to-end tests drive the real UI against isolated hosts:

```bash
bun run e2e
bun run e2e:serial
bun run e2e:full
bun run e2e:agent
```

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
