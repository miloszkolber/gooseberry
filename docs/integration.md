# Goose integration

Gooseberry connects to the Goose release and commit recorded in [`goose/version`](../goose/version) and [`goose/source-commit`](../goose/source-commit). The [distribution guide](goose.md) explains the build policy.

The systemd user service runs:

```bash
/usr/local/bin/goose serve --host 127.0.0.1 --port 3284 --enable-scheduler
```

The controller connects to `ws://127.0.0.1:3284/acp`. Its `GOOSEBERRY_GOOSE_SECRET_KEY` must match the service's `GOOSE_SERVER__SECRET_KEY`; it sends that value in `X-Secret-Key`.

## Session lifecycle

Each session belongs to a Gooseberry project and an allowed working directory. Goose stores the conversation. When a settled session is forked, Goose copies it and Gooseberry records the child's project, directory and immediate parent. Loading the child reads its inherited transcript from Goose.

Goose also owns rename and archive state. An empty recorded session may be missing from `session/list`, so the controller queries it individually to keep archived empty chats restorable. Archive is refused during streaming, loading or another operation, and blocks competing operations until it finishes.

Lifecycle notifications are not replayed. On reconnect or notification, the browser reloads the active-and-archived catalog. Requests and callbacks carry a connection generation so an old ACP response cannot modify a replacement session.

Follow-up queues live in controller memory. Browser snapshots include them, and the controller sends the next message after the current prompt settles. Queues survive a browser reload, not a service restart. Steering uses Goose's session-steer method.

## Agents, objectives and browser use

The controller supplies a session-specific MCP endpoint and bearer credential when creating a Goose session. Agents use it for goals, tasks and supporting questions. It does not authorize general controller operations.

The installer places bundled agents and the browser skill in the user's standard Goose configuration directory. The browser skill calls the HTTP listener in the Gooseberry process. Browser HTTP is not MCP, and Goose remains usable outside the Web UI.

## Administration

Global extension changes update Goose configuration; active-chat extension changes update that session. The controller reloads Goose's result after each change instead of maintaining another catalog.

Tool inventory requires an authorized active chat. Permission changes use Goose's global `permission.yaml` values: `always_allow`, `ask_before` and `never_allow`. Changes are refused while that chat is running or performing another operation.

See [ACP coverage](acp.md) for supported methods, [models](models.md) for catalog behavior and [security](security.md) for what data reaches the browser.
