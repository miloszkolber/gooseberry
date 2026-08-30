# Models and providers

Goose owns providers, credentials and model metadata. Gooseberry stores visibility choices and displays names, limits, modalities, reasoning support and prices when supplied.

Metadata lookups share in-flight work and have bounded concurrency and deadlines. Failed enrichment leaves the base catalog usable. Prices require finite nonnegative values; missing cache rates display as zero.

Chat model/thinking choices use Goose configuration options. Settings can save or clear defaults for a configured, available provider. Agent model preferences also belong to Goose. Hiding a model affects selectors, not existing sessions.

API keys and OAuth/device-code setup travel through authenticated ACP. Goose validates and stores credentials; the UI masks reads. ACP-capable provider readiness exposes only identity, `ready` and `hasIssue`.

See [ACP coverage](acp.md) and [security](security.md).
