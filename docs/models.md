# Models and providers

Goose manages providers, credentials, model availability and catalog metadata. Gooseberry displays that information and stores the user's model-visibility choices.

## Catalog

The UI shows names, IDs, availability, context/output limits, modalities, reasoning support and prices when Goose reports them. Canonical metadata fills gaps in the inventory; a failed lookup leaves the base catalog usable.

Concurrent lookups share work under a request limit and deadline. Completed metadata is not cached. Prices use the reported currency per million tokens and require finite, nonnegative input/output rates. Missing cache rates display as zero.

Hiding a model changes Gooseberry's selectors. It does not remove the model from Goose or alter existing sessions.

## Choices and defaults

Chat model and thinking controls use Goose configuration options. Settings can save or clear Goose's global provider/model default. The provider must be configured and available; custom or null model IDs remain valid when Goose accepts them. New sessions use that default.

An agent can specify Goose's `model` preference. Gooseberry does not add separate per-agent provider routing.

## Authentication

API keys and native OAuth/device-code flows go through authenticated ACP. Goose validates and stores credentials. Gooseberry masks secrets when reading configuration and sends them only when the user submits setup.

Readiness checks are available for providers marked ACP-capable. The browser receives provider identity plus `ready` and `hasIssue`, not raw diagnostics.
