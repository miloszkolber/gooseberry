# Gooseberry

A self-hosted Web UI for [Goose](https://github.com/aaif-goose/goose). Keep conversations, files and agent work together by project, without moving your development workflow into a browser IDE.

Goose handles the sessions, models, tools and permissions. Gooseberry adds a place to manage the work: a project can span several directories and repositories, with multiple conversations running alongside one another. You can still use Goose directly.

## Features

- Persistent chats with streaming replies, images, steering, follow-up queues, search and conversation forks.
- Goals and tasks beside each chat, with custom agents, permission prompts and supporting questions.
- Read-only file and image previews, Git status and diffs.
- Goose provider setup, model choices, agent and extension management, recipes and schedules.
- Browser automation for inspecting pages, interacting with them and taking screenshots.

One `gooseberry` container runs a Go service and serves the React frontend. Goose runs on the host as a Linux user service. Node and Bun are not runtime dependencies. The frontend loads larger views on demand and enforces a 500,000-byte initial JavaScript budget.

The Goose distribution keeps upstream Rust code unchanged. Its build choices and one checked lockfile correction are described in the [distribution guide](docs/goose.md).

## Setup

You need Linux x86-64 or arm64, Docker Engine with Compose, and a non-root user with systemd user services. Private repository, release and container downloads require the appropriate GitHub access.

1. Clone the repository and install its pinned Goose distribution.
2. Copy `.gooseberry.example` to `.gooseberry`. Set a dedicated data directory and a random Goose secret.
3. Add read-only project mounts to `docker-compose.yaml`, keeping each directory at the same host and container path. Run `./scripts/setup-deployment.sh` as your Linux user.
4. Start the Goose user service and Gooseberry container. Open `http://127.0.0.1:7312`, configure a provider and create a project.

The [setup guide](docs/deployment.md) has the commands, private-download instructions, user permissions and update procedure. You can build the image locally without access to the published GHCR package.

## Security

Gooseberry is for a trusted single user. Goose tools run with that user's host permissions. Chromium shares the container filesystem with the application, including mounted project files and application data; a read-only mount does not prevent reading or sending files elsewhere. Both HTTP listeners bind to loopback by default.

Read the [security guide](docs/security.md) before exposing either listener or using browser automation with untrusted content.

## Documentation

- [Deployment](docs/deployment.md) — setup, access, backups and updates.
- [Architecture](docs/architecture.md) — services, state and source layout.
- [Development](docs/development.md) — checks and performance requirements.
- [Goose distribution](docs/goose.md) and [ACP coverage](docs/acp.md) — builds and integration.
- [Product baseline](docs/baseline.md) and [roadmap](docs/roadmap.md) — current features and planned work.

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md).
