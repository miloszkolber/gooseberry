# Goose integration

Gooseberry uses the unchanged upstream Goose v1.48.0 distribution at source commit `25021517f12cab87c94bed0874fe7d28168dc264`. The release workflow verifies that commit and publishes the version and commit in `GOOSE-PROVENANCE`. The release artifact installs as `/usr/local/bin/goose` and runs as the technical host user.

## Service

Run `goose serve --enable-scheduler` on `127.0.0.1:3284` with `GOOSE_SERVER__SECRET_KEY`. Gooseberry connects over ACP using the matching `GOOSEBERRY_GOOSE_SECRET_KEY`. Goose owns sessions, history, provider and model configuration, tools, compaction, permissions, recipes, and scheduler persistence.

## Gooseberry additions

- Projects map visible absolute directories to Goose sessions and working directories.
- Goals and ordered tasks are Gooseberry state. Objective updates use MCP.
- Custom agents are installed as Goose agents and summoned in Goose sessions.
- The browser capability is a lazy Goose skill backed by `gooseberry-browser`.
- Gooseberry projects Git status and diffs, read-only files, session presentation, and Web UI state.
- Provider setup, slash commands, history search, recipes, and scheduler controls are ACP projections. Goose remains authoritative for their configuration and state.

## Installation

```bash
sudo ./goose/install-goose.sh
./scripts/setup-deployment.sh
install -Dm644 goose/systemd/goose.service ~/.config/systemd/user/goose.service
systemctl --user daemon-reload && systemctl --user enable --now goose.service
docker compose --env-file .gooseberry up -d --remove-orphans
```

Setup writes `$HOME/.config/goose/gooseberry.env` with the Goose secret, browser endpoint, browser authentication setting, and browser token when browser authentication is enabled. It preserves unrelated entries and refuses duplicate managed keys. The installer places custom agents and the browser skill in `$HOME/.config/goose`. Goose state remains in the technical user's home. Gooseberry application state is `${GOOSEBERRY_DATA_PATH}/app`; browser state is `${GOOSEBERRY_DATA_PATH}/browser`.
