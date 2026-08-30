# Goose service boundary

Gooseberry connects to the upstream Goose runtime pinned by [`goose/version`](../goose/version) and [`goose/source-commit`](../goose/source-commit). The [distribution policy](goose.md) preserves its Rust code and records the bounded build-metadata exception. The native user service runs:

```bash
/usr/local/bin/goose serve --host 127.0.0.1 --port 3284 --enable-scheduler
```

It listens on `127.0.0.1:3284`. The controller connects to `ws://127.0.0.1:3284/acp`, using `GOOSEBERRY_GOOSE_SECRET_KEY` to supply Goose's matching `GOOSE_SERVER__SECRET_KEY` through the `X-Secret-Key` header.

Goose owns canonical sessions, history, providers, models, credentials, extensions, tools, compaction, permissions, agents, recipes and scheduler state. Gooseberry projects those capabilities through authorized browser operations and stores only its project/objective/presentation state. [ACP coverage](acp.md) lists the projected controls.

## Sessions and reconnects

A Goose session is associated with a Gooseberry project and an admitted working directory. A fork is allowed only for a settled recorded session; Goose copies its conversation and Gooseberry records the child's project, directory and immediate parent. The inherited transcript loads from Goose, not a copied Gooseberry transcript store.

Rename, archive and restore use Goose's authoritative state. Empty recorded sessions absent from `session/list` are queried individually so an empty archived chat remains restorable. Archive is refused while a session is streaming, loading or performing another operation; once an archive starts, competing loads and mutations are refused until it settles.

Lifecycle notifications are transient. After reconnect or notification, the browser re-queries the active-and-archived catalog rather than treating a missed event as deletion. Requests and callbacks carry connection generations so delayed work from an old ACP connection cannot alter a replacement session projection.

Follow-up queues are bounded controller-memory state, not a second persistent session store. Queue updates are included in browser snapshots and the next message is submitted through ACP when the current prompt settles. They survive browser refresh/reconnect but not a controller restart. Steering uses Goose's native session-steer extension.

## Agent-facing integrations

Objective updates and supporting questions use authenticated session-scoped MCP on the application listener. The controller supplies the session's endpoint and bearer credential when creating the Goose session. This credential does not grant general controller access.

The distribution installs the bundled custom agents and browser skill in the technical user's standard Goose configuration directory. Browser automation is lazy: the skill calls the browser HTTP listener in the same Gooseberry executable. Browser HTTP is not MCP. Goose remains usable directly outside the Web UI.

## Administration without parallel registries

Global extension operations mutate Goose configuration; active-chat extension operations mutate Goose session state. The controller re-queries Goose after a successful change. Browser summaries omit raw commands, URLs, environment values, credentials, schemas and warning text.

Tool inventory is scoped to an authorized active chat. Permission updates use Goose's global `permission.yaml` values `always_allow`, `ask_before` and `never_allow`; they are refused while the chat is running or another session operation is active. Provider credentials, model metadata, sources, recipes and schedules likewise remain Goose-owned.

See [models](models.md) for model projection, [security](security.md) for sanitization and path boundaries, and [deployment](deployment.md) for operation of both services.
