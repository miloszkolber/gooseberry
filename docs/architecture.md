# Architecture

```text
Gooseberry container                     Host
├─ controller :7312 ─────── ACP ───────── /usr/local/bin/goose
│  ├─ Web UI, projects, Git and files      ├─ sessions, providers and tools
│  └─ objectives/questions MCP            └─ recipes and scheduler
└─ browser :8787 ◀──── Goose browser skill
   └─ agent-browser and Chromium
```

The container uses host networking. One Go process serves both HTTP listeners; `main.go` starts and stops them together. A listener failure ends the process. Application liveness, Goose readiness and browser liveness are separate checks, so an unavailable Goose service does not look like a dead container.

## Code layout

| Directory | Responsibility |
| --- | --- |
| `controller/` | Goose ACP, browser requests, projects, objectives, files, Git and persistence. |
| `browser/` | Browser HTTP requests, command restrictions, processes, artifacts and quotas. |
| `webui/` | React presentation, navigation and drafts. |
| `contracts/` | Browser wire types and message validation. |

The Go service uses Coder's ACP SDK and WebSocket library, plus fsnotify. A small adapter converts the SDK's newline-delimited stream to Goose's WebSocket frames. The SDK handles JSON-RPC; Gooseberry does not implement another protocol stack.

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

Browser types describe the data the UI needs; they are not exported Go internals. There is no JavaScript backend, permanent language bridge or generic service layer.

## Image and browser process

The runtime image contains the executable, static UI, Git, Chromium, agent-browser, fonts, CA certificates, Tini and dependency licenses. It does not contain source, tests, compilers, Node, Bun or `node_modules`. Chromium and fonts account for much of the image size.

Browser state lives under `/var/lib/gooseberry-browser`. Artifact accounting is incremental, and polling slows down when state is unchanged. Each browser session gets its own home directory and a restricted environment, but all sessions share the container UID and filesystem. See [security](security.md).
