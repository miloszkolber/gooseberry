# Deployment

The supported setup is Linux with a native Goose systemd user service and **one host-networked `gooseberry` container**. Run the service, setup script and Compose as the same non-root technical user. Only installation of the system-wide Goose executable needs `sudo`.

## Prerequisites

- Linux x86-64 or arm64 with systemd user services.
- Docker Engine and its Compose plugin, accessible to the technical user.
- Git, GitHub CLI for private release access, and the installer's standard Linux tools: `curl`, `tar`, `sha256sum` and `mktemp`.
- A dedicated writable directory for Gooseberry state, and explicit access to the project directories you want Goose to use.

The Compose default is UID/GID `1000:1000`. Check `id -u` and `id -g`; when they differ, update `user` and the `uid`/`gid` values of all three tmpfs entries in `compose.yaml` together. State directories are private to this user. Avoid running Compose with `sudo`: it changes the home directory used for the Goose configuration mount.

## 1. Obtain the source and Goose binary

Authenticate an account that can read this repository and its releases:

```bash
gh auth login
gh repo clone miloszkolber/gooseberry
cd gooseberry
```

The two files `goose/version` and `goose/source-commit` define the required upstream release and source commit. Download the matching distribution with the authenticated GitHub CLI, then pass only local files to the privileged installer:

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

The installer checks the archive checksum, pinned provenance, safe archive contents and exact executable version before replacing `/usr/local/bin/goose`. It also installs the bundled agents and browser skill for the invoking `sudo` user. Use `GOOSE_HOME` only when deliberately installing configuration for another technical user. The temporary download directory can be removed after a successful installation.

A completed distribution release for the selected pin is required. A private release may appear missing when authentication lacks access; verify both access and the **Goose distribution** workflow result before retrying. Building the Gooseberry container does not build or install host Goose. For a publicly readable distribution, `sudo ./goose/install-goose.sh` can download the same verified files directly.

## 2. Configure state and mounts

```bash
cp .gooseberry.example .gooseberry
chmod 600 .gooseberry
```

Edit `.gooseberry` before continuing:

- Set `GOOSEBERRY_DATA_PATH` to a dedicated absolute directory. It must contain only Gooseberry's `app` and `browser` directories, not unrelated files.
- Replace `GOOSEBERRY_GOOSE_SECRET_KEY` with a random 32–256-character token. For example, `openssl rand -hex 32` produces a suitable value.
- Leave both services loopback-only for local use. If you enable controller or browser authentication, set the corresponding strong token; controller and browser tokens must be distinct.

Use plain `KEY=value` lines without shell commands, quoting or variable expansion. Setup accepts only the documented keys and rejects duplicate managed values.

Add every allowed project root to the `volumes` list in `compose.yaml`:

```yaml
- /absolute/path/to/project:/absolute/path/to/project:ro
```

The host and container paths must be identical: Goose runs on the host while the Web UI's read-only projections run in the container. A project may have several such roots. Mount only what you intend to expose; read-only prevents writes, not reads.

```bash
./scripts/setup-deployment.sh
```

Setup creates `app`, `browser/artifacts` and `browser/state` under the data directory. It writes `~/.config/goose/gooseberry.env` with mode `0600`, synchronizing the Goose secret and browser-skill connection settings while preserving unrelated entries. It neither starts services nor configures a model provider.

## 3. Start the services

```bash
install -Dm644 goose/systemd/goose.service ~/.config/systemd/user/goose.service
systemctl --user daemon-reload
systemctl --user enable --now goose.service
docker compose --env-file .gooseberry up -d --build --remove-orphans
```

This builds the single Gooseberry image locally and needs no GHCR login. It downloads pinned build tools inside the multi-stage build, not onto the host. If the user service must run without an active login session, an administrator can enable lingering with `sudo loginctl enable-linger "$USER"`.

Alternatively, use the published image when your account can read the GHCR package. Authenticate Docker to `ghcr.io` using a credential with package-read access and `--password-stdin`, then run:

```bash
docker compose --env-file .gooseberry pull gooseberry
docker compose --env-file .gooseberry up -d --no-build --remove-orphans
```

Repository access and package access are separate; a successful private Git clone does not prove Docker can pull the image.

Open `http://127.0.0.1:7312`. Configure a provider in Settings, choose defaults if needed and create a project from the mounted roots. Goose remains the credential store.

## Health and troubleshooting

| Check | Meaning |
| --- | --- |
| `curl -fsS http://127.0.0.1:7312/livez` | Application listener is alive. `/health` is also a liveness alias. |
| `curl -fsS http://127.0.0.1:7312/readyz` | Goose ACP is reachable with the configured credential. |
| `curl -fsS http://127.0.0.1:8787/health` | Browser API listener is alive; this does not start Chromium. |
| `systemctl --user status goose.service` | Host Goose service state. |
| `journalctl --user -u goose.service -n 100` | Recent Goose service logs. |
| `docker compose --env-file .gooseberry logs --tail=100 gooseberry` | Application and browser logs. |

The image health check requires both application and browser liveness. A Goose outage makes readiness fail without marking the container dead. Failure of either application listener stops the shared process; normal shutdown cancels work and closes both listeners.

If Goose is disconnected, check the user service, matching secret and setup-generated environment. If a root is missing, check its same-path mount and filesystem permissions. Do not print secrets into bug reports. See [security](security.md) for network and credential boundaries.

## External access

For a remote browser, prefer an SSH tunnel to the loopback application:

```bash
ssh -N -L 7312:127.0.0.1:7312 user@host
```

For a trusted reverse proxy, enable controller authentication, set a strong `GOOSEBERRY_TOKEN` and set `GOOSEBERRY_PUBLIC_ORIGIN` to the HTTPS origin. A non-loopback controller bind requires authentication unless the operator explicitly accepts the unsafe `GOOSEBERRY_ALLOW_UNAUTHENTICATED_REMOTE=true` mode. The proxy must support WebSockets. Public multi-user hosting is not a supported security model.

Host processes and trusted host-networked containers can use:

- Objective MCP: `http://127.0.0.1:7312/mcp/objective`, authenticated with its existing session-scoped bearer token. A controller login token is not an objective credential.
- Browser HTTP: `POST http://127.0.0.1:8787/v1/browser`, with the distinct browser bearer token when `GOOSEBERRY_BROWSER_AUTH=true`. This is not an MCP endpoint.

An ordinary bridge-networked container's loopback is its own, not the host's. Use the trusted host-network arrangement; do not solve connectivity by disabling authentication or publicly exposing the browser listener.

Chromium shares the application's UID and mounted filesystem, including read-only project and Goose configuration mounts. Filtered environments and bounded commands do not isolate browser workloads from those files.

## Updates and backups

[Release automation](goose.md) checks and builds upstream Goose, but does not update a running host or restart your services. Choose an update window, let active sessions settle and back up both the Goose user's configuration/state and the complete Gooseberry data directory. Follow-up queues are memory-only and are lost on restart.

Update the checkout, repeat the verified Goose installation for its pin, then run setup and restart:

```bash
./scripts/setup-deployment.sh
install -Dm644 goose/systemd/goose.service ~/.config/systemd/user/goose.service
systemctl --user daemon-reload
systemctl --user restart goose.service
docker compose --env-file .gooseberry up -d --build --remove-orphans
```

For published images, pull before `up --no-build` instead. Rerun setup whenever the Goose secret or browser authentication changes. Preserve the app/browser state mounts; removing a container does not remove those bind-mounted files.

The image defaults to `GOGC=200`, a measured controller-memory/CPU tradeoff. Override it through Compose `environment`, not `.gooseberry`'s small setup allowlist, only after target-host measurement. Browser-process memory is additional. See [development](development.md) for the latency gate and current measurement limits.
