# Security

Gooseberry is for one trusted user. Host Goose tools run with that user's permissions, including file and Git mutations.

## Isolation

The application mounts its state and admitted project roots. The browser mounts only its state and artifacts. Goose configuration and provider credentials stay on the host.

Both containers run non-root with read-only filesystems and bounded writable tmpfs. Browser subprocess environments are filtered; browser sessions share one UID and filesystem. Session IDs are not security identities.

Chromium uses `--no-sandbox`: its internal sandbox is disabled. Container/mount isolation does not replace it. Host networking permits access to local services; private-network and cloud-metadata egress restrictions are the operator's responsibility. Treat page content as untrusted.

## Credentials and access

| Connection | Credential |
| --- | --- |
| Goose ACP | Host `GOOSE_SERVER__SECRET_KEY`, matched by application `GOOSEBERRY_GOOSE_SECRET_KEY`. |
| Web UI | Optional `GOOSEBERRY_AUTH_ENABLED=true` and `GOOSEBERRY_TOKEN`; loopback authentication defaults off. |
| Browser MCP/HTTP/artifacts | Compose requires `GOOSEBERRY_BROWSER_TOKEN`. Goose and the application artifact proxy share it. |
| Objective/question MCP | Session-specific bearer token. |

Use distinct tokens. Protect environment/configuration files with mode `0600`; keep tokens out of prompts and agent instructions. The [MCP registration](deployment.md#browser-mcp) reads its header from Goose's private environment or secret store.

Remote controller access requires authentication unless `GOOSEBERRY_ALLOW_UNAUTHENTICATED_REMOTE=true` explicitly overrides it. Use HTTPS, `GOOSEBERRY_PUBLIC_ORIGIN` and a WebSocket-capable proxy. Origin checks use the exact public origin; cookies last 90 days.

Remote browser binding always requires authentication. Its MCP Host/Origin checks support `GOOSEBERRY_BROWSER_PUBLIC_ORIGIN` for a matching proxy. Standalone unauthenticated loopback is available for development.

## Data and operations

Provider setup forwards credentials to Goose and excludes them from replay, logs and snapshots. Settings responses omit raw extension commands, environment values, schemas and diagnostics.

Every file read checks admitted roots and resolved paths, including cached reads. Limits apply during I/O. Image delivery uses same-origin/no-store protections. Git runs with restricted configuration, hooks and filesystem monitors disabled.

Session operations verify project ownership. Permission/question replies are single-use. Agent edits recheck opaque source IDs, writability and project roots inside mutation locks; recipe saves retain Goose's security scan.

See [deployment](deployment.md) for private setup and backups, and [development](development.md) for boundary tests.
