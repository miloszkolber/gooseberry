# Goose compatibility

Gooseberry connects to unmodified Goose over ACP. The supported release is recorded in [upstream.json](../gooseberry/tests/goose/upstream.json).

## Built-in extensions

Extensions run in Goose. Settings lists the extensions Goose advertises, manages their configuration and shows active-chat tools and permissions. Tool results support text, images, structured data and escaped resource content, including replay of completed results.

| Extension | Web UI support |
| --- | --- |
| Extension Manager | Tool-driven extension management and resource results. |
| analyze | Code-analysis results. |
| apps | App-management results; interactive app windows are not hosted yet. |
| chatrecall | Recall results. Goose controls the search scope. |
| code_execution | Code execution and tool-discovery results. |
| developer | File edits, writes, shell output, trees and image previews. Live shell output is bounded and marked when truncated. |
| orchestrator | Text results when enabled in Goose; nested activity and child approvals are incomplete. |
| scheduler | Schedule tools and Settings controls; start Goose with `--enable-scheduler`. |
| skills | Skill loading, slash commands and source/agent mentions. |
| summarize | File and directory summaries. |
| summon | Agent loading and delegation results; nested activity and child approvals are incomplete. |
| todo | Checklist input/results, separate from Gooseberry goals and tasks. |
| tom | Context injection inside Goose; no UI control is needed. |

These names and behaviors follow the [pinned Goose registry](https://github.com/aaif-goose/goose/blob/25021517f12cab87c94bed0874fe7d28168dc264/crates/goose/src/agents/platform_extensions/mod.rs). Goose hides scheduler and orchestrator from its normal extension catalogs. Summon children run in Auto mode because [upstream child approval forwarding is unfinished](https://github.com/aaif-goose/goose/blob/25021517f12cab87c94bed0874fe7d28168dc264/crates/goose/src/agents/platform_extensions/summon.rs#L1376). Parent permission controls do not establish child permission parity.

Apps need a sandboxed resource host and mediated tool access. HTML resources are currently shown as source text, never executed. This and nested-agent presentation are tracked in the [roadmap](roadmap.md).

## Session and settings controls

Standard ACP covers session creation, loading, listing, deletion, forks, prompts, cancellation, configuration, updates and permissions. Goose-specific methods provide steering, rename/archive, search, provider login, model metadata, agents, recipes and schedules. `/compact` is available through Goose's slash commands; `summarize` is a separate file-summary tool.

Goose owns conversations and runtime configuration. The browser receives selected fields, not raw credentials, extension commands, environments or upstream diagnostics. See [security](security.md) and [models](models.md).

Initialization checks the protocol version. Capability-driven controls and compatibility with other ACP agents remain roadmap work.

## Gooseberry-owned features

Projects, file/Git views, goals, tasks and follow-up queues belong to Gooseberry. Objectives and questions use session-scoped MCP; browser automation has its own [MCP endpoint](integration.md). Queues survive browser reconnects, not controller restarts.

Git supports uncommitted changes, selected commits and pinned comparisons. Branch-base comparison is unfinished. `skill.list` and extension-dialog components are retained but have no current UI caller or live transport producer, respectively.

Import/export/share, arbitrary configuration and broader source/app administration are not exposed. See the [roadmap](roadmap.md) for remaining work.
