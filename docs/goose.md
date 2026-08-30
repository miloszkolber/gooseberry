# Goose

Gooseberry uses the official [Goose CLI](https://github.com/aaif-goose/goose/releases), installed and managed by the user. It does not build, patch, install or update Goose. The upstream binary keeps its normal features, including the explicit `goose update` command; running `goose serve` does not automatically install updates.

## Compatibility

[`upstream.json`](../gooseberry/tests/goose/upstream.json) records the supported release and the official GNU Linux arm64 and amd64 archive names and SHA-256 hashes. Use it when choosing a download; a moving `latest` release may not match the integration checks. Follow the [upstream installation guide](https://goose-docs.ai/docs/getting-started/installation/) and verify `goose --version` before starting the service.

Use the GNU archives rather than a reduced musl build to retain the upstream tools and features this integration expects.

Goose owns conversations, providers, credentials, models, tools, permissions, agents, recipes and schedules. Gooseberry uses ACP and supported Goose methods instead of reading their backing stores or maintaining competing registries. [ACP coverage](acp.md) describes the exposed controls and limits.

The compatibility probe under `gooseberry/tests/goose` checks authentication, selected session/provider/settings responses and reconnect persistence against an isolated service. It does not prove every provider, prompt or tool works. See [development](development.md) for the command and test boundaries.

## Privacy and configuration

Set these in the environment that starts Goose, not the application or browser container:

```dotenv
GOOSE_TELEMETRY_OFF=true
GOOSE_TELEMETRY_ENABLED=false
OTEL_SDK_DISABLED=true
```

These disable runtime telemetry through the supported controls; they do not remove features from the upstream binary. Langfuse has separate credentials and configuration: leave them unset unless you deliberately want tracing. Model-provider requests and tools still make the network calls needed for your work.

Keep provider credentials, the service secret and browser MCP registration in private host configuration. Gooseberry installs no agents or skills. Existing user agents remain yours to edit and use; objective/question MCP remains session-scoped. Browser tools and guidance come from the browser MCP service.

## Updates

Choose when to update Goose independently of the Gooseberry images. Back up its configuration and state, check the supported release record, and stop the service before replacing the binary. Restart it and check ACP readiness afterward. Updating this checkout or pulling images never changes the host binary.

The [deployment guide](deployment.md) includes an optional systemd example, manual state-directory setup and browser MCP registration.
