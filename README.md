# Gooseberry

A self-hosted workspace for [Goose](https://github.com/aaif-goose/goose): conversations, project files and agent work in one Web UI.

## Features

- Concurrent chats with streaming replies, images, steering, follow-up queues, search and forks.
- Projects spanning multiple directories and Git repositories.
- Read-only file previews, source highlighting and commit or working-tree diffs.
- Goals, tasks, permission prompts and custom agent mentions.
- Goose provider, model, extension, recipe and schedule controls.
- Browser automation with MCP tools and screenshot previews.

Goose handles conversations, models and tools on your host. Gooseberry runs a Go application with a React frontend and a separate browser service, each in its own container.

## Get started

You need Linux x86-64 or arm64, Docker Compose and an [official Goose release](docs/goose.md).

Follow the [setup guide](docs/deployment.md) to configure Goose, secrets and project mounts, then start:

```bash
docker compose --env-file .gooseberry up -d --build
```

Open **http://127.0.0.1:7312**, configure a provider and create a project.

Gooseberry is for one trusted user. Goose tools have your host permissions; read the [security notes](docs/security.md) before exposing the services.

## Documentation

[Setup](docs/deployment.md) · [Features](docs/baseline.md) · [Architecture](docs/architecture.md) · [Development](docs/development.md) · [ACP coverage](docs/acp.md) · [Roadmap](docs/roadmap.md)

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md).
