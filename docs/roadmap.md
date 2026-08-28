# Roadmap

This file contains candidate improvements beyond the current Goose-based baseline. An item moves into [`baseline.md`](baseline.md) only when it is implemented and verified.

## Goose integration

- Concentrate Goose ACP conversions behind a small adapter and add a compatibility contract test for the methods Gooseberry uses.
- Expand Gooseberry projections only where Goose exposes stable, useful metadata.

## Deployment

- Provide optional managed TLS and identity configuration for deployments exposed beyond loopback.
- Provide an optional browser egress policy for private-network and cloud-metadata address ranges.

## Distribution

- Automate collection and packaging of applicable third-party notices for each published release format.
