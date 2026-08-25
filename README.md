# Mewa Code

Mewa Code is a focused web interface for the Pi Coding Agent. The product baseline is [`docs/product-baseline.md`](docs/product-baseline.md).

## Run with Compose

Copy `.env.example` to `.env`, set separate controller and browser tokens, and start the controller plus isolated browser service:

```bash
cp .env.example .env
```

The controller publishes on `127.0.0.1:24242` by default. Read the baseline and [`docs/README.md`](docs/README.md) for scope and current documentation.

Open the UI with the controller token in a one-time URL fragment, for example `http://127.0.0.1:24242/#token=<MEWA_CODE_TOKEN>`. The UI saves the fragment in tab-scoped session storage and removes it from the address before opening its WebSocket. The token is never sent to `mewa-browser` or placed in a WebSocket URL query.

Compose requires an absolute `MEWA_WORKSPACE_PATH`, matching `MEWA_MOUNT_ROOTS`, and a pinned SSH key plus known-hosts file. Repository files stay on same-path mounts, while Pi bash and browser terminals execute through the configured host SSH account. See [`docs/architecture.md`](docs/architecture.md) and [`docs/security.md`](docs/security.md).

## Develop

The Bun workspace lives in [`mewa-code/`](mewa-code/). Follow [`mewa-code/README.md`](mewa-code/README.md) for local development checks.

## License

Licensed under the [Apache License 2.0](LICENSE). See [`NOTICE.md`](NOTICE.md) for attribution and provenance.
