# Goose and ACP

Gooseberry connects to an unmodified Goose service over ACP. Goose remains responsible for conversations, providers, models, extensions, tools, permissions, recipes, schedules and credentials.

## Supported Goose release

[`upstream.json`](../gooseberry/tests/goose/upstream.json) records the tested Goose release, official GNU Linux archives and SHA-256 hashes. Gooseberry recognizes Goose from its ACP identity and `_meta.goose` marker before it uses Goose-specific methods.

The application connects to `ws://127.0.0.1:3284/acp` by default. It sends `GOOSEBERRY_GOOSE_SECRET_KEY` as `X-Secret-Key`; this value must match Goose's `GOOSE_SERVER__SECRET_KEY`.

## Conversations

Standard ACP supplies prompts, streaming updates, cancellation, permissions, commands, usage, plans and modes. Browser-selected images require the image prompt capability. Bounded UTF-8 plain-text and code attachments require embedded-context support and are sent as embedded text resources, never written to project or application state. Goose-specific methods add steering, rename/archive, search, provider login, model metadata, agents, recipes and schedules. Features are enabled from the capabilities reported by the connected service. The supported Goose release retains fork support despite not advertising it.

Goose owns each transcript. ACP returns a complete replay, so Gooseberry keeps a bounded projection and serves it newest-first at user-round boundaries. Older-page requests include the projection identity; stale pages are rejected after a reconnect or replacement replay. Connection generations also reject late replies from an earlier connection.

Follow-up queues are Gooseberry state because the supported Goose release has no queue method. Queue order and delivery attempts survive restarts. An interrupted delivery is reconciled against Goose replay; if the result is uncertain, the item waits for an explicit retry or removal.

Session command catalogs come from standard ACP updates. They refresh after reconnects, project `SKILL.md` changes and recipe changes. `/compact` is a Goose command; the `summarize` extension is a separate file-summary tool.

## Built-in extensions

Extensions execute inside Goose. The Web UI manages the configuration Goose exposes and renders text, images, structured results and escaped resources.

| Extension | Web UI coverage |
| --- | --- |
| Extension Manager | Extension management and resource results. |
| `analyze` | Analysis results. |
| `apps` | App management and sandboxed interactive views. |
| `chatrecall` | Recall results using Goose's search scope. |
| `code_execution` | Code execution and discovered-tool results. |
| `developer` | Reads, edits, writes, shell output, trees and image previews. Live output is bounded and marks truncation. |
| `orchestrator` | Text results when enabled; Goose does not expose nested activity. |
| `scheduler` | Schedule tools and Settings controls when Goose starts with `--enable-scheduler`. |
| `skills` | Skill loading, slash commands and source/agent mentions. |
| `summarize` | File and directory summaries. |
| `summon` | Delegation results and recent child tool requests reported by Goose. |
| `todo` | Goose checklist results, separate from Gooseberry goals and tasks. |
| `tom` | Context injection; no separate UI control is required. |

The list follows the [supported Goose registry](https://github.com/aaif-goose/goose/blob/25021517f12cab87c94bed0874fe7d28168dc264/crates/goose/src/agents/platform_extensions/mod.rs). Goose omits scheduler and orchestrator from its normal extension catalogs. Summon child activity is transient and bounded; child approvals remain in Auto mode because [Goose does not yet forward them](https://github.com/aaif-goose/goose/blob/25021517f12cab87c94bed0874fe7d28168dc264/crates/goose/src/agents/platform_extensions/summon.rs#L1376).

Interactive Apps use trusted `ui://` metadata from Goose. Gooseberry mediates resource reads and tool calls through the attached project, session, tool call and extension. The HTML runs on the browser service's separate origin with a bounded policy and a short-lived ticket.

## Providers, models and agents

Provider keys and OAuth/device-code setup travel over authenticated ACP. Goose validates and stores credentials; Gooseberry neither reads nor duplicates them.

The Web UI shows the model names, limits, modalities, reasoning support and prices supplied by Goose. Visibility choices affect Gooseberry selectors only. Default model, thinking and agent preferences are saved through Goose.

Custom agents, recipes and extension settings are Goose state. Gooseberry projects only the fields needed by the interface; raw extension commands, environments, schemas and upstream diagnostics are not sent to the browser.

## MCP

| Endpoint | Purpose |
| --- | --- |
| Application `/mcp/objective` | Session-scoped goals, tasks and questions. |
| Browser `/mcp` | Authenticated browser automation and guidance for Goose or another trusted service. |

The browser also exposes authenticated HTTP commands and artifacts. The Web UI uses controller-owned random browser panels over typed WebSocket methods, so the browser token remains server-side. Panels expose HTTP(S) navigation, viewport, snapshot, screenshot, snapshot-reference click and text fill only. Registration is covered in [deployment](deployment.md#browser-mcp).

Projects, file and Git views, objectives and queues are Gooseberry-owned. Import/export/share and broader source administration remain out of scope until upstream offers stable operations; see the [roadmap](roadmap.md).

Other ACP agents can use the standard conversation surface when embedded with an explicit endpoint. The packaged default endpoint accepts recognized Goose only. Production selection of another agent is deferred until persisted sessions and queues can be tied to an operator-stable identity.
