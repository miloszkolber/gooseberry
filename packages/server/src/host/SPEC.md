---
id: submodule-server-host
type: submodule-design
status: active
title: host — the browser↔host wire
parent: module-server
depends-on: [module-contracts]
tags: [v1, host]
---

## Responsibility

The wire and composition root: `Bun.serve` HTTP+WS, static SPA serving, the WS method-to-handler
registry, channel fan-out, and the process-boot wrapper shared by the launchers.

## Boundary

- **Owns:** `server.ts` and `boot.ts`, including `/health`, `/ws`, static `index.html` fallback, the
  `/files/<workspaceId>/<relpath>` worktree-file route, `server.welcome`, request replay/ack retention,
  provider login publishing, provider invalidation, watcher wiring, crash logging, graceful shutdown, and
  the feature-handler composition in `handlers.ts`.
- **Public surface (barrel):** `createServer`, `CreateServerOptions`, `RunningServer`, `bootHost`,
  `BootHostOptions`, and `BootedHost`.
- **Allowed deps:** `contracts` (`PROTOCOL_VERSION`, `WS_CHANNELS`); `shared` (`freePort`, `shellEnv`);
  `persistence` (`dataDir` for crash logs); all feature modules listed in the parent server spec; Bun/Node.
- **Forbidden:** being imported by a feature module, or importing `web`, `cli`, or `desktop`.

## Composition rules

- `createServer()` initializes the shared Pi runtime before binding a socket. It wires each feature through
  its public barrel and installs publisher-injection seams for `project.updated`, workspace lifecycle,
  `settings.changed`, `layout.changed`, `provider.login`, `provider.changed`, terminal output, and session
  deletion. Features never import `host` or one another outside the parent dependency graph.
- `bootHost()` installs crash logging, resolves the login-shell environment, chooses the requested or free
  port, awaits `createServer()`, and installs SIGINT/SIGTERM handlers. Shutdown settles sessions before
  closing terminals and sockets.
- Request replay is keyed by `(clientKey, requestId)`. The first request owns one handler promise and
  serialized response. Reconnects replay that result, while `ack` and `resume` frames release settled
  entries only when the client confirms them.
- Provider invalidation is data-free. Clients re-read `provider.status` and `model.list` after
  `provider.changed`, so credentials, model internals, and diagnostics never ride the push.
- Watcher events are invalidation nudges. Clients re-read authoritative `fs`, `git`, `spec`, and skill
  methods. The host injects the project-skill classifier and ensures watchers only while a workspace is
  being read.
- Review sends, workspace auto-rename, project/workspace lifecycle, terminal teardown, and skill admission
  are host-composed operations. Their feature modules expose narrow publisher or resolver seams and remain
  independent of the composition root.

## Get right

- WS commands return values directly. Events, extension UI, lifecycle notifications, provider login, and
  invalidations use push channels.
- Every broadcast push channel is subscribed in the WS `open` handler. Addressed terminal channels are sent
  directly to the one attached client and are not broadcast.
- A prompt/steer/follow-up/answer request is acknowledged when Pi accepts it, not when the turn ends.
  Later failures arrive through the event stream.
- Crash reports are written to `<dataDir>/logs/crash.log` and stderr, but crash handling is disabled under
  `NODE_ENV=test`.
