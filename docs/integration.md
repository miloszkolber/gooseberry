# Integration

The controller connects to `ws://127.0.0.1:3284/acp`, sending `GOOSEBERRY_GOOSE_SECRET_KEY` as `X-Secret-Key`. It must match Goose's `GOOSE_SERVER__SECRET_KEY`. See [setup](deployment.md) and [supported Goose release](goose.md).

## Conversations

Every session has a project and admitted working directory. Goose owns its transcript, rename/archive state and forks; Gooseberry records project placement and immediate-parent lineage.

The controller checks empty sessions individually when Goose omits them from the catalog. Archive waits for settled sessions and blocks competing operations. Reconnects and lifecycle notifications reload the catalog; connection generations reject stale replies.

Queued follow-ups live in controller memory and become ordinary ACP prompts when the current turn settles. Steering uses Goose's session-steer method.

## MCP

| Endpoint | Access |
| --- | --- |
| Application `/mcp/objective` | Session-specific token supplied to Goose for goals, tasks and questions. |
| Browser `/mcp` | Browser bearer token, registered in private Goose configuration. |

Browser tools are `browser_command` and `browser_guidance`; detailed instructions are also at `gooseberry://browser/guide`. Commands take `session`, `command` and optional `args`. Reuse an explicit browser session ID across calls; it is independent of Goose and MCP connection IDs. `close` removes its state and artifacts.

Authenticated HTTP commands at `/v1/browser` and artifacts at `/v1/artifacts/{session}/{name}` are also available to trusted services.

## Settings

Global extension changes affect Goose configuration; active-chat changes affect that session. The controller reloads Goose's result. Tool inventory requires an authorized chat; permission changes use Goose's `always_allow`, `ask_before` and `never_allow` values and require an idle chat.

See [ACP coverage](acp.md), [models](models.md) and [security](security.md).
