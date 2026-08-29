# Roadmap

This file contains candidate improvements beyond the current Goose-based baseline. An item moves into [`baseline.md`](baseline.md) only when it is implemented and verified.

## Goose integration

- Concentrate Goose ACP conversions behind a small adapter and add a compatibility contract test for the methods Gooseberry uses.
- Expand Gooseberry projections only where Goose exposes stable, useful metadata.
- Evaluate focused administration surfaces for conversation truncation, session export/import, custom-provider administration, and additional provider diagnostics without creating parallel registries.
- Revisit catalog scope only when pinned Goose exposes a safe user-facing way to distinguish or manage additional agent source kinds. Do not infer skill or project `@` mentions from source lists. Goose v1.48.0's official agent-mentions endpoint currently emits agent, recipe, and subrecipe entries, although the UI accepts all documented source types for future compatibility.

## Deployment

- Provide optional managed TLS and identity configuration for deployments exposed beyond loopback.
- Provide an optional browser egress policy for private-network and cloud-metadata address ranges.

## Distribution

- Automate collection and packaging of applicable third-party notices for each published release format.
