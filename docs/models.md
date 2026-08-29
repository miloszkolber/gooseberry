# Models and providers

Goose is the source of truth for providers, models, credentials, authentication, availability, and catalog metadata. Gooseberry displays sanitized Goose data and stores only model visibility.

The UI may show provider/model identifiers, display names, availability, context and output limits, modalities, reasoning support, and pricing when Goose reports those fields. Missing metadata remains unavailable rather than being inferred. Gooseberry forwards API-key fields and native OAuth/device-code flows through ACP. Goose validates and stores credentials. Gooseberry does not retain credentials or implement provider runtimes.

Users can hide individual models from Gooseberry's catalog and selection surfaces. Per-session model and thinking controls use Goose selections. Visibility never modifies Goose's catalog or credentials. Existing sessions retain their Goose model references.

Provider and model views refresh from Goose. Secret values are masked when read, are sent only when the user submits provider setup, and are never persisted in Gooseberry state or returned to the browser.
