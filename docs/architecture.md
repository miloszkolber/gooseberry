# Architecture

| Process | Location | Owns |
| --- | --- | --- |
| Goose, `:3284` | Host | Conversations, providers, tools and runtime configuration. |
| Application, `:7312` | `gooseberry` container | Web UI, projects, files, Git and objective/question MCP. |
| Browser, `:8787` | `gooseberry-browser` container | Browser MCP/HTTP, Chromium, artifacts and the Interactive Apps sandbox origin. |

The application connects to Goose over ACP and proxies authenticated browser artifacts. Goose calls the two MCP endpoints. Interactive Apps render on the browser service's separate origin while the application mediates their access to Goose. Both containers use host networking, with independent health checks and shutdown.

## Source layout

Paths are relative to `gooseberry/`. Both executables share its Go module.

| Path | Responsibility |
| --- | --- |
| `main.go` | Application startup. |
| `cmd/browser/main.go` | Browser executable entry point; Go's `cmd/` convention keeps it separate from reusable package code. |
| `controller/` | ACP, application HTTP/MCP, projects and persistence. |
| `browser/` | Browser MCP/HTTP, guidance, process lifecycle and quotas. |
| `webui/` | React UI and feature state. |
| `contracts/` | Frontend wire types and validation. |

Coder's ACP SDK and WebSocket library handle Goose communication; the MCP Go SDK handles browser MCP. The framing adapter stays small. ACP setup shares work while preserving each caller's deadline and rejects unsupported protocol versions.

## State and concurrency

Goose stores transcripts. ACP replay has no range request, so the controller receives the complete authoritative transcript and exposes a bounded browser projection. The first response contains the newest user-round page; older pages load on demand. A projection identity prevents the browser from combining pages from different replays.

Gooseberry stores project/session associations, follow-up queues, mutation receipts, objectives and presentation settings. JSON writes use atomic replacement and last-valid backups; execution queues fail closed rather than running a stale backup. Cached project metadata requires matching freshly read bytes. Path authorization remains fresh.

Each Web UI client reports its open chats as a revisioned lease snapshot. Closing one client's tab preserves other clients' leases. Disconnect cleanup waits for reconnect grace and replay work; project closure checks for concurrent reopening.

Active work and pending replies prevent eviction. Durable queued or blocked work may shed its inactive transcript projection; inactive copies have count/memory limits and cache their encoded size until changed. A late update to an idle projection immediately reapplies those limits.

Connection generations, shared hydration, deletion markers, replay IDs and tab-close checks reject stale or duplicate work. Open chats refresh after reconnect. The newest transcript response stays ordered with live events until it is queued; immutable older pages release the session lock before encoding. Bounded output queues isolate slow clients.

## Frontend and images

Frontend responsibilities live in `chat/`, `workspace/`, `files/`, `settings/` and `connection/`. One Zustand store composes their state. Navigation subscriptions survive reconnects; desktop and narrow layouts share one activity tree. Radix, Virtuoso and Shiki provide accessible controls, virtualization and lazy highlighting. The MCP Apps bridge loads only when an interactive view opens.

The application image contains its executable, static UI and Git. The browser image contains its executable, agent-browser, Chromium and fonts. Runtime images are non-root and read-only, with build tools excluded.

Each container mounts its own state. Only the application mounts project roots, at their host paths. See [security](security.md) for browser isolation and [integration](integration.md) for session behavior.
