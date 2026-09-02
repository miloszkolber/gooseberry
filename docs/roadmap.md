# Roadmap

Current behavior is documented in the [README](../README.md), [architecture](architecture.md) and [Goose/ACP contract](acp.md). Goose remains the runtime and conversation store.

## Conditional

- Connect extension-dialog replies and add export, share, import or broader source management only when upstream exposes stable operations.
- Expose production generic ACP selection only after persisted sessions and controller-owned queues can be bound to an operator-stable agent identity.
- Compact durable queue receipts only if observed state approaches its limit and a safe retention rule is defined.
- Add browser egress policy or remote TLS and identity only for a defined deployment threat model.

## Deferred

- Nested-agent durability, approvals and cancellation await reliable Goose methods or replayable events.
- Named ACP plan updates and removal await a stable capability.
- Deployment-host p95 enforcement, long-history acceptance and native x86-64 browser checks remain postponed.
