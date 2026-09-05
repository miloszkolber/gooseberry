# Goose extension inventory

These 53 methods and notifications are outside standard ACP. The pinned Goose source-registration probe checks them against actual controller call sites; see [verification](development.md#goose-compatibility) and [ownership](acp.md#compatibility-and-ownership). They remain guarded by Goose identity recognition.

| Extension | Kind |
| --- | --- |
| `_goose/unstable/agent-mentions/list` | methods |
| `_goose/unstable/config/extensions/add` | methods |
| `_goose/unstable/config/extensions/list` | methods |
| `_goose/unstable/config/extensions/remove` | methods |
| `_goose/unstable/config/extensions/set-enabled` | methods |
| `_goose/unstable/config/remove` | methods |
| `_goose/unstable/defaults/clear` | methods |
| `_goose/unstable/defaults/read` | methods |
| `_goose/unstable/defaults/save` | methods |
| `_goose/unstable/preferences/read` | methods |
| `_goose/unstable/preferences/save` | methods |
| `_goose/unstable/providers/authentication/device-code` | notifications |
| `_goose/unstable/providers/canonical-model-info` | methods |
| `_goose/unstable/providers/config/authenticate` | methods |
| `_goose/unstable/providers/config/delete` | methods |
| `_goose/unstable/providers/config/read` | methods |
| `_goose/unstable/providers/config/save` | methods |
| `_goose/unstable/providers/inventory/refresh` | methods |
| `_goose/unstable/providers/list` | methods |
| `_goose/unstable/providers/readiness/check` | methods |
| `_goose/unstable/recipes/delete` | methods |
| `_goose/unstable/recipes/list` | methods |
| `_goose/unstable/recipes/parse` | methods |
| `_goose/unstable/recipes/save` | methods |
| `_goose/unstable/recipes/scan` | methods |
| `_goose/unstable/resources/read` | methods |
| `_goose/unstable/schedules/create` | methods |
| `_goose/unstable/schedules/delete` | methods |
| `_goose/unstable/schedules/list` | methods |
| `_goose/unstable/schedules/pause` | methods |
| `_goose/unstable/schedules/run-now` | methods |
| `_goose/unstable/schedules/running-job/inspect` | methods |
| `_goose/unstable/schedules/running-job/kill` | methods |
| `_goose/unstable/schedules/sessions/list` | methods |
| `_goose/unstable/schedules/unpause` | methods |
| `_goose/unstable/schedules/update` | methods |
| `_goose/unstable/session/archive` | methods |
| `_goose/unstable/session/extensions/add` | methods |
| `_goose/unstable/session/extensions/list` | methods |
| `_goose/unstable/session/extensions/remove` | methods |
| `_goose/unstable/session/info` | methods |
| `_goose/unstable/session/rename` | methods |
| `_goose/unstable/session/steer` | methods |
| `_goose/unstable/session/unarchive` | methods |
| `_goose/unstable/session/update` | notifications |
| `_goose/unstable/slash-commands/list` | methods |
| `_goose/unstable/sources/create` | methods |
| `_goose/unstable/sources/delete` | methods |
| `_goose/unstable/sources/list` | methods |
| `_goose/unstable/sources/update` | methods |
| `_goose/unstable/tools/call` | methods |
| `_goose/unstable/tools/list` | methods |
| `_goose/unstable/tools/permissions/set` | methods |

Non-method metadata, WebSocket authentication conventions, MCP Apps, queues, objectives and Signet are described in the ownership matrix. No provider credentials are stored by this inventory.
