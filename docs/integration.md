# Integration

Gooseberry integrates with the unchanged upstream Goose v1.48.0 distribution through its ACP service boundary. Install Goose at `/usr/local/bin/goose` and run:

```bash
goose serve --enable-scheduler
```

The service listens on `127.0.0.1:3284`. `GOOSE_SERVER__SECRET_KEY` authenticates ACP, and `GOOSEBERRY_GOOSE_SECRET_KEY` supplies the matching controller credential.

Goose remains authoritative for sessions, history, providers, models, credentials, extensions, tools, compaction, permissions, recipes, and scheduler state. Gooseberry exposes projects, goals and agent-owned tasks, supporting questions, custom-agent summon, Git and files, native session fork with immediate-parent lineage, session rename and reversible archive projections, history, slash-command, and agent-mention projections, and focused provider, model, extension, tool, recipe, and scheduler controls. Canonical model metadata and ACP readiness are re-queried from Goose, not stored. Objective updates and supporting questions use the authenticated, session-scoped MCP endpoint. Browser automation uses a lazy Goose skill and the separate `gooseberry-browser` HTTP service. [`acp.md`](acp.md) records the current protocol projection.

Goose v1.48.0 has no queue-manipulation ACP method. Follow-up messages are therefore bounded controller-memory state. The controller includes them in session summaries, publishes queue changes to browsers, and submits the next message through ACP after the active prompt settles. This state survives browser refresh and reconnect but is intentionally lost on a controller restart. Steering continues to use Goose's `_goose/unstable/session/steer` method directly.

The distribution installs Gooseberry custom agents and the browser skill in the technical user's standard Goose configuration directory. Vanilla Goose behavior remains available outside Gooseberry.

## Session lifecycle projection

- Fork is permitted only for a settled session recorded under the requesting project and an admitted project directory. Goose copies the conversation through ACP. Gooseberry records the new session under the same project and directory with the source as its immediate parent.
- Gooseberry permits rename, archive, and unarchive only for a session recorded under the requesting project and an admitted project directory.
- Goose remains authoritative for the title and archive state. Gooseberry reads archive state from Goose v1.48.0's session `_meta.archivedAt` field. Because ACP `session/list` omits sessions without messages, Gooseberry queries per-session info for recorded sessions absent from that list so an empty archived chat remains restorable.
- Archive is refused while the session is streaming, loading, or performing another session operation. Once an archive starts, new loads, prompts, steering, configuration changes, and lifecycle mutations are refused until Goose settles the request.
- Lifecycle WebSocket notifications are transient and non-replayable. Clients update local presentation after a successful direct request and re-query the authoritative active-and-archived session catalog in one request after reconnect or notification. This repairs missed lifecycle notifications while distinguishing archive from deletion.

## Extension and tool projection

- Global extension controls read and mutate Goose configuration. Active-chat extension controls read and mutate Goose session state. Gooseberry re-queries Goose after every successful mutation and does not persist a parallel catalog.
- The browser receives only extension names, types, display metadata, enabled state, available tool names, opaque configuration keys needed for mutation, and a warning count. Raw extension objects, commands, arguments, URLs, headers, environment data, client-secret keys, and warning text remain controller-side.
- Tool inventory is scoped to an authorized active chat. Input and output schemas remain controller-side. Permission changes use Goose's global `permission.yaml` values `always_allow`, `ask_before`, and `never_allow`, and are refused while the chat is running or another session operation is active.
