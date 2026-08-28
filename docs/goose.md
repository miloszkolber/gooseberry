# Goose integration

Gooseberry uses the unchanged upstream Goose v1.48.0 distribution at source commit `25021517f12cab87c94bed0874fe7d28168dc264`. The release workflow verifies that exact cloned `HEAD` and publishes the version and commit in `GOOSE-PROVENANCE`. The release artifact installs as `/usr/local/bin/goose`, remains compatible with vanilla Goose, and runs as the technical host user.

## Service

Run `goose serve --enable-scheduler` on `127.0.0.1:3284` with `GOOSE_SERVER__SECRET_KEY`. Gooseberry connects over Goose ACP using the matching `GOOSEBERRY_GOOSE_SECRET_KEY`. Goose owns sessions, history, provider/model configuration, tools, compaction, permissions, recipes, and scheduler persistence.

## Gooseberry additions

- Projects map admitted directory roots to Goose sessions and working directories.
- Goals and ordered tasks are Gooseberry state. Objective updates use MCP.
- Custom agents are installed as Goose agents and summoned in Goose sessions.
- The browser capability is a lazy Goose skill backed by the separate `gooseberry-browser` HTTP service.
- Gooseberry projects Git status/diffs, read-only files, session presentation, and Web UI state.
- Recipe and schedule settings expose supported Goose list, create, edit, pause/resume, run-now, delete, and session-history controls. Goose remains authoritative.

## Installation

```bash
sudo ./goose/install-goose.sh
./scripts/setup-deployment.sh /absolute/project-root /absolute/data-root
install -Dm644 goose/systemd/goose.service ~/.config/systemd/user/goose.service
systemctl --user daemon-reload && systemctl --user enable --now goose.service
docker compose --env-file .gooseberry up -d --remove-orphans
```

Setup writes `$HOME/.config/goose/gooseberry.env` mode `0600` with the Goose secret, browser URL, and browser token. It intentionally ignores a non-default `XDG_CONFIG_HOME` to match the static systemd user-unit path, preserves unrelated entries, and refuses duplicate required keys. The installer also installs Gooseberry custom agents and the browser skill into the technical user's standard Goose configuration directory. Goose's normal user configuration and state remain in that home. Gooseberry application state is under `${GOOSEBERRY_DATA_PATH}/gooseberry/app`; browser artifacts and state are under `${GOOSEBERRY_DATA_PATH}/gooseberry/browser`.

Rotate `GOOSEBERRY_GOOSE_SECRET_KEY` or `GOOSEBERRY_BROWSER_TOKEN` in `.gooseberry` and rerun setup. Restart the user Goose unit and Compose services to apply the synchronized credentials.
