# Roadmap

The [baseline](baseline.md) describes the application today. Priorities are incomplete behavior, latency and session continuity. Goose remains the runtime and conversation store.

## Finish existing behavior

- **UI acceptance.** Keep repeatable desktop/narrow-screen checks for commit selection, reconnects, tab closing, streaming, dialogs and file/image previews. Include keyboard use, overflow and interaction timing; state tests alone are insufficient.
- **Dormant surfaces.** Connect the retained extension-dialog hooks when upstream provides a usable operation. Keep browser MCP guidance aligned with its commands.

## Session continuity and integration

- Paginate browser history and improve inactive-session eviction while preserving replay, images, tool order, forks and multiple observers.
- Use advertised ACP capabilities to enable controls and explain unavailable operations. Keep Goose-specific methods separate; support other ACP agents where the contract fits, without a fork or generic service framework.
- Add export/share/import and broader source management only through supported upstream methods and small browser-safe records.

## Operations and maintenance

- Add useful local readiness/degradation details, build provenance, bounded logs and performance counters without telemetry or another monitoring runtime.
- Check backup/restore, schema migration and rollback before changing persisted state.
- Make session deletion recoverable across partial record, objective and queue-store failures without treating older backups as deletion authority.
- Bound queue-recovery fan-out and compact durable request receipts if persisted queue state approaches its file limit.
- Consider browser egress controls for private networks and cloud-metadata endpoints, plus optional TLS/identity setup for remote access.
- Extend protocol tests when upstream payloads change. Keep tests focused on persistence, reconnect/replay, concurrent chats, permissions, path isolation and fragile interactions.
- Keep frontend code grouped by responsibility. Generate duplicated wire types or change frameworks only when this clearly reduces maintenance.

## Deferred

- **Nested-agent upstream gaps.** Add durable child activity, child approvals, direct asynchronous-child cancellation and Orchestrator nested activity only when Goose exposes reliable methods or replayable events. Do not add a second conversation store.
- **Deployment acceptance.** Run the [comparison probe](performance.md#run-a-comparison) on the deployment host before enforcing the unchanged 5% controller p95 gate. Include separate application/browser containers, concurrent clients, Chromium activity, reconnect-to-interactive time and long histories. Workstation measurements remain reference evidence. Repeat browser checks on native x86-64.
