# Deployment

Run Goose as a Linux user service and Gooseberry in one host-networked container. Use the same non-root Linux user for setup, the service and Compose. Only installation of `/usr/local/bin/goose` needs `sudo`.

## Requirements

- A glibc-based Linux system on x86-64 or arm64, with the standard C/GCC runtime libraries and systemd user services.
- Docker Engine and Compose, usable by that user.
- Git, GitHub CLI for private downloads, and `curl`, `tar`, `sha256sum`, `mktemp`.
- A dedicated state directory and access to your project directories.

`docker-compose.yaml` defaults to UID/GID `1000:1000`. Check `id -u` and `id -g`; if they differ, change `user` and all three tmpfs `uid`/`gid` values together. Run setup without `sudo` so its state and service files belong to your user.

## Install Goose

Clone the repository using an account with access:

```bash
gh auth login
gh repo clone miloszkolber/gooseberry
cd gooseberry
```

Download the release selected by `goose/version`. The installer also checks the commit in `goose/source-commit`.

```bash
release_dir=$(mktemp -d)
goose_version=$(cat goose/version)
case "$(uname -m)" in
  x86_64|amd64) goose_arch=x86_64 ;;
  aarch64|arm64) goose_arch=aarch64 ;;
  *) echo "Unsupported architecture" >&2; exit 1 ;;
esac
gh release download "$goose_version" \
  --repo miloszkolber/gooseberry \
  --dir "$release_dir" \
  --pattern "gooseberry-goose-${goose_version}-linux-${goose_arch}.tar.gz" \
  --pattern SHA256SUMS \
  --pattern GOOSE-PROVENANCE
sudo env GOOSE_RELEASE_BASE="file://$release_dir" ./goose/install-goose.sh
```

This keeps GitHub credentials out of the privileged installer. The script verifies the files and executable before replacing `/usr/local/bin/goose`, then installs agents and the browser skill for the user who invoked `sudo`. Set `GOOSE_HOME` only when installing for another user. Remove the temporary download directory when you no longer need it.

If the release appears missing, check repository access and the **Goose distribution** workflow. Building the container does not install host Goose. Public releases can also be installed directly with `sudo ./goose/install-goose.sh`.

## Configure Gooseberry

```bash
cp .gooseberry.example .gooseberry
chmod 600 .gooseberry
```

Edit these values:

- `GOOSEBERRY_DATA_PATH`: a dedicated absolute directory, containing only the application's `app` and `browser` state.
- `GOOSEBERRY_GOOSE_SECRET_KEY`: a random token of 32–256 characters. `openssl rand -hex 32` generates a suitable value.
- Optional controller/browser authentication and their tokens. Keep the tokens distinct.

Use plain `KEY=value` lines, without shell expressions, quoting or variable expansion. Setup rejects unsupported keys and duplicate managed entries.

Add each allowed project root to the `volumes` list in `docker-compose.yaml`:

```yaml
- /absolute/path/to/project:/absolute/path/to/project:ro
```

The two paths must match because Goose runs on the host and the file UI runs in the container. Mount only directories you intend to expose.

```bash
./scripts/setup-deployment.sh
```

Setup creates application/browser state and writes `~/.config/goose/gooseberry.env` with mode `0600`. It synchronizes the Goose secret and browser-skill settings while preserving unrelated entries. It does not start services or configure providers.

Goose configuration stays on the host; the default Compose file does not mount it. Gooseberry reads and changes Goose settings through ACP.

## Start

```bash
install -Dm644 goose/systemd/goose.service ~/.config/systemd/user/goose.service
systemctl --user daemon-reload
systemctl --user enable --now goose.service
docker compose --env-file .gooseberry up -d --build --remove-orphans
```

This builds the image locally without a GHCR login. Build tools stay inside the build stages, not on your host. To keep the Goose user service running after logout, an administrator can enable lingering with `sudo loginctl enable-linger "$USER"`.

To use a published image instead, log Docker in to `ghcr.io` with package-read access and `--password-stdin`, then run:

```bash
docker compose --env-file .gooseberry pull gooseberry
docker compose --env-file .gooseberry up -d --no-build --remove-orphans
```

GitHub repository and GHCR package access are separate permissions.

Open `http://127.0.0.1:7312`, configure a provider in Settings and create a project from the mounted directories.

## Check the services

| Command | Checks |
| --- | --- |
| `curl -fsS http://127.0.0.1:7312/livez` | Application listener. `/health` is an alias. |
| `curl -fsS http://127.0.0.1:7312/readyz` | Controller's Goose ACP connection status, not provider readiness. |
| `curl -fsS http://127.0.0.1:8787/health` | Browser API listener, without starting Chromium. |
| `systemctl --user status goose.service` | Goose process state. |
| `journalctl --user -u goose.service -n 100` | Recent Goose logs. |
| `docker compose --env-file .gooseberry logs --tail=100 gooseberry` | Application and browser logs. |

Container health requires both HTTP listeners. A Goose outage fails readiness without making the container unhealthy. If either listener fails, the shared process exits.

For a disconnected Goose service, check the user service, matching secrets and setup-generated environment. For a missing project root, check the mount and filesystem permissions. Keep secrets out of bug reports.

## Access from another machine or service

An SSH tunnel keeps the application on loopback:

```bash
ssh -N -L 7312:127.0.0.1:7312 user@host
```

For a reverse proxy, enable controller authentication, set `GOOSEBERRY_TOKEN` and set `GOOSEBERRY_PUBLIC_ORIGIN` to the HTTPS origin. The proxy must support WebSockets. A non-loopback bind requires authentication unless `GOOSEBERRY_ALLOW_UNAUTHENTICATED_REMOTE=true` explicitly disables that protection. Do not use this as a multi-user public service.

Other host processes or trusted host-networked containers can use:

- Objective MCP at `http://127.0.0.1:7312/mcp/objective`, with its session-specific bearer token.
- Browser HTTP at `http://127.0.0.1:8787/v1/browser`, with the browser token when authentication is enabled. This is not MCP.

Loopback in a bridge-networked container refers to that container, not the host. Use the host-network arrangement rather than exposing an unauthenticated listener.

Chromium can read the container's mounted project files and application data. Read the [security guide](security.md) before using untrusted browser workloads.

## Update and back up

Release workflows publish binaries and images; they do not update your running host. Let active sessions settle and back up Goose's configuration/state and the complete Gooseberry data directory. Follow-up queues are memory-only and disappear on restart.

Update the checkout and install its selected Goose release, then run:

```bash
./scripts/setup-deployment.sh
install -Dm644 goose/systemd/goose.service ~/.config/systemd/user/goose.service
systemctl --user daemon-reload
systemctl --user restart goose.service
docker compose --env-file .gooseberry up -d --build --remove-orphans
```

For published images, pull before `up --no-build`. Rerun setup after changing secrets or browser authentication. Container removal does not delete the bind-mounted state.

The image sets `GOGC=200` to reduce collection work at the cost of some controller memory. Change it through Compose `environment`, not `.gooseberry`, after measuring your workload. Chromium uses additional memory. See [development](development.md).
