# Gooseberry

Gooseberry is a self-hosted Web UI for [Goose](https://github.com/aaif-goose/goose). It groups conversations, project files and agent work without replacing Goose's models, tools or configuration.

Its frontend uses Svelte 5 with Mewa UI foundations. Bun compiles it directly without a separate application bundler, and the pinned Mewa packages come from a verified GitHub Release rather than a package registry.

## Features

- Concurrent persistent chats with streaming, bounded images and text-file attachments, steering, queues, search and forks.
- Projects rooted at one admitted directory, with discovery of multiple Git repositories beneath it.
- Read-only source and image previews with working-tree, commit and branch-base diffs.
- Goals, tasks, permission prompts, plans, modes and custom agent mentions.
- Provider, model, extension, recipe, schedule and tool controls supplied by Goose.
- Browser automation over MCP, a bounded interactive browser panel and isolated interactive App views.
- A modular MCP host that publishes the embedded Browser module and future services from one authenticated origin.

Goose runs on the host. The default deployment uses the application and the `gooseberry-mcp` container. That host embeds the Browser module, publishes its catalog and keeps Browser compatibility routes. Project root directories are mounted only into the application; the Browser module has separate state and no project or Goose configuration mounts.

## Run

You need Linux x86-64 or arm64, Docker Compose and the [supported official Goose release](docs/acp.md#supported-goose-release).

```bash
git clone https://github.com/miloszkolber/gooseberry.git
cd gooseberry
cp .gooseberry.example .gooseberry
```

Configure Goose, secrets, state directories and project mounts using the [deployment guide](docs/deployment.md), then start both containers:

```bash
docker compose --env-file .gooseberry up -d --build
```

Open <http://127.0.0.1:7312>, configure a provider and create a project.

Gooseberry is designed for one trusted user. Goose tools run with the host user's permissions; read the [security model](docs/security.md) before exposing either service.

## Documentation

[Architecture](docs/architecture.md) · [Deployment](docs/deployment.md) · [MCP reference](docs/mcp.md) · [Goose and ACP](docs/acp.md) · [Development](docs/development.md) · [Security](docs/security.md) · [Roadmap](docs/roadmap.md)

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md).
