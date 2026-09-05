# Architecture

| Process | Location | Responsibility |
| --- | --- | --- |
| Goose, `:3284` | Host | Conversations, providers, tools and runtime configuration. |
| Application, `:7312` | `gooseberry` container | Web UI, projects, files, Git and objective/question MCP. |
| MCP host, `:8787` | `gooseberry-mcp` container | Authenticated MCP catalog and namespaced module routes; embeds Browser, Chromium, artifacts and the App sandbox origin. |

The application connects to Goose over ACP and proxies authenticated Browser artifacts and bounded browser-panel commands. The default deployment uses the MCP host as the only service on `:8787`. It publishes a catalog at `/v1/mcp/modules` and exposes each enabled module at `/<module-name>`; its first module is Browser at `/browser`. Gooseberry gives Goose one MCP host origin, discovers the catalog through the controller, and can add or toggle each published module as an independent Goose extension. Interactive Apps render on the Browser module's separate origin while the application authorizes their access to Goose.

The application and MCP host use host networking so they can reach host Goose over loopback. They have independent state, health checks and shutdown paths. The MCP host owns the Browser module in-process. Browser HTTP, artifact and `/mcp` compatibility routes remain available through the host.

## Source layout

Paths are relative to `gooseberry/`.

| Path | Responsibility |
| --- | --- |
| `cmd/gooseberry/` | Application entry point. |
| `cmd/gooseberry-mcp/` | MCP host entry point. |
| `internal/controller/` | ACP, application HTTP/MCP and conversation lifecycle. |
| `internal/browser/` | Embedded Browser module: MCP/HTTP, process lifecycle, guidance and quotas. |
| `internal/mcphost/` | Module registry, catalog, authentication and namespaced HTTP routing. |
| `internal/workspace/` | Project roots, bounded file access, Git discovery and filesystem watches. |
| `internal/persist/` | Atomic application state storage. |
| `internal/identifier/` | Random identifier generation. |
| `internal/diagnostics/` | Build information, counters and structured logging. |
| `webui/` | Svelte frontend, direct Bun build and pinned Mewa UI packages. |
| `contracts/` | Shared frontend wire types and validation. |
| `tests/` | Cross-package, frontend, deployment and compatibility tests. |

The two executables share one Go module. Coder's ACP SDK and WebSocket library handle agent communication; the MCP Go SDK handles Browser MCP. The host composes the Browser service and publishes its module catalog over HTTP. Svelte 5 provides component reactivity, a small framework-neutral external store owns browser state, Mewa UI provides foundations and browser-native interaction behaviors, and Shiki provides source highlighting. Bun compiles the frontend directly; there is no separate application bundler or development proxy.

`webui/vendor/mewa.lock.json` pins the Mewa UI, Svelte adapter and icon release archives, their sizes and SHA-256 identities, plus the selected icon set. Builds verify the complete vendored trees before compilation. `mewa:sync` replaces those trees transactionally from the recorded GitHub Release.

## State

Goose owns transcripts and runtime configuration, including global MCP extension enablement and per-session membership. Gooseberry stores project/session associations, objectives, presentation settings and durable follow-up queues. MCP publication is owned by the MCP host's environment; a Web UI toggle changes only Goose's global extension state and does not stop a published module. JSON state uses atomic replacement and last-valid backups; execution queues fail closed rather than using a stale backup.

ACP replay returns a complete transcript. The controller keeps a bounded projection and sends the newest user-round page first. Earlier pages carry a projection identity so the browser cannot combine different replays. Active work and queued replies prevent eviction; inactive projections have count and memory limits.

Each browser reports its open chats as a revisioned lease. Reconnect generations, replay identities and deletion markers reject stale work. Startup queue recovery uses a small worker pool; live follow-ups are admitted immediately. Bounded output queues isolate slow clients.

## Images

The application image is assembled from scratch with a static Go executable, the Web UI and a pinned Git runtime. It has no shell or package manager. Production CSS and JavaScript are precompressed during the Bun build and served as negotiated gzip representations by the controller. The MCP image uses Debian Trixie slim for its Go executable, agent-browser, Chromium, fonts and `tini`; it contains the embedded Browser module and no separate Browser executable. All published images carry OCI source, version, revision and creation metadata.

All service images run as UID/GID `1000:1000` with read-only root filesystems. Only the application receives project mounts; the Browser module keeps its state mount inside the MCP host. See [deployment](deployment.md), [Goose and ACP](acp.md), and [security](security.md).
