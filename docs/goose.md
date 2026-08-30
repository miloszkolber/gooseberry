# Goose

Install and manage the official [Goose CLI](https://github.com/aaif-goose/goose/releases) on the host. [`upstream.json`](../gooseberry/tests/goose/upstream.json) records the supported release, GNU Linux arm64/amd64 archives and SHA-256 hashes. Choose GNU artifacts to retain the upstream tools and features this integration expects.

Goose owns conversations, models, tools, permissions and configuration. [ACP coverage](acp.md) describes Gooseberry's controls and compatibility limits.

## Privacy and updates

The [service environment](deployment.md#goose) disables runtime telemetry through `GOOSE_TELEMETRY_OFF=true`, `GOOSE_TELEMETRY_ENABLED=false` and `OTEL_SDK_DISABLED=true`. Leave Langfuse credentials unset unless you want tracing. Providers and tools make the network calls needed for your work.

Keep credentials and MCP registration private. Update Goose independently of the containers, checking compatibility and backing up its state first. The official CLI's `goose update` command is available; service updates are user-controlled.

See [deployment](deployment.md) for setup and [development](development.md) for the isolated compatibility probe.
