# Roadmap

The [baseline](baseline.md) describes the application today. Priorities are incomplete behavior, latency and session continuity. Goose remains the runtime and conversation store.

## Finish existing behavior

- **Performance acceptance.** Run the [comparison probe](performance.md#run-a-comparison) against the unchanged 5% controller p95 gate on the deployment host with separate application/browser containers, concurrent clients and Chromium activity. Include reconnect-to-interactive time and long histories. Workstation measurements are not deployment acceptance. Repeat browser checks on native x86-64.
- **Interactive Apps.** Host Goose's `ui://` resources in a sandbox with explicit resource access, mediated tool calls and lifecycle handling. Preserve ordinary app-management results. Do not inject resource HTML into the main UI.
- **Nested agents.** Show supported summon/orchestrator activity without creating another conversation store. Verify child cancellation, permissions and concurrent observation against upstream behavior; child approval forwarding is not complete in pinned Goose.
- **Git branch comparison.** Compare against an explicit branch base. Keep linked-worktree, submodule, unusual-filename and unborn-branch coverage. Git views remain read-only.
- **UI acceptance.** Keep repeatable desktop/narrow-screen checks for commit selection, reconnects, tab closing, streaming, dialogs and file/image previews. Include keyboard use, overflow and interaction timing; state tests alone are insufficient.
- **Dormant surfaces.** Connect retained `skill.list` and extension-dialog hooks where upstream provides a usable operation. Keep browser MCP guidance aligned with its commands.

## Session continuity and integration

- Persist follow-up queues with ordering, idempotency and restart recovery. Goose remains the conversation store.
- Paginate browser history and improve inactive-session eviction while preserving replay, images, tool order, forks and multiple observers. Include unfinished tool previews in reload snapshots.
- Use advertised ACP capabilities to enable controls and explain unavailable operations. Keep Goose-specific methods separate; support other ACP agents where the contract fits, without a fork or generic service framework.
- Add export/share/import and broader source management only through supported upstream methods and small browser-safe records.

## Operations and maintenance

- Add useful local readiness/degradation details, build provenance, bounded logs and performance counters without telemetry or another monitoring runtime.
- Check backup/restore, schema migration and rollback before changing persisted state.
- Consider browser egress controls for private networks and cloud-metadata endpoints, plus optional TLS/identity setup for remote access.
- Extend protocol tests when upstream payloads change. Keep tests focused on persistence, reconnect/replay, concurrent chats, permissions, path isolation and fragile interactions.
- Keep frontend code grouped by responsibility. Generate duplicated wire types or change frameworks only when this clearly reduces maintenance.
