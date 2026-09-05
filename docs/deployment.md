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
GOOSEBERRY_MCP_TOKEN=replace-with-a-random-mcp-token
```

The MCP token is used by the Gooseberry application, the MCP host and any Goose extension registered for the embedded Browser module. Keep it in this private environment and in the private `.gooseberry` file; do not put it in prompts or checked-in configuration.

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
| `GOOSEBERRY_MCP_TOKEN` | Strong token shared by the MCP host, application and private Goose extension environment. |
| `GOOSEBERRY_AUTH_ENABLED`, `GOOSEBERRY_TOKEN` | Optional Web UI login. Authentication is required for remote binding. |
| `GOOSEBERRY_MCP_URL` | MCP host origin; defaults to `http://127.0.0.1:8787`. |
| `GOOSEBERRY_IMAGE`, `GOOSEBERRY_MCP_IMAGE` | Optional immutable `sha-<revision>` or release image references. |
| `GOOSEBERRY_MCP_HOST`, `GOOSEBERRY_MCP_PORT`, `GOOSEBERRY_MCP_PUBLIC_ORIGIN` | MCP bind and exact public origin; defaults to authenticated loopback on `127.0.0.1:8787`. The public origin must differ from the application origin. Match `GOOSEBERRY_MCP_URL` to any bind-port change. |
| `GOOSEBERRY_MCP_MODULES`, `GOOSEBERRY_MCP_DISABLED_MODULES` | Optional publication ceiling and environment-level disable list. Unknown or duplicate module IDs fail closed. |
| `GOOSEBERRY_MEMORY_LIMIT`, `GOOSEBERRY_CPU_LIMIT`, `GOOSEBERRY_PIDS_LIMIT` | Optional application ceilings; defaults are 1 GiB, 2 CPUs and 256 processes. |
| `GOOSEBERRY_MCP_MEMORY_LIMIT`, `GOOSEBERRY_MCP_CPU_LIMIT`, `GOOSEBERRY_MCP_PIDS_LIMIT` | Optional MCP host ceilings; defaults are 2 GiB, 2 CPUs and 512 processes. |

Compose runs both containers as `1000:1000`. If the state owner uses another UID/GID, change `user` and the matching tmpfs ownership in both services.

```bash
gooseberry_data=/absolute/path/to/gooseberry-data
install -d -m 700 "$gooseberry_data/app" "$gooseberry_data/browser" \
  "$gooseberry_data/browser/artifacts" "$gooseberry_data/browser/state"
```

The `browser` state directory is retained as the stable storage location for the embedded Browser module. The MCP host receives only this state mount; it receives no project roots, application state or Goose configuration mounts.

Add each project root to the application service in `docker-compose.yaml`. Keep the same absolute path inside the container:

```yaml
- type: bind
  source: /absolute/path/to/project
  target: /absolute/path/to/project
  read_only: true
  bind:
    create_host_path: false
```

Start the application and MCP host together:

```bash
docker compose --env-file .gooseberry up -d --build
```

To use published images instead, set `GOOSEBERRY_IMAGE` and `GOOSEBERRY_MCP_IMAGE` to a release or `sha-<revision>` tag, run `docker compose --env-file .gooseberry pull`, then start with `--no-build`. The default `latest` tags are a convenience, not an immutable deployment reference.

## MCP host and Browser module

The `gooseberry-mcp` image embeds the Browser module. It publishes a versioned catalog at `/v1/mcp/modules`, exposes Browser at `/browser`, and keeps the Browser `/mcp`, HTTP and artifact compatibility routes. Modules use the `[origin]/[module-name]` shape.

Gooseberry discovers the catalog through the controller. The Tools settings section can add or toggle each discovered module in Goose. A UI disable changes Goose's global extension state only; it does not stop or hide a module published by the host. `GOOSEBERRY_MCP_DISABLED_MODULES` is the stronger environment-level publication control and removes a module from the catalog and route table. A manually configured Goose extension with the same name but a different endpoint or credential is shown as a conflict; remove it before enabling that module from Tools so Goose stores the host credential.

If you need to register the Browser module manually, merge this entry into the existing `extensions` mapping in `~/.config/goose/config.yaml`:

```yaml
extensions:
  gooseberry-browser:
    name: Gooseberry Browser
    type: streamable_http
    enabled: true
    uri: http://127.0.0.1:8787/browser
    timeout: 130
    env_keys:
      - GOOSEBERRY_MCP_TOKEN
    headers:
      Authorization: 'Bearer ${GOOSEBERRY_MCP_TOKEN}'
```

`gooseberry-browser` identifies the Browser module inside Goose; its endpoint is the MCP host's `/browser` route. Restart Goose after environment changes and enable the extension in sessions that need it. `browser_command` performs automation; `browser_guidance` and `gooseberry://browser/guide` describe its use. The MCP and authenticated HTTP interfaces may also be used by trusted host-network services.

Open <http://127.0.0.1:7312>, configure a provider and create a project.

## Operations

| Request | Result |
| --- | --- |
| `http://127.0.0.1:7312/livez` | Application process is alive. |
| `http://127.0.0.1:7312/readyz` | State, UI files, ACP connection and required session capabilities are ready. |
| `http://127.0.0.1:8787/health` | MCP host is alive without starting Chromium. |
| `http://127.0.0.1:8787/readyz` | Authenticated MCP catalog and embedded Browser module are ready. |
| `http://127.0.0.1:8787/v1/mcp/modules` | Authenticated MCP host catalog. |
| `http://127.0.0.1:8787/v1/mcp/status` | Authenticated MCP host build and module diagnostics. |

`docker compose --env-file .gooseberry ps` shows container health. Logs are bounded to three 10 MiB files per service, and both containers have configurable memory, CPU and process ceilings. A Goose outage makes application readiness fail without stopping the Web UI process.

Host networking is required for the loopback Goose and MCP URLs; loopback inside a bridged container points back to that container. For remote use, configure Web UI authentication, HTTPS and separate exact application/MCP origins. An SSH tunnel is the simplest way to keep the service on loopback.

Back up Goose configuration and state, `GOOSEBERRY_DATA_PATH` and the private environment files after active work settles. Restore them from the same backup point. Goose and Gooseberry update independently; preserve the state paths and check [compatibility](acp.md) before changing Goose.
