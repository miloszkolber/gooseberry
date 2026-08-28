# Deployment

Gooseberry uses a host-native Goose service and two host-networked Docker services.

## Setup order

Install the pinned Goose binary first. The Goose version and exact upstream source commit are recorded in `goose/version` and `goose/source-commit`, then run Gooseberry setup as the non-root technical user. Setup creates or synchronizes `.gooseberry`, app/browser state, and `$HOME/.config/goose/gooseberry.env` mode `0600`.

```bash
sudo ./goose/install-goose.sh
cp .gooseberry.example .gooseberry
# Set strong, distinct GOOSEBERRY_TOKEN and GOOSEBERRY_GOOSE_SECRET_KEY values in .gooseberry.
./scripts/setup-deployment.sh /absolute/project-root /absolute/data-root
install -Dm644 goose/systemd/goose.service ~/.config/systemd/user/goose.service
systemctl --user daemon-reload && systemctl --user enable --now goose.service
docker compose --env-file .gooseberry up -d --remove-orphans
```

The installer is the only privileged step. The unit runs `/usr/local/bin/goose serve --enable-scheduler` as the technical user on `127.0.0.1:3284`. Setup synchronizes `GOOSE_SERVER__SECRET_KEY`, `GOOSEBERRY_BROWSER_URL`, and `GOOSEBERRY_BROWSER_TOKEN` without printing secrets. The unit's `EnvironmentFile` is statically `%h/.config/goose/gooseberry.env`, so Gooseberry intentionally does not use a non-default `XDG_CONFIG_HOME` for Goose. Goose's standard user configuration and state remain in that user's home.

Set strong distinct `GOOSEBERRY_TOKEN` and `GOOSEBERRY_GOOSE_SECRET_KEY` values in `.gooseberry` before setup. Setup generates and synchronizes `GOOSEBERRY_BROWSER_TOKEN`. The controller serves on port `3141` by default. Set `GOOSEBERRY_PORT=7312` in `.gooseberry` to override the controller port. The browser service listens on `127.0.0.1:8787`, and the host-native Goose service on `127.0.0.1:3284`. Those browser and Goose ports are fixed by deployment. Use `--build` for local images.

Compose mounts `${GOOSEBERRY_DATA_PATH}/gooseberry/app` at `/var/lib/gooseberry` and browser state at `/var/lib/gooseberry-browser`. The admitted same-path project mount is read-only because Goose, not the controller, changes project files. Setup writes `GOOSEBERRY_UID` and `GOOSEBERRY_GID` from the technical user into `.gooseberry`, so Compose runs both images with the host state owner's non-root identity and owns each `/run` tmpfs with that identity. Do not run setup as root. Set `GOOSEBERRY_PUBLIC_ORIGIN` when a trusted reverse proxy terminates TLS.

To rotate the Goose or browser credential, update the corresponding `.gooseberry` value and rerun setup. It safely rewrites the service-facing values while preserving unrelated Goose environment entries. Then restart the user Goose unit and Compose services.
