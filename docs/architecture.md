# Architecture

| Process | Location | Responsibility |
| --- | --- | --- |
| Goose, `:3284` | Host | Conversations, providers, tools and runtime configuration. |
| Application, `:7312` | `gooseberry` container | Web UI, projects, files, Git and objective/question MCP. |
| Browser, `:8787` | `gooseberry-browser` container | Browser MCP/HTTP, Chromium, artifacts and the App sandbox origin. |

The application connects to Goose over ACP and proxies authenticated browser artifacts. Goose calls the application and browser MCP endpoints. Interactive Apps render on the browser's separate origin while the application authorizes their access to Goose.

Both containers use host networking so they can reach host Goose over loopback. They have independent state, health checks and shutdown paths.

## Source layout

Paths are relative to `gooseberry/`.

| Path | Responsibility |
| --- | --- |
| `cmd/gooseberry/` | Application entry point. |
| `cmd/gooseberry-browser/` | Browser entry point. |
| `internal/controller/` | ACP, application HTTP/MCP and conversation lifecycle. |
| `internal/browser/` | Browser MCP/HTTP, process lifecycle, guidance and quotas. |
| `internal/workspace/` | Project roots, bounded file access, Git and filesystem watches. |
| `internal/persist/` | Atomic application state storage. |
| `internal/identifier/` | Random identifier generation. |
| `internal/diagnostics/` | Build information, counters and structured logging. |
| `webui/` | React frontend. |
| `contracts/` | Shared frontend wire types and validation. |
| `tests/` | Cross-package, frontend, deployment and compatibility tests. |

The two executables share one Go module. Coder's ACP SDK and WebSocket library handle agent communication; the MCP Go SDK handles browser MCP. React, Zustand, Radix, Virtuoso and Shiki provide the UI, state, accessible controls, virtualization and highlighting.

## State

Goose owns transcripts and runtime configuration. Gooseberry stores project/session associations, objectives, presentation settings and durable follow-up queues. JSON state uses atomic replacement and last-valid backups; execution queues fail closed rather than using a stale backup.

ACP replay returns a complete transcript. The controller keeps a bounded projection and sends the newest user-round page first. Earlier pages carry a projection identity so the browser cannot combine different replays. Active work and queued replies prevent eviction; inactive projections have count and memory limits.

Each browser reports its open chats as a revisioned lease. Reconnect generations, replay identities and deletion markers reject stale work. Startup queue recovery uses a small worker pool; live follow-ups are admitted immediately. Bounded output queues isolate slow clients.

## Images

The application image is assembled from scratch with a static Go executable, the Web UI and a pinned Git runtime. It has no shell or package manager. The browser uses Debian Trixie slim for its Go executable, agent-browser, Chromium, fonts and `tini`.

Both run as UID/GID `1000:1000` with read-only root filesystems. Only the application receives project mounts. See [deployment](deployment.md), [Goose and ACP](acp.md), and [security](security.md).
