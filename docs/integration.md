# Integration

The controller connects to `ws://127.0.0.1:3284/acp`, sending `GOOSEBERRY_GOOSE_SECRET_KEY` as `X-Secret-Key`. It must match Goose's `GOOSE_SERVER__SECRET_KEY`. See [setup](deployment.md) and [supported Goose release](goose.md).

## Conversations

Every session has a project and admitted working directory. Goose owns its transcript, rename/archive state and forks; Gooseberry records project placement and immediate-parent lineage.

The controller checks empty sessions individually when Goose omits them from the catalog. Archive waits for settled sessions and blocks competing operations. Reconnects and lifecycle notifications reload the catalog; reconnects also refresh open chats, and connection generations reject stale replies.

Goose ACP supplies a complete replay rather than ranges. `session.getMessages` therefore returns the newest bounded user-round page from the controller projection. Earlier requests carry its projection identity and starting index; stale identities are rejected so pages from different replays cannot be combined. Older immutable pages are copied under the session lock and encoded after it is released, while the newest snapshot remains ordered with live events through response queuing.

Queued follow-ups are durable controller state and become ordinary ACP prompts in order when the current turn settles. Safe pending work resumes after restart. If delivery may already have begun, the controller checks Goose's replay and otherwise waits for an explicit retry or removal. Steering uses Goose's session-steer method.

## MCP

| Endpoint | Access |
| --- | --- |
| Application `/mcp/objective` | Session-specific token supplied to Goose for goals, tasks and questions. |
| Browser `/mcp` | Browser bearer token, registered in private Goose configuration. |

Browser tools are `browser_command` and `browser_guidance`; detailed instructions are also at `gooseberry://browser/guide`. Commands take `session`, `command` and optional `args`. Reuse an explicit browser session ID across calls; it is independent of Goose and MCP connection IDs. `close` removes its state and artifacts.

Authenticated HTTP commands at `/v1/browser` and artifacts at `/v1/artifacts/{session}/{name}` are also available to trusted services.

## Interactive Apps

Completed tool calls with trusted Goose App metadata can open their `ui://` resource in a dialog. The application reads resources and calls tools only through the attachment's project, session, tool call and extension. An App cannot use the view to reach another chat or extension.

The browser service issues a short-lived view ticket and serves the sandbox proxy from its separate origin. Gooseberry sends resource HTML and declared policy into the sandbox, but no browser token, Goose secret or application credential. Closing the dialog revokes its ticket and tears down the App lifecycle; abandoned tickets expire.

## Settings

Global extension changes affect Goose configuration; active-chat changes affect that session. The controller reloads Goose's result. Tool inventory requires an authorized chat; permission changes use Goose's `always_allow`, `ask_before` and `never_allow` values and require an idle chat.

See [ACP coverage](acp.md), [models](models.md) and [security](security.md).
