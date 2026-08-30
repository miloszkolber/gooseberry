# Security and trust

Gooseberry is a trusted single-user development appliance, not a multi-tenant sandbox. Goose tools act with the technical host user's permissions. The container limits the Web UI's direct filesystem view, not the authority of the host agent.

## One container, shared filesystem

The controller and browser API run in one Go process and container. Chromium and agent-browser receive a fixed minimal environment and per-session home directories, not controller or Goose secrets as inherited environment variables. They nevertheless share the container UID and filesystem, including application state, project roots and the read-only Goose configuration mount.

Read-only prevents writes, not reads or exfiltration. Command restrictions, URL checks, output bounds and quotas are not an OS sandbox. Treat browser workloads as trusted; destination-network controls and protection of private-network or cloud-metadata endpoints remain the operator's responsibility. Mount only necessary project roots.

The final image runs as a non-root user with a read-only root filesystem and bounded writable tmpfs mounts. It has no application source or build runtimes. These are defense-in-depth measures, not tenant isolation.

## Credentials and network access

| Boundary | Credential and default |
| --- | --- |
| Host Goose ACP | `GOOSE_SERVER__SECRET_KEY`; controller uses the matching `GOOSEBERRY_GOOSE_SECRET_KEY`. Loopback only. |
| Browser-to-controller UI | Authentication is off for the default loopback listener. Enable `GOOSEBERRY_AUTH_ENABLED` and a strong `GOOSEBERRY_TOKEN` when needed. |
| Browser automation API | Independent `GOOSEBERRY_BROWSER_AUTH` and `GOOSEBERRY_BROWSER_TOKEN`; loopback and authentication off by default. |
| Objective/question MCP | Always uses its session-scoped bearer credential, not the controller or browser API token. |
| Model providers | Goose validates and persists credentials. Gooseberry forwards explicit setup requests without retaining the secrets. |

Controller and browser API tokens must be distinct. A non-loopback controller bind requires authentication unless the operator explicitly sets `GOOSEBERRY_ALLOW_UNAUTHENTICATED_REMOTE=true`. Do not use that escape hatch as normal remote setup. A trusted TLS reverse proxy should set `GOOSEBERRY_PUBLIC_ORIGIN`; controller requests retain same-origin checks. Controller cookies last 90 days.

Protect `.gooseberry`, the Goose user's home configuration/state and the Gooseberry data directory. Setup writes `~/.config/goose/gooseberry.env` with mode `0600` and preserves unrelated entries. Compose mounts Goose configuration read-only, which still makes it readable inside the shared container.

Submitted provider keys exist transiently in the browser/controller setup request and are forwarded over authenticated ACP. They are omitted from replay storage, logs and browser snapshots. Native OAuth/device-code values are projected without giving the browser access to Goose configuration. Use authenticated TLS before provider setup over a network.

## Files and Git

Projects are authorized against explicit same-path mounts. Reads resolve their root, reject escaping paths and symlinks, and enforce limits while reading. Cached metadata never replaces fresh path authorization. The HTTP file route serves only bounded image formats with no-store and same-origin protections; it is not a generic filesystem download endpoint.

Git views are observational. Git subprocesses receive a minimal environment, ignore global/system Git configuration and disable hooks and filesystem monitors. Repository discovery and command output are bounded, with root identity retained throughout. Goose tools, not these projections, perform mutations.

## Goose administration

Every session-scoped operation checks recorded project/session association and its admitted directory. Permissions and supporting-question replies are single-use; lifecycle and mutation guards prevent competing operations from bypassing those checks.

Extension and tool summaries omit raw commands, arguments, URLs, headers, environment data, client-secret keys, schemas and raw upstream warning text. Permission changes persist in Goose. Recipe/schedule inputs are size-bounded and validated; recipe saves retain Goose's security scan.

The agent editor accepts opaque source IDs, not browser-supplied paths. It re-resolves a fresh writable authorized source inside a mutation lock and permits project scope only through an explicitly selected admitted root. Instructions are bounded plain text; arbitrary source properties and supporting files remain controller-side.

Preferences expose only `autoCompactThreshold` and `gooseThinkingEffort`. Provider defaults validate a configured, available provider while preserving Goose's support for custom or null model IDs. Readiness checks return only sanitized booleans. Raw upstream errors and source paths are not a browser diagnostic API.

See [deployment](deployment.md) for supported network access and [development](development.md) for the security and concurrency fixtures.
