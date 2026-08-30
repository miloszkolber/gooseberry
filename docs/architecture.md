# Architecture

| Process | Location | Responsibility |
| --- | --- | --- |
| Goose, `:3284` | Host | ACP, conversations, providers, tools and runtime configuration. |
| Application, `:7312` | `gooseberry` container | Web UI, projects, files, Git and objective/question MCP. |
| Browser, `:8787` | `gooseberry-browser` container | Browser MCP/HTTP, Chromium sessions and artifacts. |

The application connects to Goose over ACP and proxies authenticated artifact reads to the browser. Goose calls objective/question MCP on the application and browser MCP on the browser service.

Both containers use host networking. Each runs its own Go executable and has its own health check and lifecycle. Application liveness, Goose readiness and browser liveness are separate checks, so an unavailable Goose service does not look like a dead application container.

## Code layout

| Path | Responsibility |
| --- | --- |
| `main.go` | Application entry point. |
| `cmd/browser/` | Browser-service entry point. |
| `controller/` | Goose ACP, Web UI requests, projects, objectives, files, Git and persistence. |
| `browser/` | Browser MCP/HTTP requests, embedded guidance, processes, artifacts and quotas. |
| `webui/` | React presentation, navigation and drafts. |
| `contracts/` | Frontend wire types and message validation. |

The executables share one Go module. The controller uses Coder's ACP SDK and WebSocket library, plus fsnotify; the browser uses the MCP Go SDK. A small adapter converts the ACP SDK's newline-delimited stream to Goose's WebSocket frames. The SDKs handle the protocols; Gooseberry does not implement another protocol stack.

ACP connection setup is shared between callers, with a separate deadline for each caller. A slow handshake cannot hold readiness checks past their deadline. Reset and shutdown cancel unfinished setup; unsupported negotiated protocol versions are rejected. ACP readiness confirms a connection, not that a provider can complete a prompt.

Goose owns its sessions and configuration. The controller stores project associations, objectives and presentation data, and asks Goose for current runtime information.

## State, paths and reconnects

Project roots have the same path on the host and in the container. Requests check the root and resolved path before reading, including when metadata comes from a cache. Files, diffs, links and watcher events carry their root or repository identity.

Application JSON stores use atomic replacement, synchronization and last-valid backups. Session records hold a project, working directory and optional fork parent, not a transcript. Project metadata can reuse a decoded value only when newly read bytes match; path and symlink checks still run.

Session copies have count and memory limits and can be reconstructed from Goose. Each browser sends a revisioned snapshot of its open chats; closing one browser's tab does not release another browser's chat. Disconnect cleanup waits for the reconnect grace period and outstanding replay work. Project closure releases that project's leases unless it has already reopened.

Active work, queued messages and pending replies prevent eviction. Inactive copies retain their measured byte size until an operation or notification changes them, so checking the budget does not repeatedly serialize unchanged histories. Follow-up queues are currently in memory only.

Several concurrency guards serve different purposes:

- Connection generations reject late events from a replaced ACP connection.
- Shared in-flight loads prevent duplicate session hydration.
- Deletion markers prevent late responses from restoring removed sessions.
- Request replay prevents a reconnect retry from executing the same operation twice.
- Request IDs remain unique when authentication replaces the browser transport.
- Hydration checks tab-close intent before installing a late history response.
- Ordered, limited output queues isolate slow browsers from other clients.

These are not interchangeable caches or duplicate state.

## Frontend

Components, state and helpers live together by responsibility: `chat/`, `workspace/`, `files/`, `settings/` and `connection/`. Shared UI lives in `components/`.

`store/app-store.ts` composes feature state into one Zustand store. Welcome data and actions that affect both session placement and runtime state update atomically. The application owns navigation subscriptions: they survive transient connection loss and are disposed on sign-out or application teardown.

Desktop and narrow layouts share one mounted file/change tree. Workspace subscriptions watch chat availability and streaming status, not every transcript chunk. React memoization skips unchanged Markdown. Radix handles accessible dialogs and menus, Virtuoso handles long lists, and Shiki loads highlighting grammars as needed.

Frontend types describe the data the UI needs; they are not exported Go internals. There is no JavaScript backend, permanent language bridge or generic service layer.

## Images and browser state

The application image contains its executable, static UI and Git. The browser image contains its executable, Chromium, agent-browser and fonts. Both include the certificates, process supervision and legal notices they need, without source, tests, compilers, Node, Bun or `node_modules`. Chromium and fonts account for much of the browser image's size.

Browser state lives under `/var/lib/gooseberry-browser`. It has no mount for project files, application state or Goose configuration. Artifact accounting is incremental, and polling slows down when state is unchanged. Each browser session gets its own home directory and a restricted environment, but all browser sessions share that container's UID and filesystem.

Browser MCP session IDs are explicit tool arguments, not Goose conversation IDs or MCP transport IDs. Reusing an ID keeps the same browser state; `close` cleans it up. Guidance is embedded in the browser service and available through MCP, without a host-installed skill. See [integration](integration.md) and [security](security.md).
