# Deployment

Gooseberry supports Linux x86-64 and arm64. It needs Docker Engine with Compose and the [supported official Goose release](acp.md#supported-goose-release).

## Goose

Install the GNU archive recorded in [`upstream.json`](../gooseberry/tests/goose/upstream.json), verify its SHA-256 and run `goose --version`. Keep Goose configuration and credentials on the host.

Disable Goose telemetry in `~/.config/goose/config.yaml`:

```yaml
telemetry_enabled: false
```

Create `~/.config/goose/service.env` with mode `0600`. Generate separate values with `openssl rand -hex 32`:

```dotenv
GOOSE_SERVER__SECRET_KEY=replace-with-a-random-goose-secret
GOOSEBERRY_BROWSER_TOKEN=replace-with-a-different-random-browser-token
```

Leave tracing credentials unset unless you use them. Start Goose on loopback; include the scheduler flag when you want schedule controls:

```bash
(
  set -a
  . "$HOME/.config/goose/service.env"
  set +a
  exec goose serve --host 127.0.0.1 --port 3284 --enable-scheduler
)
```

For automatic startup, use a user service manager to run the same command with this environment file. Keep tokens out of the service definition and preserve the `0600` mode.

## Containers

```bash
git clone https://github.com/miloszkolber/gooseberry.git
cd gooseberry
cp .gooseberry.example .gooseberry
chmod 600 .gooseberry
```

Set these values:

| Variable | Value |
| --- | --- |
| `GOOSEBERRY_DATA_PATH` | Absolute path to dedicated Gooseberry state. |
| `GOOSEBERRY_GOOSE_SECRET_KEY` | The same value as `GOOSE_SERVER__SECRET_KEY`. |
| `GOOSEBERRY_BROWSER_TOKEN` | The browser token from Goose's private environment. |
| `GOOSEBERRY_AUTH_ENABLED`, `GOOSEBERRY_TOKEN` | Optional Web UI login. Authentication is required for remote binding. |
| `GOOSEBERRY_BROWSER_PUBLIC_ORIGIN` | Exact external browser origin when proxied; it must differ from the application origin. |
| `GOOSEBERRY_IMAGE`, `GOOSEBERRY_BROWSER_IMAGE` | Optional immutable release or `sha-<revision>` image references for published deployments. |

Compose runs both containers as `1000:1000`. If the state owner uses another UID/GID, change `user` and the matching tmpfs ownership in both services.

```bash
gooseberry_data=/absolute/path/to/gooseberry-data
install -d -m 700 "$gooseberry_data/app" "$gooseberry_data/browser" \
  "$gooseberry_data/browser/artifacts" "$gooseberry_data/browser/state"
```

Add each project root to the application service in `docker-compose.yaml`. Keep the same absolute path inside the container:

```yaml
- type: bind
  source: /absolute/path/to/project
  target: /absolute/path/to/project
  read_only: true
  bind:
    create_host_path: false
```

The browser receives only its own state mount. Start both services:

```bash
docker compose --env-file .gooseberry up -d --build
```

To use published images instead, set both image variables to a release or `sha-<revision>` tag, run `docker compose --env-file .gooseberry pull`, then start with `--no-build`. The default `latest` tags are a convenience, not an immutable deployment reference.

## Browser MCP

Merge this entry into the existing `extensions` mapping in `~/.config/goose/config.yaml`:

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

Goose expands the header from its private environment or secret store. Restart Goose after environment changes and enable the extension in sessions that need it. `browser_command` performs automation; `browser_guidance` and `gooseberry://browser/guide` describe its use. The MCP and authenticated HTTP interfaces may also be used by trusted host-network services.

Open <http://127.0.0.1:7312>, configure a provider and create a project.

## Operations

| Request | Result |
| --- | --- |
| `http://127.0.0.1:7312/livez` | Application process is alive. |
| `http://127.0.0.1:7312/readyz` | State, UI files, ACP connection and required session capabilities are ready. |
| `http://127.0.0.1:8787/health` | Browser service is alive without starting Chromium. |
| `http://127.0.0.1:8787/readyz` | Browser executable, configuration and writable state are ready. |

`docker compose --env-file .gooseberry ps` shows container health. Logs are bounded to three 10 MiB files per service. A Goose outage makes application readiness fail without stopping the Web UI process.

Host networking is required for the loopback Goose and browser URLs; loopback inside a bridged container points back to that container. For remote use, configure Web UI authentication, HTTPS and separate exact application/browser origins. An SSH tunnel is the simplest way to keep the service on loopback.

Back up Goose configuration and state, `GOOSEBERRY_DATA_PATH` and the private environment files after active work settles. Restore them from the same backup point. Goose and Gooseberry update independently; preserve the state paths and check [compatibility](acp.md) before changing Goose.
