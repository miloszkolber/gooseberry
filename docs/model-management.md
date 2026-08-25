# Model and provider management

## Ownership

Pi remains the source of truth for providers, models, credentials, authentication flows, availability, and catalog metadata. Mewa does not maintain a provider allowlist, copy provider implementations into the browser, or scrape a separate pricing database.

Mewa owns only the Web UI projection and persistent model visibility preferences.

## Providers

The Providers page is assembled from the union of:

- providers registered in Pi's runtime;
- provider identifiers referenced by Pi's model catalog;
- provider identifiers present in Pi's credential store.

This means built-in providers, `models.json` providers, and extension-registered providers can appear without Mewa-specific UI code.

For each provider, the UI shows its identifier, display name, model count, available-model count, and credential source where Pi reports it. OAuth and API-key controls appear only when that provider's Pi adapter exposes the corresponding login action. Providers configured through environment variables, `models.json`, commands, or extensions are shown as managed by Pi rather than being omitted.

Mewa does not define a generic custom-provider schema of its own. Custom provider definitions remain Pi configuration or extension code and appear automatically after Pi registers them.

## Models

The Models page projects every entry returned by Pi's model catalog, not only models that are currently usable. Availability is calculated separately from Pi's available-model snapshot.

Each model may expose:

- provider and model identifiers;
- display name;
- context-window size;
- maximum output-token count;
- supported input modalities reported by Pi (currently text and image);
- reasoning support and supported reasoning levels;
- availability under current credentials/provider state;
- input, output, cache-read, and cache-write price per one million tokens;
- request-size pricing tiers when Pi reports them.

Prices are displayed exactly from Pi's catalog metadata in US dollars per one million tokens. A zero value is displayed as `$0`; Mewa does not infer whether that represents a free model, a subscription-backed provider, or missing custom-model pricing, and it does not periodically scrape prices.

## Visibility

Users can hide or show an individual model and can hide or show the current catalog in bulk. Hidden model references are stored in Mewa state as `{ provider, id }` pairs.

Visibility is deliberately separate from availability:

- **hidden** means the user does not want the model shown in ordinary Mewa catalog/selection surfaces;
- **unavailable** means Pi cannot currently run the model with the active provider state.

Hiding does not delete a model, remove credentials, mutate Pi's catalog, rewrite Pi settings, or invalidate an existing session. Newly registered models are visible unless explicitly hidden.

## Refresh behavior

Opening the settings page reads Pi's current catalog and provider state. Manual refresh asks Pi to refresh provider catalogs with a bounded deadline and then returns the latest settled snapshot. Provider login/logout increments the UI provider generation so both provider and model views reload.

## Security

The browser receives only sanitized provider/model metadata and capability flags. OAuth tokens, API keys, credential payloads, provider implementation objects, and raw configuration files remain in the controller's Pi-owned state.
