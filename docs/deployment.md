# Deployment

Gooseberry uses a host-native Goose service and two host-networked Docker services.

```bash
sudo ./goose/install-goose.sh
cp .gooseberry.example .gooseberry
# Set GOOSEBERRY_DATA_PATH and GOOSEBERRY_GOOSE_SECRET_KEY.
./scripts/setup-deployment.sh
install -Dm644 goose/systemd/goose.service ~/.config/systemd/user/goose.service
systemctl --user daemon-reload && systemctl --user enable --now goose.service
docker compose --env-file .gooseberry up -d --remove-orphans
```

Run setup as the technical host user. It creates `${GOOSEBERRY_DATA_PATH}/app`, `${GOOSEBERRY_DATA_PATH}/browser/artifacts`, and `${GOOSEBERRY_DATA_PATH}/browser/state`, ensures `$HOME/.config/goose` exists, and synchronizes the service environment at `$HOME/.config/goose/gooseberry.env` without printing secrets. The Goose user service listens on `127.0.0.1:3284`, the controller uses port 7312, and the browser service uses `127.0.0.1:8787`.

Before starting Compose, edit `compose.yaml` to add one read-only same-path mount for every directory that may be used as a project:

```yaml
volumes:
    - /absolute/path/to/project:/absolute/path/to/project:ro
```

The Compose default runs both containers as `1000:1000`. Change that value and the tmpfs ownership values together when the technical user has another numeric identity. The controller mounts `${HOME}/.config/goose` read-only. Do not mount Goose configuration or provider credentials into the browser service.

`.gooseberry` contains only the data path, Goose secret, and optional controller or browser authentication values. Controller and browser authentication both default to false. When either is enabled, set its corresponding strong token. Set `GOOSEBERRY_PUBLIC_ORIGIN` only when a trusted reverse proxy terminates TLS. Rerun setup after changing the Goose secret or browser authentication values, then restart the Goose user service and Compose services.

For local image development, add `--build` to the Compose command.
