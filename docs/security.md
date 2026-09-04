# Security

Gooseberry is for one trusted user. Host Goose tools run with that user's permissions, including file and Git mutations.

## Isolation

The application mounts its state and admitted project root directories. The browser mounts only its state and artifacts. Goose configuration and provider credentials stay on the host.

Both containers run non-root with read-only filesystems, all capabilities dropped, new privileges disabled and bounded writable tmpfs. The application image has no shell or package manager. Browser subprocess environments are filtered; browser sessions share one UID and filesystem. Session IDs are not security identities.

Chromium uses `--no-sandbox`: its internal sandbox is disabled. Container/mount isolation does not replace it. Host networking permits access to local services; private-network and cloud-metadata egress restrictions are the operator's responsibility. Treat page content as untrusted.

Interactive App HTML runs inside a nested iframe served from the browser's separate origin. The browser service applies the resource's bounded CSP and permissions to a short-lived view ticket. Gooseberry sends no browser token, Goose secret or application credential into the sandbox; all tool and resource requests return to the application for same-session authorization.

## Credentials and access

| Connection | Credential |
| --- | --- |
| Goose ACP | Host `GOOSE_SERVER__SECRET_KEY`, matched by application `GOOSEBERRY_GOOSE_SECRET_KEY`. |
| Web UI | Optional `GOOSEBERRY_AUTH_ENABLED=true` and `GOOSEBERRY_TOKEN`; loopback authentication defaults off. |
| Browser MCP/HTTP/artifacts | Standalone Compose requires `GOOSEBERRY_BROWSER_TOKEN`; the application uses the MCP token instead when the optional host owns the same origin. |
| Optional MCP host | `GOOSEBERRY_MCP_TOKEN` authenticates the catalog and every published module; the application and Goose keep it in private environments. |
| Objective/question MCP | Session-specific bearer token. |

Use distinct tokens for Goose ACP, Web UI, standalone Browser and the optional MCP host. Protect environment/configuration files with mode `0600`; keep tokens out of prompts and agent instructions. The [MCP registration](deployment.md#standalone-browser-mcp) and the optional host setup read their headers from Goose's private environment or secret store.

Remote controller access requires authentication unless `GOOSEBERRY_ALLOW_UNAUTHENTICATED_REMOTE=true` explicitly overrides it. Use HTTPS, `GOOSEBERRY_PUBLIC_ORIGIN` and a WebSocket-capable proxy. Origin checks use the exact public origin; cookies last 90 days.

Remote browser binding always requires authentication. Its MCP Host/Origin checks and Interactive App URLs use `GOOSEBERRY_BROWSER_PUBLIC_ORIGIN` for a matching proxy origin, which must differ from the application origin. Standalone unauthenticated loopback is available for development.

The optional MCP host is an authenticated publication boundary. Its environment decides which modules exist in the catalog and route table; a Gooseberry UI toggle only changes Goose's global extension enablement and cannot publish a disabled module or stop a running service. In-process modules share the host's Browser trust boundary, so only co-host modules with the same operator and storage assumptions. A future module that needs project mounts or a different credential domain belongs behind a separately authenticated worker/sidecar instead.

## Data and operations

Provider setup forwards credentials to Goose and excludes them from replay, logs and snapshots. Settings responses omit raw extension commands, environment values, schemas and diagnostics.

Every file read checks the admitted project root and resolved paths, including cached reads. Limits apply during I/O. Image delivery uses same-origin/no-store protections. Git runs with restricted configuration, hooks and filesystem monitors disabled.

Session operations verify project ownership. Permission/question replies are single-use. Agent edits recheck opaque source IDs, writability and the project root inside mutation locks; recipe saves retain Goose's security scan.

See [deployment](deployment.md) for private setup and backups, and [development](development.md) for boundary tests.
