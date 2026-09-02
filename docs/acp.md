# Goose compatibility

Gooseberry connects to unmodified Goose over ACP. The supported release is recorded in [upstream.json](../gooseberry/tests/goose/upstream.json).

## Built-in extensions

Extensions run in Goose. Settings lists the extensions Goose advertises, manages their configuration and shows active-chat tools and permissions. Tool results support text, images, structured data and escaped resource content. Completed results replay from Goose; unfinished tool previews and attached App or Summon activity survive a browser reload while the controller remains running.

| Extension | Web UI support |
| --- | --- |
| Extension Manager | Tool-driven extension management and resource results. |
| analyze | Code-analysis results. |
| apps | App-management results and sandboxed interactive views. |
| chatrecall | Recall results. Goose controls the search scope. |
| code_execution | Code execution and tool-discovery results. |
| developer | File edits, writes, shell output, trees and image previews. Live shell output is bounded and marked when truncated. |
| orchestrator | Text results when enabled in Goose; Goose does not report nested activity. |
| scheduler | Schedule tools and Settings controls; start Goose with `--enable-scheduler`. |
| skills | Skill loading, slash commands and source/agent mentions. |
| summarize | File and directory summaries. |
| summon | Agent loading and delegation results, with recent child tool requests when Goose reports them. |
| todo | Checklist input/results, separate from Gooseberry goals and tasks. |
| tom | Context injection inside Goose; no UI control is needed. |

These names and behaviors follow the [pinned Goose registry](https://github.com/aaif-goose/goose/blob/25021517f12cab87c94bed0874fe7d28168dc264/crates/goose/src/agents/platform_extensions/mod.rs). Goose hides scheduler and orchestrator from its normal extension catalogs. Summon children run in Auto mode because [upstream child approval forwarding is unfinished](https://github.com/aaif-goose/goose/blob/25021517f12cab87c94bed0874fe7d28168dc264/crates/goose/src/agents/platform_extensions/summon.rs#L1376). Parent permission controls do not establish child permission parity.

Interactive Apps use trusted metadata projected by Goose. Gooseberry reads the attached `ui://` resource and mediates resource reads and tool calls through the same session and extension. Resource HTML runs only in the separate browser sandbox origin.

Summon child activity is transient and best-effort. Gooseberry keeps the latest 32 reported tool requests on the outer call and includes them in live events and browser reload snapshots. It does not infer completion, keep child transcripts or reconstruct activity after controller state is lost.

## Session and settings controls

Standard ACP covers session creation, loading, listing, deletion, forks, prompts, cancellation, configuration, updates and permissions. Goose-specific methods provide steering, rename/archive, search, provider login, model metadata, agents, recipes and schedules. `/compact` is available through Goose's slash commands; `summarize` is a separate file-summary tool.

Standard command and usage updates are projected today. ACP plan and current-mode updates remain roadmap work.

The composer receives each session's command catalog through standard ACP updates and refreshes it after reconnects, project `SKILL.md` changes and recipe saves or deletes. Other host-side command changes appear when the chat reconnects or is reopened.

Goose owns conversations and runtime configuration. The browser receives selected fields, not raw credentials, extension commands, environments or upstream diagnostics. See [security](security.md) and [models](models.md).

Initialization records a small connection profile. Session loading and listing are required; advertised delete, fork, image-prompt and HTTP MCP support controls the matching behavior. Gooseberry recognizes Goose through its ACP identity and `_meta.goose` marker before using Goose-specific methods. The pinned Goose release retains fork support even though it does not advertise that capability.

Compatible ACP agents can use the standard conversation surface when embedded with an explicit endpoint. Live sessions fail closed when the reported generic-agent profile changes. The packaged service accepts only recognized Goose on its default endpoint until persisted session records can be bound to a stable agent identity.

## Gooseberry-owned features

Projects, file/Git views, goals, tasks and follow-up queues belong to Gooseberry. Objectives and questions use session-scoped MCP; browser automation has its own [MCP endpoint](integration.md). Queue mutations and delivery attempts persist across controller restarts. Pinned Goose has no prompt-idempotency receipt, so an unconfirmed attempt is reconciled from replay or left for the user to retry or remove.

Git supports uncommitted changes, selected commits, pinned comparisons and comparisons from a selected local or remote-tracking branch merge base. Branch catalogs load on demand; Gooseberry neither fetches nor writes Git state. `skill.list` remains a compatibility endpoint; the Web UI uses session command catalogs instead. Extension-dialog components are retained but have no live transport producer.

Import/export/share, arbitrary configuration and broader source/app administration are not exposed. See the [roadmap](roadmap.md) for remaining work.
