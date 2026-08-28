# Security and trust model

Gooseberry is a trusted single-user development tool, not a multi-tenant sandbox. Goose and Gooseberry act with the permissions of the technical host user.

Goose runs `/usr/local/bin/goose serve --enable-scheduler` on loopback. `GOOSE_SERVER__SECRET_KEY` authenticates ACP, and `GOOSEBERRY_GOOSE_SECRET_KEY` is its controller-side counterpart. Controller authentication is disabled by default. Set `GOOSEBERRY_AUTH_ENABLED=true` with a strong `GOOSEBERRY_TOKEN` before exposing the controller beyond a deliberately trusted network. Controller cookies last 90 days.

Browser API authentication is also disabled by default because the service binds to loopback. Set `GOOSEBERRY_BROWSER_AUTH=true` with a distinct strong `GOOSEBERRY_BROWSER_TOKEN` to require its bearer credential. The browser service receives only its browser state and optional browser token. It never receives project mounts, Goose configuration, or provider credentials. Browser HTTP operations are bounded and isolated, but destination-network policy remains an operator responsibility.

Compose mounts `${GOOSEBERRY_DATA_PATH}/app` at `/var/lib/gooseberry`, `${GOOSEBERRY_DATA_PATH}/browser` at `/var/lib/gooseberry-browser`, and `${HOME}/.config/goose` read-only at `/home/goose/.config/goose`. Setup writes the Goose service environment to `$HOME/.config/goose/gooseberry.env` with mode `0600` and preserves unrelated entries. Protect `.gooseberry`, Goose configuration, and provider credentials.

Projects use absolute directories that are visible through explicit read-only controller mounts. File browsing is bounded and read only. Git is observational in Gooseberry. Agents perform mutations through Goose tools.
