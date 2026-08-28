# Models and providers

Goose is the source of truth for providers, models, credentials, authentication, availability, and catalog metadata. Gooseberry displays sanitized Goose data and stores only model visibility.

The UI may show provider/model identifiers, display names, availability, context and output limits, modalities, reasoning support, and pricing when Goose reports those fields. Missing metadata remains unavailable rather than being inferred. Gooseberry does not implement provider login or provider runtimes.

Users can hide individual models from Gooseberry's catalog and selection surfaces. Per-session model and thinking controls use Goose selections. Visibility never modifies Goose's catalog or credentials. Existing sessions retain their Goose model references.

Provider and model views refresh from Goose. Credentials and raw provider configuration remain outside the browser.
