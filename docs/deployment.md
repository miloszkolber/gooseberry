# Deployment

Use Linux x86-64 or arm64, Docker Engine with Compose, and the official Goose CLI. GNU Goose needs glibc, libstdc++ and libgcc. Run Goose and own the state directories as the same non-root Linux user.

```bash
git clone https://github.com/miloszkolber/gooseberry.git
cd gooseberry
```

Use authenticated GitHub access when required. Local image builds need no GHCR login.

## Goose

Install the GNU archive listed in [`upstream.json`](../gooseberry/tests/goose/upstream.json), verify its SHA-256 and check `goose --version`. See [upstream installation](https://goose-docs.ai/docs/getting-started/installation/) and [compatibility](goose.md).

Create `~/.config/goose/service.env` with mode `0600`. Generate each secret separately with `openssl rand -hex 32`:

```dotenv
GOOSE_SERVER__SECRET_KEY=replace-with-a-random-goose-secret
GOOSEBERRY_BROWSER_TOKEN=replace-with-a-different-random-browser-token
GOOSE_TELEMETRY_OFF=true
GOOSE_TELEMETRY_ENABLED=false
OTEL_SDK_DISABLED=true
```

Leave Langfuse credentials unset unless you want tracing. For a manual start, source this trusted, simple `KEY=value` file:

```bash
(
  set -a
  . "$HOME/.config/goose/service.env"
  set +a
  exec goose serve --host 127.0.0.1 --port 3284 --enable-scheduler
)
```

Keep Goose configuration and credentials on the host.

## Containers

```bash
cp .gooseberry.example .gooseberry
chmod 600 .gooseberry
```

Set:

| Variable | Value |
| --- | --- |
| `GOOSEBERRY_DATA_PATH` | Dedicated absolute state directory. |
| `GOOSEBERRY_GOOSE_SECRET_KEY` | Goose's `GOOSE_SERVER__SECRET_KEY`. |
| `GOOSEBERRY_BROWSER_TOKEN` | Browser token from the Goose environment above. |
| `GOOSEBERRY_AUTH_ENABLED`, `GOOSEBERRY_TOKEN` | Optional UI login; use a third token. Required for authenticated remote access. |

Compose uses UID/GID `1000:1000`. Compare `id -u` and `id -g`; adjust `user` and every tmpfs `uid`/`gid` in both services if needed.

Create the state directories as that user, using your configured path:

```bash
gooseberry_data=/absolute/path/to/gooseberry-data
install -d -m 700 "$gooseberry_data/app" "$gooseberry_data/browser" \
  "$gooseberry_data/browser/artifacts" "$gooseberry_data/browser/state"
```

Each service mounts only its own state. `create_host_path: false` makes missing paths fail instead of creating root-owned directories.

Add admitted project roots to the application's `volumes` in `docker-compose.yaml`, with identical host/container paths:

```yaml
- type: bind
  source: /absolute/path/to/project
  target: /absolute/path/to/project
  read_only: true
  bind:
    create_host_path: false
```

The browser keeps only its state mount. Start both services:

```bash
docker compose --env-file .gooseberry up -d --build
```

For published images, authenticate to `ghcr.io` with package-read access, then run:

```bash
docker compose --env-file .gooseberry pull
docker compose --env-file .gooseberry up -d --no-build
```

## Browser MCP

Merge this entry into `~/.config/goose/config.yaml` under the existing `extensions` mapping:

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

Goose expands the header from its private environment or secret store. Keep token values out of agent instructions. Restart Goose after environment changes; enable the extension in sessions that need it.

`browser_command` provides automation. `browser_guidance` and `gooseberry://browser/guide` provide detailed instructions. Both MCP and HTTP routes are available to trusted host-network services; see [integration](integration.md).

Open **http://127.0.0.1:7312**, configure a provider and create a project.

## Health and access

| Request | Checks |
| --- | --- |
| `curl -fsS http://127.0.0.1:7312/livez` | Application liveness. |
| `curl -fsS http://127.0.0.1:7312/readyz` | Goose ACP connection, not provider readiness. |
| `curl -fsS http://127.0.0.1:8787/health` | Browser liveness without starting Chromium. |

For status and logs:

```bash
docker compose --env-file .gooseberry ps
docker compose --env-file .gooseberry logs --tail=100 gooseberry browser
```

Each container is independently healthy; Goose outages affect application readiness.

An SSH tunnel keeps the UI on loopback:

```bash
ssh -N -L 7312:127.0.0.1:7312 user@host
```

For remote access, configure authentication, HTTPS and the exact public origin as described in [security](security.md). Host networking is required for these loopback URLs; a bridge container's loopback points to itself.

Changing the browser port also requires matching `GOOSEBERRY_BROWSER_URL` and the private MCP URL. The application URL accepts an HTTP(S) origin without a path or credentials.

## Optional systemd service

Save as `~/.config/systemd/user/goose.service`, adjusting the executable path:

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

Run `systemctl --user daemon-reload` and `systemctl --user enable --now goose.service`. Inspect logs with `journalctl --user -u goose.service -n 100`. For operation after logout, an administrator can run `sudo loginctl enable-linger "$USER"`.

## Updates and backups

Back up Goose's configuration/state, the complete `GOOSEBERRY_DATA_PATH` and private environment files. Let active work settle; queued follow-ups are memory-only.

Update Goose independently after checking compatibility. Update the checkout and rebuild images, or pull and recreate the containers. Preserve the existing state paths. Image builds run on relevant pushes and Sundays at 04:37 UTC; deployment updates are manual.

When rotating secrets, update Goose and the application for the Goose secret; update Goose, application and browser for the browser token.
