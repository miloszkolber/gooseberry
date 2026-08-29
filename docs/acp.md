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
- model catalog projection, canonical metadata lookup, and per-session model and thinking selection
- ACP-capable provider readiness checks
- session-scoped agent mention discovery
- allowlisted preference read, save, and remove
- global provider/model default read, save, and clear
- global and authorized project-agent source list, create, update, and delete
- recipe list, parse, save, and delete
- schedule list, create, update, pause, resume, delete, immediate run, session history, inspection, and termination
- slash-command discovery
- global configured and available extension inventory, add, remove, and enable or disable
- active-session extension inventory, add, and remove
- active-session tool inventory and global tool-permission changes

Provider secrets pass from the browser to Goose only during an explicit setup request. Gooseberry never stores or returns secret values. Canonical model lookups share a global four-request cap, coalesce concurrent current requests, and let projections stop waiting at a deadline. They only fill missing inventory context and reasoning fields, plus output limits and valid per-1M-token pricing. Agent mention projection is authorized for a recorded project session and returns only bounded name, description, source type, and exact mention text. The composer accepts every official source type, but Goose v1.48.0 currently discovers only agent, recipe, and subrecipe through this endpoint. Provider readiness accepts only current inventory entries marked ACP-capable and returns only `providerId`, `ready`, and `hasIssue`. Preferences expose only `autoCompactThreshold` and `gooseThinkingEffort`. Agent source CRUD uses controller-generated opaque IDs, re-resolves a fresh authorized source inside a serialized controller mutation, excludes `properties.kind=check`, and requires both the admitted project ID and explicitly selected root for project scope. It exposes only bounded plain-text content plus name, description, scope, writable state, and optional `model` model-ID preference. Recipe, scheduler, extension, tool, and permission records also remain Goose-owned. Extension and tool projections omit raw extension objects, commands, arguments, URLs, headers, environment data, client-secret keys, input and output schemas, and warning text. Source paths, supporting files, arbitrary properties, raw mention objects, and readiness error text remain controller-side.

## Current ACP coverage matrix

| Surface | Coverage | Browser projection or boundary |
| --- | --- | --- |
| Sessions, prompts, streaming, configuration, lifecycle, history, slash commands | Projected | Focused session controls and read-only history projections. |
| Provider inventory, setup, authentication, refresh, logout | Projected | Sanitized provider status and explicit credential handoff only. |
| Canonical model metadata | Projected | Current context, reasoning, output limits, and prices only. Inventory values win and lookup failure falls back to inventory. |
| Provider readiness | Projected | ACP-only provider check with `providerId`, `ready`, and `hasIssue` only. No diagnostics are exposed or stored. |
| Agent mentions | Projected | Authorized session lookup with name, description, source type, and exact mention. The composer accepts all official source types for non-path queries. Pinned Goose currently discovers agent, recipe, and subrecipe only. |
| Allowlisted preferences, global defaults, agent sources | Projected | Only two preference keys, persisted provider/model defaults, and a bounded opaque-ID agent editor. Paths and arbitrary properties remain controller-side. |
| Extensions, tools, recipes, schedules, permissions | Projected | Retained focused controls with their existing sanitization boundaries. |
| Conversation truncation | Deliberately omitted | Pinned ACP exposes timestamp-based `_goose/unstable/session/conversation/truncate`, but Gooseberry has no truncation control. |
| Tools/call, arbitrary configuration or preferences, diagnostics reports, import/export/share, non-agent sources/apps mutation, local inference, dictation | Deliberately omitted | No generic Web UI surface. |
| Manual compaction | Unavailable in pinned ACP | Goose v1.48.0 exposes no manual compaction method. Automatic compaction remains Goose-owned. |
| Queue manipulation | Unavailable in pinned ACP | Gooseberry keeps bounded controller-memory follow-up queues. |

## Related Goose capabilities

The following Goose capabilities are retained in the runtime but do not currently have generic Gooseberry administration surfaces:

- **Compaction:** Goose owns automatic compaction. Gooseberry displays reported context and compaction-related usage. Goose v1.48.0 exposes timestamp-based conversation truncation, but no manual compaction method, and Gooseberry exposes neither a truncation nor a manual-compaction control.
- **Extensions and plugins:** the distribution installs Gooseberry's custom agents and browser skill in standard Goose configuration. The focused settings surface manages catalogued global and active-session extensions by Goose identity, but it does not expose or edit raw extension configuration or credentials.
- **Tools and agents:** the chat renders tool execution, permission requests, and summoned subagent progress. Settings show the active chat's tool inventory and edit Goose's global per-tool permissions. The focused agent catalog editor manages writable global and authorized project agent sources only.
- **Export and import:** session, source, and application import/export methods are not projected.
- **Advanced provider administration:** custom-provider CRUD, raw configuration, provider-secret inventory, readiness diagnostics, and catalog templates are not projected. The focused readiness check returns only booleans.
- **Sources, prompts, preferences, defaults, dictation, and local-inference lifecycle:** Gooseberry exposes only its focused agent source catalog, two allowlisted preferences, and global provider/model defaults. It has no generic control surface for the remaining domains.

These omissions keep the Web UI focused and avoid creating parallel registries. Add a projection only when it supports retained product behavior, has an exact pinned Goose method and schema, preserves Goose authority, and includes a compatibility test.

## Gooseberry-owned controls

Projects, admitted roots, goals, agent-owned tasks, supporting questions, Git and file projections, and presentation metadata are Gooseberry features rather than ACP registries. Follow-up queues are bounded controller-memory state because Goose v1.48.0 has no queue-manipulation ACP method. See [`integration.md`](integration.md) for the runtime boundary.
