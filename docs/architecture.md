# Architecture

```text
One Gooseberry container                 Native host Goose
├─ controller :7312 ─────── ACP ───────── /usr/local/bin/goose
│  ├─ Web UI, projects, Git and files      ├─ providers, sessions and tools
│  └─ objectives/questions MCP            └─ recipes, scheduler and permissions
└─ browser :8787 ◀──── lazy Goose skill
   └─ native agent-browser and Chromium
```

Goose runs as a host user service. The host-networked container contains one Go process with two HTTP listeners. `gooseberry/main.go` owns startup and shutdown; failure of either listener stops the application. `/livez` reports application liveness, `/readyz` reports Goose ACP reachability, and the image health check requires both application and browser liveness.

## Ownership

| Owner | Responsibilities |
| --- | --- |
| Host Goose | Canonical sessions and history, providers and credentials, models, tools, permissions, agents, recipes and scheduler state. |
| `controller/` | Goose ACP adaptation, authorized browser requests, project roots, objectives, bounded file/Git projections and presentation metadata. |
| `browser/` | Browser HTTP command policy, authentication, per-session process state, output bounds and artifact quotas. |
| `webui/` | Navigation, drafts and presentation; it is not a second authority for Goose state. |
| `contracts/` | The narrow browser protocol and validation, not a dump of internal Go structures. |

The controller uses Coder's ACP SDK and WebSocket library. A small framing adapter bridges the SDK's newline-delimited stream to Goose's WebSocket messages; it does not implement JSON-RPC. Native filesystem events use fsnotify. The Go module has three direct dependencies; versions are pinned in `gooseberry/go.mod`.

## State and authorization

Projects consist of admitted roots with optional display names and icons. Files, Markdown links, image URLs, diffs and filesystem events carry their owning root or repository. Read-only same-path mounts make the controller's paths agree with Goose's host working directories. Every path is authorized at the request boundary, including when metadata or discovery results are cached.

Application state is mounted at `/var/lib/gooseberry`. Project/configuration data, project-session association and objectives use bounded atomic JSON replacement, synchronization and last-valid backup recovery. Session records contain association, working directory and optional immediate fork parent; Goose remains the transcript store. Fresh project-file bytes may reuse their validated decoded representation, but root and symlink authorization is still fresh.

Browser tabs lease controller projections. Inactive projections are bounded by count and approximate transcript bytes and reload from Goose. Active work, queues and pending user replies retain their projections. Follow-up queues deliberately live only in controller memory because the pinned Goose ACP boundary has no queue-manipulation method.

Connection generations, single-flight session hydration and deletion tombstones protect different races. Request replay retains execution identity across reconnects so retrying an operation does not execute it twice. Browser outputs are ordered and bounded; a slow consumer is disconnected without blocking other clients. These guards are retained even when other duplicated state is removed.

## Frontend organization

- `chat/` owns session presentation, event reduction, permissions and supporting questions.
- `workspace/` owns project navigation, root-qualified tabs, placement, persistence and lifecycle reconciliation.
- `files/` owns file/Git browsing, previews, diffs and live-content helpers.
- `settings/` owns provider/model administration, preferences and provider-login state.
- `connection/` owns controller authentication, socket handling and reconnect behavior.
- `components/` holds shared UI and accessible primitives.

`store/app-store.ts` composes the feature state creators into one Zustand store and installs welcome snapshots atomically. Cross-feature actions that change session placement and runtime state together stay atomic. The authenticated application effect owns and disposes navigation subscriptions. Desktop and narrow layouts share one mounted file/change activity tree. Workspace subscriptions observe chat availability and streaming state, not transcript chunks; unchanged Markdown uses ordinary React memoization.

Radix dialogs and menus, Virtuoso virtualization and Shiki highlighting remain library responsibilities. A wire-type generator is worthwhile only for genuinely identical duplicated structures: current projections are small and constrained, so they remain explicit. There is no JavaScript backend, language bridge or forwarding-only service layer.

## Packaging and browser trust

The runtime image includes the Go executable, static UI, Git, Chromium, native agent-browser, fonts, CA certificates, Tini and dependency licenses. It contains no application source, tests, compiler, Bun, Node or `node_modules`. Chromium and fonts are the main image-size cost; one container does not imply a tiny download.

Browser state is mounted at `/var/lib/gooseberry-browser`. Artifact accounting is incremental, and unchanged state polling backs off. Browser subprocesses receive a fixed minimal environment and per-session home directory, but share the container UID and filesystem with the controller. The command policy is not an OS sandbox. See [security](security.md).
