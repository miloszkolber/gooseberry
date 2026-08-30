# Roadmap

Planned work builds on the [current baseline](baseline.md). Latency, resource ownership and incomplete existing behavior take priority over broader expansion. Goose continues to own conversations and runtime configuration.

## Current gaps

1. Close the project-list p95 gap on the current image. Two local comparisons exceed the 5% limit by a small amount; file and image latency pass. Keep the gate unchanged, profile before tuning, and check concurrent-client behavior alongside latency.
2. Track session leases per browser using the existing client identity and reconnect grace period. Closing one client's tab must not clear another's lease; disconnects and project closure must release abandoned leases.
3. Make the readiness deadline effective while ACP connection setup is busy. Distinguish connection status from provider readiness.
4. Show binary, oversized and unavailable-diff explanations instead of an empty view. Preserve rename source paths and distinguish failed commit-log reads from an empty log.
5. Connect the retained commit-log API and commit/pinned diff scopes to the UI. Give branch comparison an explicit base rather than treating it as uncommitted changes. Check worktrees, submodules, unusual filenames and repositories without an initial commit.

Git views remain read-only; agents perform mutations through Goose tools. The [API coverage notes](acp.md) distinguish callable methods, incomplete UI wiring and dormant components.

## Expansion

These are proposed additions, separate from the correctness fixes above.

### Session continuity

- Persist controller-owned follow-up queues with ordering, recovery and duplicate-submission protection. Goose remains the conversation store.
- Add paginated browser history and improve inactive-session eviction without changing replayed message order, images, fork lineage or concurrent observers.
- Profile transcript-size accounting under the session lock, long-history rendering and goal controls before introducing more derived state or caches.

### Goose and ACP

- Use initialization capabilities to enable supported controls and explain unavailable ones. Keep standard ACP operations separate from Goose-specific methods, with Goose as the default integration. Use advertised extension metadata where upstream supplies it; ACP does not provide a complete custom-method directory. This does not require a fork or a generic service framework.
- Review `skill.list`, browser-skill instructions and dormant extension-UI hooks against their actual callers. The browser command API is live; its skill instructions cover only a subset. Extension-dialog state has no current transport producer. Connect supported behavior without removing features just because their wiring is incomplete.
- Add export, share, import and broader source management only through supported upstream methods and small, safe browser records. Do not duplicate Goose's stores.

### Local operations

- Make readiness and degraded states easier to diagnose. Expose useful build provenance, limited logs and counters locally, without a telemetry service or another runtime.
- Improve remote setup with optional TLS/identity configuration.
- Consider a browser egress policy for private-network and cloud-metadata destinations. It does not replace the single-container filesystem trust boundary.
- Keep release notices easy to audit across the host binary and container.

## Verification and maintenance

- Add local backup/restore checks and verify schema migrations and rollback before changing persisted state. This can stay an optional maintenance tool, without a backup service or another runtime.
- Extend compatibility checks when upstream schemas or notification behavior change; method-name checks alone are insufficient.
- Measure controller p95 on the deployment host with concurrent browser activity; keep the 5% regression limit and existing authorization and recovery checks.
- Add repeatable desktop and narrow-screen fixtures for navigation, dialogs, streaming and file/image previews. Record interaction and cold-load timing alongside the JavaScript budget.
- Repeat native x86-64 browser checks; emulation is not performance evidence.
- Keep the frontend organized by responsibility. Consider a framework change or generated wire types only when the saved maintenance work exceeds the new machinery.
