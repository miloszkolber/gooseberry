# Models and providers

Goose is authoritative for provider configuration, credentials, authentication, model availability and catalog metadata. Gooseberry displays a sanitized projection and stores only model visibility.

## Catalog and metadata

The UI shows identifiers, names, availability, context/output limits, modalities, reasoning support and prices when Goose reports them. Canonical metadata lookup fills missing context/reasoning data and adds output limits and pricing; existing inventory values win. Missing or failed lookup leaves the base catalog usable.

Current lookups share a bounded concurrency limit and a projection deadline. Concurrent requests share in-flight work, not a persistent metadata cache. Prices are shown per million tokens in the reported currency only when input/output rates are finite and nonnegative. Absent cache rates are displayed as zero.

Hiding a model affects Gooseberry selection surfaces, not Goose's catalog, existing sessions or credentials.

## Selection and defaults

Per-session model and thinking controls use Goose configuration options. Settings can read, save or clear Goose's global provider/model default. A saved provider must be configured and available, but model IDs may be custom or null as allowed by Goose. New sessions use Goose's persisted default.

Agent sources expose the bounded upstream `model` model-ID preference, not a separate Gooseberry provider binding. Gooseberry does not introduce per-agent provider routing.

## Authentication and readiness

API-key setup and native OAuth/device-code flows are forwarded through authenticated ACP. Goose validates and persists credentials. Gooseberry masks secret fields on reads and forwards values only on explicit submission; it does not store or return provider secrets.

The focused readiness action is available only for inventory entries marked ACP-capable. Its browser response contains provider identity and `ready`/`hasIssue` booleans, not raw diagnostics. Provider and model views refresh from Goose; they are not an independently managed registry.
