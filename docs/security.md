# Security and trust model

Gooseberry is a trusted single-user development tool, not a multi-tenant sandbox. Goose and Gooseberry act with the permissions of the technical host user. Anyone with authenticated controller access can direct sessions within admitted project roots.

Goose runs `/usr/local/bin/goose serve --enable-scheduler` on loopback. `GOOSE_SERVER__SECRET_KEY` authenticates the ACP boundary, and `GOOSEBERRY_GOOSE_SECRET_KEY` is its controller-side counterpart. Gooseberry controller authentication uses `GOOSEBERRY_TOKEN` when `GOOSEBERRY_AUTH_ENABLED=true` (the default). Disable authentication only on loopback or a deliberately trusted LAN.

Compose runs controller and browser services with host networking. The controller has read-only admitted project mounts and Gooseberry app state. `gooseberry-browser` receives only its browser state and token, never project mounts, Goose state, or provider credentials. Browser HTTP operations are bounded and isolated, but destination-network policy remains an operator responsibility.

`${GOOSEBERRY_DATA_PATH}/gooseberry/app` contains Gooseberry state and `${GOOSEBERRY_DATA_PATH}/gooseberry/browser` contains browser artifacts/state. Goose credentials, settings, resources, sessions, recipes, and scheduler state remain in its normal technical-user home. Setup writes service-facing Goose credentials to `$HOME/.config/goose/gooseberry.env` mode `0600`, regardless of `XDG_CONFIG_HOME`, to match the static user-unit path. It also writes the technical user's UID/GID for Compose, which keeps host-mounted state and private runtime directories non-root. Keep the host account least-privileged and protect `.gooseberry`, Goose env files, and provider credentials.

Project roots must be absolute, admitted, and remain within their configured mounts after path resolution. File browsing is read only and bounded. Git is observational in Gooseberry; agents perform mutations through Goose tools.
