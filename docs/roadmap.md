# Roadmap

Current behavior is documented in the [README](../README.md), [architecture](architecture.md) and [Goose/ACP contract](acp.md). Goose remains the runtime and conversation store.

## Conditional

- Connect extension-dialog replies only when upstream exposes a stable response operation.
- Add export, share, import or broader source management only when upstream exposes stable browser-safe operations.
- Project more Goose settings only when Goose exposes stable, typed administration methods that do not reveal credentials or raw configuration.
- Expose production generic ACP selection only after persisted sessions and controller-owned queues can be bound to an operator-stable agent identity.
- Revisit the 512-entry handled-receipt cap only if observed recovery state approaches it and a safe longer-lived retention rule is defined.
- Add browser egress controls, built-in TLS or mTLS, or service identity only for a defined deployment threat model.

## Deferred

- Nested-agent durability, approvals and cancellation await reliable Goose methods or replayable events.
- Named ACP plan updates and removal await a stable capability.
- Deployment-host p95 enforcement, long-history browser paint acceptance and native x86-64 browser checks remain postponed. Local projection CPU and Chromium history paging/frame/heap probes are available in the development guide.
- Further reduce large-history traversal work using the history probe. Unchanged row reuse and viewport-scoped syntax highlighting reduce paging work and retained markup; base transcript DOM still grows with loaded history. Any windowing must preserve older-page anchors, search jumps, disclosures, native find, text selection and active tool/App lifetimes. User-visible history caps require an operator decision.
