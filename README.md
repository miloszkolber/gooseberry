# Gooseberry

A self-hosted Web UI for [Goose](https://github.com/aaif-goose/goose). Keep conversations, files and agent work together by project, without moving your development workflow into a browser IDE.

Goose handles the sessions, models, tools and permissions. Gooseberry adds a place to manage the work: a project can span several directories and repositories, with multiple conversations running alongside one another. You can still use Goose directly.

## Features

- Persistent chats with streaming replies, images, steering, follow-up queues, search and conversation forks.
- Goals and tasks beside each chat, with custom agents, permission prompts and supporting questions.
- Read-only file and image previews, Git status and diffs.
- Goose provider setup, model choices, agent and extension management, recipes and schedules.
- Browser automation for inspecting pages, interacting with them and taking screenshots.

The application and browser automation run in separate containers, built from one Go module. The application serves the React frontend; the browser provides MCP tools and keeps its own state. Node and Bun are not runtime dependencies. Larger frontend views load on demand, with a 500,000-byte initial JavaScript budget.

Goose runs on the host, using an official upstream release that you install and manage. Gooseberry does not fork, rebuild or update it. See [Goose integration](docs/goose.md) for version compatibility and privacy settings.

## Setup

You need Linux x86-64 or arm64, Docker Engine with Compose, and upstream Goose configured for the same non-root Linux user. Private repository and container downloads require the appropriate GitHub access.

1. Install the supported official Goose release and configure its authenticated loopback service.
2. Copy `.gooseberry.example` to `.gooseberry`. Set the data directory and distinct Goose and browser secrets; create the two state directories with your user's permissions.
3. Add read-only project mounts to the application service in `docker-compose.yaml`, keeping each host and container path identical.
4. Start both Compose services and register the browser MCP extension in your private Goose configuration.
5. Open `http://127.0.0.1:7312`, configure a provider and create a project.

The [setup guide](docs/deployment.md) covers commands, permissions, MCP registration and updates. You can build both images locally without access to the published GHCR packages.

## Security

Gooseberry is for a trusted single user. Goose tools run with that user's host permissions. The browser container has no project, application-state or Goose-configuration mounts. Its own sessions still share a filesystem, and host networking does not restrict access to local services. Both listeners bind to loopback by default; Compose requires browser authentication.

Read the [security guide](docs/security.md) before exposing either listener or using browser automation with untrusted content.

## Documentation

- [Deployment](docs/deployment.md) — setup, access, backups and updates.
- [Architecture](docs/architecture.md) — services, state and source layout.
- [Development](docs/development.md) — checks and performance requirements.
- [Goose integration](docs/goose.md) and [ACP coverage](docs/acp.md) — upstream ownership and supported methods.
- [Product baseline](docs/baseline.md) and [roadmap](docs/roadmap.md) — current features and planned work.

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md).
