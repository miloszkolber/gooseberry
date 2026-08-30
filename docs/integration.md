# Goose integration

Gooseberry connects to an official upstream Goose release installed by the user. The supported release and official artifact identities are recorded in [`upstream.json`](../gooseberry/tests/goose/upstream.json). See [Goose](goose.md) for compatibility and update responsibilities.

Run Goose on authenticated loopback, optionally with a systemd user service:

```bash
goose serve --host 127.0.0.1 --port 3284 --enable-scheduler
```

The controller connects to `ws://127.0.0.1:3284/acp`. Its `GOOSEBERRY_GOOSE_SECRET_KEY` must match the service's `GOOSE_SERVER__SECRET_KEY`; it sends that value in `X-Secret-Key`.

## Session lifecycle

Each session belongs to a Gooseberry project and an allowed working directory. Goose stores the conversation. When a settled session is forked, Goose copies it and Gooseberry records the child's project, directory and immediate parent. Loading the child reads its inherited transcript from Goose.

Goose also owns rename and archive state. An empty recorded session may be missing from `session/list`, so the controller queries it individually to keep archived empty chats restorable. Archive is refused during streaming, loading or another operation, and blocks competing operations until it finishes.

Lifecycle notifications are not replayed. On reconnect or notification, the browser reloads the active-and-archived catalog. Requests and callbacks carry a connection generation so an old ACP response cannot modify a replacement session.

Follow-up queues live in controller memory. Browser snapshots include them, and the controller sends the next message after the current prompt settles. Queues survive a browser reload, not a service restart. Steering uses Goose's session-steer method.

## Agents, objectives and browser use

The controller supplies a session-specific MCP endpoint and bearer credential when creating a Goose session. Agents use it for goals, tasks and supporting questions. It does not authorize general controller operations.

Agent editing and mentions use the user's Goose agents. Gooseberry does not install agent presets or skills on the host.

The user registers the browser's remote MCP endpoint, `http://127.0.0.1:8787/mcp`, once in private Goose configuration. Browser MCP exposes `browser_command`, the `browser_guidance` tool and the `gooseberry://browser/guide` resource. Essential instructions travel with the tool definitions; detailed guidance is read only when needed. The [deployment example](deployment.md#start-and-register-browser-mcp) resolves its bearer header from Goose's private environment or secret store, never from agent instructions.

`browser_command` takes an explicit `session`, a `command` and optional `args`. Keep that browser session ID across related calls; it is independent of Goose's conversation ID and the MCP connection. The command result retains the outcome, exit code, output and optional artifact. `close` removes the browser session and its artifacts.

The HTTP command route at `/v1/browser` and artifact route at `/v1/artifacts/{session}/{name}` remain available, using the same browser authentication. Trusted services can use either API without going through the Web UI. Goose remains usable directly.

## Administration

Global extension changes update Goose configuration; active-chat extension changes update that session. The controller reloads Goose's result after each change instead of maintaining another catalog.

Tool inventory requires an authorized active chat. Permission changes use Goose's global `permission.yaml` values: `always_allow`, `ask_before` and `never_allow`. Changes are refused while that chat is running or performing another operation.

See [ACP coverage](acp.md) for supported methods, [models](models.md) for catalog behavior and [security](security.md) for what data reaches the browser.
