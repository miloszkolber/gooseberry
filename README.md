# Gooseberry

A focused, self-hosted workspace for [Goose](https://github.com/aaif-goose/goose): keep projects, conversations and agent work together without turning your browser into another IDE.

Gooseberry gives Goose a persistent Web UI. Projects can span several directories and repositories. Conversations stay with their project, while Goose keeps control of the actual sessions, models, tools and permissions. Use Goose directly whenever you want; Gooseberry does not replace its runtime or maintain a competing provider registry.

## What it does

- Work across persistent, concurrent chats with streaming replies, multi-image prompts, steering, follow-up queues, history search and native session forks.
- Keep a goal and ordered tasks beside each conversation. Summon focused agents and answer permission requests or supporting questions in context.
- Browse files, source previews, Git status and readable diffs without exposing an editor, terminal or a second Git workflow.
- Configure Goose providers and authentication, choose models, manage agents and extensions, and use Goose recipes and schedules.
- Give agents bounded browser automation for inspecting pages and capturing screenshots.

The application is one Go executable and a React frontend in **one `gooseberry` container**. Goose runs separately as a native Linux user service, with upstream Rust code unchanged and an explicit [distribution build policy](docs/goose.md). There is no JavaScript backend or runtime Node/Bun installation. The production frontend enforces a 500,000-byte initial JavaScript budget and loads larger surfaces on demand.

## Get started

The supported deployment uses Linux on x86-64 or arm64, Docker Engine with Compose, and a non-root user with a systemd user service. You need access to this repository and its release assets; private GitHub resources require authentication.

1. Clone the repository and install its pinned Goose distribution.
2. Copy `.gooseberry.example` to `.gooseberry`, choose a dedicated state directory and set a random Goose secret.
3. Run `./scripts/setup-deployment.sh` as the non-root user. Add read-only, same-path project mounts to `compose.yaml`.
4. Start the Goose user service, then the Gooseberry container. Open `http://127.0.0.1:7312`, configure a provider and create a project.

Follow the [complete setup guide](docs/deployment.md) for authenticated downloads, exact commands, filesystem ownership, remote access and updates. Use a local image build if you do not have access to the published GHCR package.

## A deliberate boundary

Gooseberry is a trusted single-user development appliance, not a multi-tenant sandbox. Its file and Git views are read-only, but Goose tools act with the host user's permissions. Chromium shares the container filesystem, including project and Goose configuration mounts; API restrictions and a minimal subprocess environment are not filesystem isolation. Both HTTP listeners bind to loopback by default. Read the [security model](docs/security.md) before exposing either service or browsing untrusted content.

Follow-up queues survive a browser reconnect, not a controller restart. Browser automation is an HTTP API; session objectives use a separate authenticated MCP endpoint. These distinctions are intentional and documented in the [architecture](docs/architecture.md).

## Documentation

- [Deployment](docs/deployment.md): installation, operations and external service access.
- [Architecture](docs/architecture.md): ownership, state and source layout.
- [Development](docs/development.md): focused checks, performance gates and contribution boundaries.
- [Goose integration](docs/goose.md) and [ACP coverage](docs/acp.md): distribution policy and projected capabilities.
- [Product baseline](docs/baseline.md) and [roadmap](docs/roadmap.md): what belongs in Gooseberry and what remains open.

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md) for attribution.
