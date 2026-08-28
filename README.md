# Gooseberry

Gooseberry is a focused Web UI for Goose. It provides directory-based projects, persistent sessions, goals and tasks, custom agents, multi-image prompts, provider/model projection, local Git visibility, and read-only file browsing.

Goose is the agent runtime. Gooseberry connects to its loopback ACP server. Goose is authoritative for sessions, history, providers, models, tools, compaction, permissions, recipes, and scheduling.

## Runtime model

- The host runs `/usr/local/bin/goose serve --enable-scheduler` on loopback.
- The controller connects to Goose ACP at `ws://127.0.0.1:3284/acp`.
- Repository files, Git status and diffs, and file previews use admitted same-path mounts.
- Chromium runs in the separate `gooseberry-browser` service.

## Deployment

```bash
sudo ./goose/install-goose.sh
cp .gooseberry.example .gooseberry
# Set strong, distinct GOOSEBERRY_TOKEN and GOOSEBERRY_GOOSE_SECRET_KEY values in .gooseberry.
./scripts/setup-deployment.sh /absolute/project-root /absolute/gooseberry-data
install -Dm644 goose/systemd/goose.service ~/.config/systemd/user/goose.service
systemctl --user daemon-reload && systemctl --user enable --now goose.service
docker compose --env-file .gooseberry up -d --remove-orphans
```

Setup synchronizes `.gooseberry`, including the technical user's `GOOSEBERRY_UID` and `GOOSEBERRY_GID`, and writes `~/.config/goose/gooseberry.env` with the matching Goose secret and browser credentials. Do not replace or truncate that generated file. The controller listens on host port `3141`, and the browser service on `127.0.0.1:8787`. Authentication defaults on through `GOOSEBERRY_AUTH_ENABLED=true` with `GOOSEBERRY_TOKEN` as the human login credential.

`${GOOSEBERRY_DATA_PATH}/gooseberry/app` mounts at `/var/lib/gooseberry`. Browser artifacts and state live under `${GOOSEBERRY_DATA_PATH}/gooseberry/browser`. Goose keeps its own user configuration and state in the technical user's home. For local image development, add `--build` to the Compose command. See [`docs/deployment.md`](docs/deployment.md) and [`docs/baseline.md`](docs/baseline.md).

## License

Apache-2.0. See [`NOTICE.md`](NOTICE.md) for attribution and provenance.
