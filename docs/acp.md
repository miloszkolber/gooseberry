# Goose and ACP

Gooseberry connects to an unmodified Goose service over ACP. Goose remains responsible for conversations, providers, models, extensions, tools, permissions, recipes, schedules and credentials.

## Supported Goose release

[`upstream.json`](../gooseberry/tests/goose/upstream.json) records the tested Goose release, official GNU Linux archives and SHA-256 hashes. Gooseberry recognizes Goose from its ACP identity and `_meta.goose` marker before it uses Goose-specific methods.

The application connects to `ws://127.0.0.1:3284/acp` by default. It sends `GOOSEBERRY_GOOSE_SECRET_KEY` as `X-Secret-Key`; this value must match Goose's `GOOSE_SERVER__SECRET_KEY`.

## Conversations

Standard ACP supplies prompts, streaming updates, cancellation, permissions, commands, usage, plans and modes. Browser-selected images require the image prompt capability. Bounded UTF-8 plain-text and code attachments require embedded-context support and are sent as embedded text resources, never written to project or application state. Goose-specific methods add steering, rename/archive, search, provider login, model metadata, agents, recipes and schedules. Features are enabled from the capabilities reported by the connected service. The supported Goose release retains fork support despite not advertising it.

Goose owns each transcript. ACP returns a complete replay, so Gooseberry pages the projection newest-first at user-round boundaries. Inactive projections have count and memory eviction budgets; an active session and one long assistant answer can exceed those budgets. Older-page requests include the projection identity; stale pages are rejected after a reconnect or replacement replay. Connection generations also reject late replies from an earlier connection.

The WebSocket-to-SDK adapter applies backpressure after each 128 notifications using an ordered local checkpoint. This prevents burst replay from overflowing the pinned SDK's receive queue while retaining notification order and its response-after-replay barrier. Waiting ends on cancellation, connection closure or a 15-second processing stall. Inbound request handlers remain independent. The reserved `_gooseberry/internal/notification-checkpoint` method exists only inside the adapter: it is never sent over ACP, advertised to agents or projected to the UI, and peer-supplied copies are rejected. It is an internal implementation detail, not an ACP or Goose extension. The SDK dependency and Goose runtime are unmodified.

Follow-up queues are Gooseberry state because the supported Goose release has no queue method. Queue order and delivery attempts survive restarts. An interrupted delivery is reconciled against Goose replay; if the result is uncertain, the item waits for an explicit retry or removal.

Session command catalogs come from standard ACP updates. They refresh after reconnects, project `SKILL.md` changes and recipe changes. `/compact` is a Goose command; the `summarize` extension is a separate file-summary tool.

## Built-in extensions

Extensions execute inside Goose. The Web UI manages the configuration Goose exposes and renders text, images, structured results and escaped resources. Goose 1.49 keeps configured state authoritative over ACP and publishes its bundled extension definitions with the client source, which Gooseberry uses only as the addable built-in catalog.

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

The list follows the [supported Goose registry](https://github.com/aaif-goose/goose/blob/71fc4be1ed729e26b1dc0a4466abdd03be548a53/crates/goose/src/agents/platform_extensions/mod.rs). Goose omits scheduler and orchestrator from its normal extension catalogs. Summon child activity is transient and bounded; child approvals remain in Auto mode because [Goose does not yet forward them](https://github.com/aaif-goose/goose/blob/71fc4be1ed729e26b1dc0a4466abdd03be548a53/crates/goose/src/agents/platform_extensions/summon.rs).

Interactive Apps use trusted `ui://` metadata from Goose. Gooseberry mediates resource reads and tool calls through the attached project, session, tool call and extension. The HTML runs on the browser service's separate origin with a bounded policy and a short-lived ticket.

## Providers, models and agents

Provider keys and OAuth/device-code setup travel over authenticated ACP. Goose validates and stores credentials. Gooseberry forwards operator-entered credentials during setup and reads configuration-presence flags, without keeping a credential store.

The Web UI shows the model names, limits, modalities, reasoning support and prices supplied by Goose. Configuration, catalog availability and runtime readiness are separate. A default command or local URL alone does not count as explicit setup; Gooseberry checks field-presence flags for those ambiguous providers. An explicit setup or saved key does not prove that a command is installed, signed in or reachable. ACP-provider readiness can be checked on demand; other unverified readiness is labeled accordingly. Legacy providers remain searchable and can be shown explicitly; configured legacy providers remain visible. Optional model metadata can be incomplete, and absent capability or price data is shown as unknown. Visibility choices affect Gooseberry selectors only. Default model, thinking and agent preferences are saved through Goose.

Overlapping provider/model views share in-flight inventory and field-presence requests. Completed results are not cached. Connection changes and provider mutations prevent new requests from joining an older inventory lookup; each caller can stop waiting independently.

Custom agents, recipes and extension settings are Goose state. Gooseberry projects only the fields needed by the interface; raw extension commands, environments, schemas and upstream diagnostics are not sent to the browser.

## MCP

| Endpoint | Purpose |
| --- | --- |
| Application `/mcp/objective` | Session-scoped goals, tasks and questions. |
| MCP host `/browser` | Authenticated Browser automation and guidance for Goose or another trusted service. |
| MCP host `/mcp` | Legacy Browser MCP compatibility route. |
| MCP host `/v1/mcp/modules` | Authenticated catalog of published MCP modules. |
| MCP host `/<module-name>` | Namespaced MCP endpoint for one published module, currently `/browser`. |

The browser also exposes authenticated HTTP commands and artifacts. The MCP host embeds that Browser service and keeps its HTTP and `/mcp` compatibility routes while publishing `/browser` as the canonical module endpoint. The controller discovers the host catalog through one configured origin and uses Goose's administration methods to add or toggle each module as an independent global extension; the Web UI does not receive raw MCP credentials or arbitrary endpoint configuration. The Web UI uses controller-owned random browser panels over typed WebSocket methods, so the MCP token remains server-side. Panels expose HTTP(S) navigation, viewport, snapshot, screenshot, snapshot-reference click and text fill only. Setup is covered in [deployment](deployment.md#mcp-host-and-browser-module).

Projects, file and Git views, objectives and queues are Gooseberry-owned. Import/export/share and broader source administration remain out of scope until upstream offers stable operations; see the [roadmap](roadmap.md).

Other ACP agents can use the standard conversation surface when embedded with an explicit endpoint. The packaged default endpoint accepts recognized Goose only. Production selection of another agent is deferred until persisted sessions and queues can be tied to an operator-stable identity.

## Compatibility and ownership

| Surface | Contract and implemented behavior |
| --- | --- |
| Persistent conversation | Standard ACP initialization, new/load/list, prompt, cancel, permission replies, content, tool updates, plans and modes. Persistent load and list are required by the project/chat UI. Cancellation waits for the prompt to settle; stopped, limited, refused and failed turns have distinct outcomes. |
| Session configuration | Standard select options retain agent-provided IDs, labels, choices and order. Generic agents can expose unfamiliar or missing categories; grouped choices are flattened. Unknown option types are ignored and boolean support is not advertised. Goose uses its provider/model/thinking controls. [ACP configuration contract](https://agentclientprotocol.com/protocol/v1/session-config-options). |
| Optional capabilities | Images, embedded context, HTTP MCP, fork and delete are capability-gated. Without HTTP MCP, objectives/questions and Signet are unavailable to the agent. Unsupported operations return an explicit error. |
| Authentication and transport | The embedded connector expects an already authenticated ACP WebSocket endpoint. `X-Secret-Key` and `/acp` are Goose conventions; Gooseberry does not implement interactive standard ACP `authenticate`, stdio transport or host-side terminal/filesystem callbacks. |
| Goose administration | All `_goose/unstable/*` calls are Goose extensions, never baseline ACP. The [complete extension inventory](goose-extensions.md) covers administration and notifications. Source registration checks do not prove every provider flow. Missing methods fail in their own surface. |
| Goose runtime metadata | `_meta.goose.toolCall`, active-run identity, App metadata, tool notifications, message usage, notice/progress, provider/thinking IDs and `/compact` are Goose-specific. Display titles remain separate from trusted renderer identity. Notices/progress are transient, and message usage is replaced by identity when supplied. |
| MCP Apps | MCP Apps plus the Goose resource/tool bridge and Gooseberry sandbox, separate from standard ACP content. Resource tickets, origins and attached-session authorization apply. |
| Application features | Projects, read-only files/Git, goals/tasks/questions, browser panels and durable follow-up queues are Gooseberry-owned. The MCP catalog, module routes and [Browser panel leases](mcp.md#controller-panel-leases) are Gooseberry protocols carried alongside ACP/MCP. |
| Signet | Optional external HTTP MCP memory tools supplied to new or reattached sessions. Daemon health is not proof of memory storage/recall. Automatic session lifecycle hooks are separate Signet integrations, not enabled by this setting. |

Synthetic agents exercise standard session behavior, partial tool payloads, message boundaries, configuration selectors and failures. The pinned-source probe checks all referenced Goose registrations; live provider authentication, Signet storage/recall and deployment-specific networking require isolated runtime acceptance. The packaged application still selects recognized Goose only; generic-agent production identity selection remains in the roadmap.

Failed outgoing text and attachments stay in the current browser runtime with explicit retry/discard. Closing and reopening the chat preserves them; reloading the page or restarting the application does not persist this local recovery buffer. A transport failure can leave delivery uncertain, so retry is never automatic. Durable queued follow-ups have their separate restart reconciliation described above.
