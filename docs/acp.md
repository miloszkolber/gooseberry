# ACP coverage

Gooseberry projects a focused subset of the Goose ACP service. The authoritative release/source pins are [`goose/version`](../goose/version) and [`goose/source-commit`](../goose/source-commit). Goose owns underlying state; the controller adds project authorization, bounded inputs, sanitized results and presentation.

## Session protocol

The controller uses ACP `initialize`, `session/new`, `session/load`, `session/list`, `session/delete`, `session/fork`, `session/prompt`, `session/cancel` and `session/set_config_option`. It consumes `session/update`, permission requests and Goose extension notifications.

The Coder SDK handles standard typed methods and request ordering. A small transport adapter supplies Goose's WebSocket framing. Underscore-prefixed Goose methods use extension dispatch, not a separate JSON-RPC implementation. Session projections preserve streamed text/images, tool output, usage, model/thinking choices and persistent history.

Gooseberry does not expose separate ACP authenticate, session-close or mode-selection controls: the controller authenticates its own connection, persistent sessions load on demand and model/thinking controls use configuration options.

## Projected capabilities

| Surface | Web UI behavior and boundary |
| --- | --- |
| Session lifecycle | Native fork with immediate-parent lineage, rename, reversible archive/restore and history search. Goose owns transcripts and lifecycle state. |
| Steering and completions | Native steering, Goose slash commands and authorized session-scoped agent mentions. Mention text is forwarded exactly; the UI does not invent source paths or infer mentions from source lists. |
| Providers | Inventory, explicit credential setup, native authentication, refresh, logout and a sanitized ACP-readiness check. No credential registry. |
| Models | Catalog visibility and per-session choices; canonical metadata supplements missing fields. Lookup failure preserves the inventory result. |
| Preferences and defaults | Only `autoCompactThreshold` and `gooseThinkingEffort`, plus Goose's global provider/model defaults. |
| Agent sources | Bounded plain-text global/admitted-project agent editing using opaque IDs and a fresh writability check. Check definitions, arbitrary properties and supporting files are not exposed. |
| Extensions | Sanitized global configured/available inventory, add/remove/enable/disable, and active-session inventory/add/remove. |
| Tools and permissions | Active-chat tool inventory and Goose's global per-tool permission values. No generic tool-call endpoint in the Web UI. |
| Recipes | List, parse, save and delete, retaining Goose's recipe security scan. |
| Schedules | List, create, update, pause, resume, delete, run immediately, inspect/terminate runs and view recent sessions. |

Canonical model requests share a global four-request cap, coalesce current work and stop waiting at a projection deadline. No completed metadata cache is retained. Prices require valid finite nonnegative values. See [models](models.md).

Agent CRUD re-resolves an opaque ID from a fresh authorized source list inside a serialized mutation. Project scope requires both a project ID and an explicitly selected admitted root. The editor exposes only bounded instructions, name, description, scope, writability and an optional model-ID preference.

Extension and tool summaries omit commands, arguments, URLs, headers, environment values, client-secret keys, schemas and raw warnings. Source paths, raw mentions and readiness diagnostics remain controller-side. Provider secrets are passed only for an explicit setup request and are neither replayed nor persisted in Gooseberry.

## Deliberately outside the Web UI

Gooseberry does not project conversation truncation, manual compaction, generic `tools/call`, arbitrary configuration/preferences, diagnostic reports, import/export/share, custom-provider administration, non-agent source/app mutation, local-inference management or dictation. Automatic compaction remains Goose-owned; the chat displays reported context and usage.

The presence of a capability in Goose is not, by itself, a reason to add a generic administration surface. Add a projection only when it supports the [product baseline](baseline.md), has a checked upstream method and schema, preserves Goose's authority and has focused compatibility coverage.

## Gooseberry-owned behavior

Projects, admitted roots, goals, tasks, supporting questions, bounded file/Git views and presentation metadata are Gooseberry features. Follow-up queues are bounded controller-memory state submitted through ordinary ACP prompts, not a persistent Goose queue registry. Objective/question MCP is session-scoped. Browser automation uses the separate browser HTTP API.

See [integration](integration.md) for lifecycle and reconnect semantics and [security](security.md) for authority boundaries.
