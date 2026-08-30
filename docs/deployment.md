# Deployment

Run official upstream Goose on the host and the application and browser as two host-networked Compose services. Use the same non-root Linux user for Goose, the state directories and Compose.

## Requirements

- Linux x86-64 or arm64 with the libraries required by the official Goose CLI.
- Docker Engine and Compose, usable by your user.
- The supported upstream Goose release, recorded in [`upstream.json`](../gooseberry/tests/goose/upstream.json).
- A dedicated state directory and access to the project directories you want to admit.
- GitHub access for private repository or container downloads. You can build locally without GHCR access.

Clone the repository, using an authenticated account if required:

```bash
gh auth login
gh repo clone miloszkolber/gooseberry
cd gooseberry
```

## Install and configure Goose

Use the [official installation instructions](https://goose-docs.ai/docs/getting-started/installation/) or download the matching GNU Linux archive from [upstream releases](https://github.com/aaif-goose/goose/releases). Compare its SHA-256 digest with the artifact entry in `upstream.json` before extracting it. Install the executable in a location you manage, such as `~/.local/bin/goose`, and check `goose --version`.

Gooseberry supplies no Goose installer, updater, setup script or service unit. Do not put Goose configuration inside either container.

Give the service a random secret and the privacy settings below. Keep them in a private environment file, for example `~/.config/goose/service.env`, with mode `0600`:

```dotenv
GOOSE_SERVER__SECRET_KEY=replace-with-a-random-goose-secret
GOOSEBERRY_BROWSER_TOKEN=replace-with-a-different-random-browser-token
GOOSE_TELEMETRY_OFF=true
GOOSE_TELEMETRY_ENABLED=false
OTEL_SDK_DISABLED=true
```

Use `openssl rand -hex 32` to generate each token. The same two values go in `.gooseberry` below. Goose needs the browser token for its MCP extension; the browser never receives the Goose service secret. Leave Langfuse credentials unset unless you want tracing; [Goose](goose.md) explains the privacy boundary.

For a manual start, load the private file you wrote above. Keep it to simple `KEY=value` entries you trust, because the shell sources it:

```bash
(
  set -a
  . "$HOME/.config/goose/service.env"
  set +a
  exec goose serve --host 127.0.0.1 --port 3284 --enable-scheduler
)
```

The subshell keeps those exports out of your interactive shell. Compose does not configure the host process; an existing service manager can load the same values instead.

### Optional systemd user service

Create `~/.config/systemd/user/goose.service` yourself. This example assumes the binary is in `~/.local/bin`; change `ExecStart` if yours is elsewhere.

```ini
[Unit]
Description=Goose ACP service
After=network.target

[Service]
Type=simple
WorkingDirectory=%h
EnvironmentFile=%h/.config/goose/service.env
ExecStart=%h/.local/bin/goose serve --host 127.0.0.1 --port 3284 --enable-scheduler
Restart=on-failure
RestartSec=3
UMask=0077

[Install]
WantedBy=default.target
```

Start it with `systemctl --user daemon-reload` and `systemctl --user enable --now goose.service`. An administrator can enable lingering with `sudo loginctl enable-linger "$USER"` if it must run after logout. This is an example you own, not a unit managed by Gooseberry.

## Configure the containers

```bash
cp .gooseberry.example .gooseberry
chmod 600 .gooseberry
```

Set these values:

- `GOOSEBERRY_DATA_PATH`: a dedicated absolute directory. Keep your existing path when updating.
- `GOOSEBERRY_GOOSE_SECRET_KEY`: the host Goose service secret.
- `GOOSEBERRY_BROWSER_TOKEN`: a different strong random token for browser MCP, HTTP commands and artifacts.
- Optional controller login: `GOOSEBERRY_AUTH_ENABLED=true` and a third token in `GOOSEBERRY_TOKEN`.

Compose passes an explicit set of variables to each service. The browser gets no Goose secret, controller token or provider configuration. Browser authentication is always enabled in the supplied Compose file.

Check `id -u` and `id -g`. Compose defaults to `1000:1000`; if yours differ, update `user` and every tmpfs `uid`/`gid` value in both services. Create state directories as that user, using the same path you entered in `.gooseberry`:

```bash
gooseberry_data=/absolute/path/to/gooseberry-data
install -d -m 700 "$gooseberry_data/app" "$gooseberry_data/browser" \
  "$gooseberry_data/browser/artifacts" "$gooseberry_data/browser/state"
```

The app mounts only `app`; the browser mounts only `browser`. Existing contents stay in place. Bind mounts use `create_host_path: false`, so a missing source fails instead of creating a root-owned directory. Do not work around a permission error by running the containers as root.

Add each project root to the application's `volumes` list:

```yaml
- type: bind
  source: /absolute/path/to/project
  target: /absolute/path/to/project
  read_only: true
  bind:
    create_host_path: false
```

The two paths must match because Goose runs on the host and file/Git previews run in the application container. Add no project or Goose-configuration mounts to the browser service.

## Start and register browser MCP

```bash
docker compose --env-file .gooseberry up -d --build --remove-orphans
```

This builds both images locally. Build tools stay inside their build stages. For published images, authenticate Docker to `ghcr.io` with package-read access and `--password-stdin`, then use:

```bash
docker compose --env-file .gooseberry pull
docker compose --env-file .gooseberry up -d --no-build --remove-orphans
```

Register one remote Streamable HTTP extension in the same Linux user's Goose configuration. Merge this entry into the existing `extensions` mapping in `~/.config/goose/config.yaml`; do not replace other settings. See [upstream extension setup](https://goose-docs.ai/docs/getting-started/using-extensions/).

```yaml
extensions:
  gooseberry-browser:
    name: Gooseberry Browser
    type: streamable_http
    enabled: true
    uri: http://127.0.0.1:8787/mcp
    timeout: 130
    env_keys:
      - GOOSEBERRY_BROWSER_TOKEN
    headers:
      Authorization: 'Bearer ${GOOSEBERRY_BROWSER_TOKEN}'
```

Goose resolves `env_keys` from its process environment or secret store and expands the header value. The example therefore contains no token; keep the actual value in the private service environment above. Do not copy it into prompts or agent instructions. Restart Goose after changing its environment, and enable the extension in sessions that need it.

The `browser_command` tool carries essential instructions; detailed syntax is available from `browser_guidance` or the `gooseberry://browser/guide` resource. No host skill installation is needed.

Open `http://127.0.0.1:7312`, configure a provider in Settings and create a project from the mounted directories. Existing Goose agents, agent editing, mentions and session-scoped objective MCP work independently of the browser extension.

## Check the services

| Command | Checks |
| --- | --- |
| `curl -fsS http://127.0.0.1:7312/livez` | Application listener. `/health` is an alias. |
| `curl -fsS http://127.0.0.1:7312/readyz` | Controller's Goose ACP connection, not provider readiness. |
| `curl -fsS http://127.0.0.1:8787/health` | Browser listener, without starting Chromium. |
| `docker compose --env-file .gooseberry ps` | Independent application and browser container health. |
| `docker compose --env-file .gooseberry logs --tail=100 gooseberry browser` | Recent logs from both services. |
| `journalctl --user -u goose.service -n 100` | Goose logs, if using the example systemd service. |

A Goose outage fails application readiness without making the application container unhealthy. A browser outage does not stop the application or Goose, but browser calls and artifact reads will fail.

For a disconnected Goose service, check its process, port and matching secret. For browser failures, check the browser service, token and MCP registration. If you change `GOOSEBERRY_BROWSER_PORT`, also update `GOOSEBERRY_BROWSER_URL` and the private MCP URL. The application's browser URL accepts an HTTP(S) origin, without a path or credentials.

For missing project roots, check mounts and filesystem permissions. Keep environment files, tokens and raw provider responses out of bug reports.

## Access from another machine or service

An SSH tunnel keeps the application on loopback:

```bash
ssh -N -L 7312:127.0.0.1:7312 user@host
```

For a reverse proxy, enable controller authentication and set `GOOSEBERRY_PUBLIC_ORIGIN` to the HTTPS origin. The proxy must support WebSockets. A non-loopback controller bind requires authentication unless `GOOSEBERRY_ALLOW_UNAUTHENTICATED_REMOTE=true` explicitly disables that protection. Do not use this as a multi-user public service.

Browser MCP and HTTP use their own bearer token. If proxying them, set `GOOSEBERRY_BROWSER_PUBLIC_ORIGIN` and forward the matching public Host. A non-loopback browser bind requires authentication.

Trusted host processes and host-networked containers can use:

- Objective MCP at `http://127.0.0.1:7312/mcp/objective`, with its session-specific bearer token.
- Browser MCP at `http://127.0.0.1:8787/mcp`, with the browser bearer token.
- Browser commands at `http://127.0.0.1:8787/v1/browser` and artifacts under `/v1/artifacts/{session}/{name}`, with the same browser token.

Loopback in a bridge-networked container refers to that container, not the host. Browser state is separate from application state, but host networking still permits access to local services. Read [security](security.md) before exposing listeners or browsing untrusted content.

## Updates and backups

Back up Goose's private configuration/state and both directories under `GOOSEBERRY_DATA_PATH`. Let active sessions settle first; controller follow-up queues are memory-only and disappear on restart. Keep copies of the environment and private MCP configuration securely, since they contain tokens.

Update official Goose yourself, checking [compatibility](goose.md) before replacing it. Image builds and pulls never update the host binary.

The image workflow builds both architectures on relevant pushes and on Sundays at 04:37 UTC. Scheduled builds refresh runtime packages; they do not restart deployments. Source-commit tags remain available, and `latest` is promoted only while the built source is still the default-branch tip.

To update Gooseberry, update the checkout and rebuild both images with `up -d --build`, or pull published images and use `up -d --no-build`. Keep the existing state paths and mounts. Container removal does not remove the bind-mounted data. After rotating tokens, update every owner: Goose and the application for the Goose secret; browser, application and Goose's private environment or secret store for the browser token.

The application image sets `GOGC=200` to reduce collection work at the cost of some memory. Change it through Compose `environment` only after measuring your workload. Chromium uses separate browser-container memory. See [performance](performance.md).
