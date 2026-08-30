# ACP coverage

Gooseberry uses standard ACP session methods and Goose extensions. It authenticates requests, checks project access and sends the browser only the fields its UI needs. The current upstream release and commit are recorded in [`goose/version`](../goose/version) and [`goose/source-commit`](../goose/source-commit).

## Standard ACP

The controller uses `initialize`, `session/new`, `session/load`, `session/list`, `session/delete`, `session/fork`, `session/prompt`, `session/cancel` and `session/set_config_option`. It handles `session/update`, permission requests and Goose notifications.

Coder's SDK handles typed methods, JSON-RPC and request ordering. A small adapter provides WebSocket framing. Goose's underscore-prefixed methods use the SDK's extension dispatch.

The controller authenticates the ACP connection itself. The UI has no separate ACP login or session-close control; it loads persistent sessions as needed. Model and thinking controls use configuration options rather than a separate mode selector.

The initialization result is not yet used to enable or disable UI capabilities. The integration is tested against the pinned Goose build, not a general-purpose client for arbitrary ACP agents.

## Goose extensions used by the UI

| Area | Controls |
| --- | --- |
| Sessions | Steering, native fork with immediate-parent lineage, rename, archive/restore, history search, slash commands and agent mentions. |
| Providers and models | Provider setup and native login, refresh/logout, ACP readiness, catalog visibility, model choices and canonical metadata. |
| Preferences | `autoCompactThreshold`, `gooseThinkingEffort` and global provider/model defaults. |
| Agents | Supported fields of writable global and allowed project agents, using opaque source IDs. |
| Extensions and tools | Global and active-session extension management, active-chat tool inventory and global tool permissions. |
| Recipes | List, parse, save and delete, including Goose's recipe security scan. |
| Schedules | Create/update, pause/resume, delete, run, inspect/terminate and view recent sessions. |

Goose stores the underlying data. The browser does not receive raw provider secrets, extension commands, environment values, source paths, schemas or upstream diagnostics. Agent instructions reach the editor as plain text. See [security](security.md) for access rules and [models](models.md) for catalog behavior.

## Retained APIs without complete UI access

These are Gooseberry browser-protocol methods, not upstream ACP names:

| Method or surface | Current access |
| --- | --- |
| `skill.list` | Calls Goose slash-command discovery. There is no current UI caller; the composer uses session commands and agent mentions instead. |
| `git.listCommits` | The controller returns a limited commit log, but the UI has no commit-log view. |
| `git.diffFile` scopes | The Changes panel opens uncommitted diffs. Commit and pinned scopes exist in the backend and restored-tab state, but have no current scope selector. The branch scope currently behaves like the uncommitted scope, not a branch-base comparison. |
| Browser automation | The HTTP command API works independently of ACP. The installed skill documents a smaller subset of its accepted commands. |
| Extension-UI dialogs | Components and state exist, but no controller/transport producer connects them to a live operation. |

These distinctions matter when adding UI controls: an existing method is not proof that a feature is reachable or complete. Planned work is in [roadmap](roadmap.md).

## Not exposed

The UI does not currently expose conversation truncation, manual compaction, generic tool calls, arbitrary configuration, diagnostic reports, import/export/share, custom-provider administration, non-agent source/app editing, local-inference management or dictation. Goose still handles automatic compaction; the chat shows reported context and usage.

Gooseberry's own projects, goals, tasks, questions and file/Git views are outside ACP. Objectives and questions use session-scoped MCP. Follow-up queues live in controller memory and send ordinary ACP prompts. Browser automation uses HTTP, not MCP.
