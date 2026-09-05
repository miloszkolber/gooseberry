# Gooseberry MCP

`gooseberry-mcp` is an authenticated service for trusted MCP clients. Browser is its only compiled-in module. See [deployment](deployment.md#mcp-host-and-browser-module) for containers, configuration and Goose registration, and [security](security.md) for credentials and isolation.

## Check the service

Run this on the deployment host after setup. It reads the private Goose environment in a subshell and passes the token through standard input, not curl's command-line arguments. Keep shell tracing off. Set `GOOSEBERRY_MCP_URL` first if the address differs; when a public origin is configured, use that origin through its proxy.

```bash
(
  set +x
  set -eu
  . "$HOME/.config/goose/service.env"
  mcp_origin=${GOOSEBERRY_MCP_URL:-http://127.0.0.1:8787}
  for endpoint in /v1/mcp/modules /readyz; do
    printf 'Authorization: Bearer %s\n' "$GOOSEBERRY_MCP_TOKEN" |
      curl --silent --show-error --fail-with-body --max-time 10 \
        --header @- "${mcp_origin%/}${endpoint}"
    printf '\n'
  done
)
```

The catalog should contain `browser` with state `ready`. `/health` (also `/livez`) and the container healthcheck prove liveness only. `/readyz` checks published modules; Browser checks executable/configuration availability and writable storage, without launching Chromium. An empty catalog is also ready. To verify browsing, open a disposable Browser panel, navigate to a known page, take a screenshot and close the panel.

| Symptom | Check |
| --- | --- |
| Connection refused | MCP container logs, bind address and port; bridged-container loopback is not host loopback. |
| `401 unauthorized` | Shared token, request Host and any Origin header. A proxy must preserve the configured public host; never follow redirects with the token. |
| `503` from `/readyz` | Read the catalog's module states, then authenticated `/status` for Browser's individual readiness checks. Check storage ownership and container logs. |
| Browser missing or `404` | Publication lists below; a disabled module has no MCP or compatibility routes. |
| Tools reports a conflict | Remove the conflicting Goose extension, then enable the discovered module as described in [setup](deployment.md#mcp-host-and-browser-module). |

## Catalog contract

The catalog is Gooseberry-specific JSON, not an MCP endpoint. Use `GET /v1/mcp/modules` with `Authorization: Bearer <token>`, then connect an MCP Streamable HTTP client to the same origin plus the module's `path`.

| Field | Meaning |
| --- | --- |
| `schemaVersion` | Currently `1`; reject unsupported versions. |
| `revision` | Opaque fingerprint of published module descriptors, not a build version or readiness counter. Refresh before retrying a rejected stale-catalog UI change. |
| `gateway` | `state`: `ready` or `degraded`; optional human-readable `detail`. |
| `modules[]` | Sorted by `id`; each has `id`, `extensionName`, `displayName`, `description`, `path`, `transport`, `state` and optional `detail`. |

Browser uses `id: browser`, `extensionName: gooseberry-browser`, `path: /browser` and `transport: streamable_http`. Module states are `ready` or `unavailable`. Parse states rather than human-readable details.

The catalog returns `200` even when degraded; `/readyz` returns the same shape with `200` or `503`. `GET /v1/mcp/status` returns `build`, `startedAt` and `catalog`. Host JSON responses are `no-store`. Host-level errors use `{"code":"unauthorized"}` (`401`), `{"code":"not_found"}` (`404`), or `{"code":"method_not_allowed"}` (`405`, with `Allow`). Module endpoints retain their own MCP/HTTP responses.

## Publication and Browser limits

`GOOSEBERRY_MCP_MODULES` is a comma-separated allowlist, defaulting to `browser`; `GOOSEBERRY_MCP_DISABLED_MODULES` subtracts from it. IDs are case-sensitive; unknown, duplicate or empty list entries reject startup. Recreate the container after environment changes. In Compose, an empty allowlist falls back to `browser`; set the disable list to `browser` to publish none. Goose's Tools toggle changes extension enablement, not publication.

Browser's [compiled limits](../gooseberry/internal/browser/service.go) are separate from Compose's configurable memory/CPU/process ceilings:

| Limit | Value |
| --- | --- |
| Sessions | 16 |
| Artifacts | 64 MiB per session; 256 MiB across sessions |
| State | 256 MiB and 20,000 entries per session |
| Command / Browser HTTP request | 120 seconds; host HTTP read/write timeout is 130 seconds |

These limits have no environment overrides. Close unused sessions and remove unneeded artifacts when capacity is exhausted. Browser tool usage is described by `browser_guidance` and `gooseberry://browser/guide`.

## Controller panel leases

Controller-owned Web UI panels have a five-minute lease. The controller renews live panels every minute; browser commands also renew their lease. The Browser service checks expiry every 30 seconds with up to four cleanup workers. Active commands hold the session lock and cannot be closed by expiry; unsuccessful closes retain runtime addressing and retry. The lease marker survives Browser service restarts. Ordinary MCP/HTTP sessions are unleased and remain under their caller's control. Closing a panel explicitly remains immediate.

This is a Gooseberry HTTP lifecycle protocol, not standard ACP or MCP. The application opts in when it first creates a random `b-<18 lowercase hex digits>` session by adding `X-Gooseberry-Panel-Lease: 1` to `POST /v1/browser`. An existing unleased session cannot be adopted this way. The service writes a `.controller-lease` marker in that session's state directory; its modification time records renewal. The marker is not a credential or a security identity.

`POST /v1/browser/leases` accepts `{"sessions":["b-0123456789abcdef01"]}` under the same bearer-token authentication policy as Browser HTTP commands. It accepts at most 16 unique panel IDs and no other fields. The `200` response contains `{"renewed":[...]}` for the existing marked sessions actually renewed. Unknown, unleased or currently busy sessions are omitted; renewal creates no session and starts no browser. A busy command renews on completion. The controller never renews recovered orphan entries or panels being closed.

A controller-to-Browser outage lasting beyond the lease can discard a panel's transient browser state. The controller ownership journal still supports startup cleanup, including panels created by an older service without leases. An older Browser service does not provide expiry; deploy the matching application and MCP image pair for the complete lifecycle. Existing unmarked sessions are never inferred to be abandoned from their name alone.

## Add a module

Modules are compiled into the service; adding one requires rebuilding the MCP image.

1. Implement `Descriptor`, `ServeHTTP`, `Ready` and `Shutdown`, and register the factory in [`internal/mcphost/host.go`](../gooseberry/internal/mcphost/host.go). Release partially created resources if initialization fails.
2. Use a unique lowercase kebab-case ID, a stable Goose extension name, `path: /<id>` and `transport: streamable_http`. Reserved host routes cannot be used. The host authenticates and dispatches the full path; the module owns any path rewriting.
3. Keep readiness inexpensive and shutdown safe for repeated calls. Reuse the host's credential/origin boundary; services needing different mounts or authority belong behind a separately authenticated worker, as described in [security](security.md).
4. Test publication/disable lists, catalog identity/revisions, routing, authentication/origin rejection, readiness and cleanup, plus controller discovery/toggling and a real MCP exchange. Follow the [development checks](development.md#checks) and image acceptance guidance; document the module's setup and limits here.
