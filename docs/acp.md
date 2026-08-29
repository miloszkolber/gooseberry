# ACP coverage

Gooseberry connects to the unchanged Goose v1.48.0 ACP service and projects a focused subset of its capabilities. Goose owns the underlying session, provider, model, extension, tool, permission, compaction, recipe, and scheduler state. Gooseberry adds browser-facing authorization, project association, presentation, and controls.

## Projected session protocol

The controller uses ACP `initialize`, `session/new`, `session/load`, `session/list`, `session/delete`, `session/fork`, `session/prompt`, `session/cancel`, and `session/set_config_option`. It consumes `session/update`, permission requests, and Goose extension notifications. The Web UI provides persistent session creation and loading, streaming turns, cancellation, model and thinking controls, usage and context, permission responses, rename, reversible archive, native fork, history, and slash commands.

Forked sessions remain ordinary Goose sessions. Gooseberry records only their project, working directory, and immediate parent session identifier. Goose remains authoritative for the copied conversation and subsequent session state.

Goose also implements ACP authentication, session close, and mode selection. Gooseberry does not expose separate controls for them because the controller authenticates its ACP connection, persistent chats are loaded on demand rather than explicitly closed, and the product uses Goose configuration options for the retained model and thinking controls.

## Projected Goose extensions

Gooseberry uses Goose custom ACP methods for:

- session steering, information, rename, archive, and restore
- provider inventory, configuration, authentication, refresh, and logout
- model catalog projection and per-session model and thinking selection
- recipe list, parse, save, and delete
- schedule list, create, update, pause, resume, delete, immediate run, session history, inspection, and termination
- slash-command discovery
- global configured and available extension inventory, add, remove, and enable or disable
- active-session extension inventory, add, and remove
- active-session tool inventory and global tool-permission changes

Provider secrets pass from the browser to Goose only during an explicit setup request. Gooseberry never stores or returns secret values. Recipe, scheduler, extension, tool, and permission records also remain Goose-owned. Extension and tool projections omit raw extension objects, commands, arguments, URLs, headers, environment data, client-secret keys, input and output schemas, and warning text.

## Related Goose capabilities

The following Goose capabilities are retained in the runtime but do not currently have generic Gooseberry administration surfaces:

- **Compaction:** Goose owns automatic compaction. Gooseberry displays reported context and compaction-related usage but does not expose manual conversation truncation.
- **Extensions and plugins:** the distribution installs Gooseberry's custom agents and browser skill in standard Goose configuration. The focused settings surface manages catalogued global and active-session extensions by Goose identity, but it does not expose or edit raw extension configuration or credentials.
- **Tools and agents:** the chat renders tool execution, permission requests, and summoned subagent progress. Settings show the active chat's tool inventory and edit Goose's global per-tool permissions. Gooseberry does not provide an agent catalog editor.
- **Export and import:** session, source, and application import/export methods are not projected.
- **Advanced provider administration:** custom-provider CRUD, raw configuration, provider-secret inventory, readiness diagnostics, and catalog templates are not projected.
- **Sources, prompts, preferences, defaults, dictation, and local-inference lifecycle:** Goose may expose custom requests for these domains, but Gooseberry has no generic control surface for them.

These omissions keep the Web UI focused and avoid creating parallel registries. Add a projection only when it supports retained product behavior, has an exact pinned Goose method and schema, preserves Goose authority, and includes a compatibility test.

## Gooseberry-owned controls

Projects, admitted roots, goals, agent-owned tasks, supporting questions, Git and file projections, and presentation metadata are Gooseberry features rather than ACP registries. Follow-up queues are bounded controller-memory state because Goose v1.48.0 has no queue-manipulation ACP method. See [`integration.md`](integration.md) for the runtime boundary.
