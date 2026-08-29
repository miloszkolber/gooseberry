# Gooseberry

Gooseberry is a focused Web UI for Goose. It provides directory-based projects, persistent sessions and history search, goals and tasks, custom agents, multi-image prompts, provider authentication and model projection, Goose recipes and scheduling, Git visibility, and read-only file browsing.

Goose is the agent runtime and remains authoritative for sessions, history, providers, models, tools, compaction, permissions, recipes, and scheduling. Gooseberry connects to its loopback ACP service.

## Deploy

```bash
sudo ./goose/install-goose.sh
cp .gooseberry.example .gooseberry
# Set GOOSEBERRY_DATA_PATH and GOOSEBERRY_GOOSE_SECRET_KEY in .gooseberry.
./scripts/setup-deployment.sh
install -Dm644 goose/systemd/goose.service ~/.config/systemd/user/goose.service
systemctl --user daemon-reload && systemctl --user enable --now goose.service
docker compose --env-file .gooseberry up -d --remove-orphans
```

Before starting Compose, add a read-only same-path bind mount for every directory that users will select as a project. The controller uses port 7312 and the browser service uses `127.0.0.1:8787`. See [`docs/deployment.md`](docs/deployment.md).

## License

Apache-2.0. See [`NOTICE.md`](NOTICE.md) for attribution and provenance.
