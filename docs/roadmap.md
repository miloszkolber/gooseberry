# Roadmap

Planned work builds on the [current baseline](baseline.md). Latency, resource ownership and incomplete existing behavior take priority over broader expansion. Goose continues to own conversations and runtime configuration.

## Current gaps

1. Verify the separate application/browser deployment and deployment-host p95. The recorded optimization comparison passes the 5% limit, but predates the image split; earlier runs missed it and workstation timings vary. Keep the gate unchanged and include concurrent clients and browser activity. The [performance notes](performance.md) record the evidence and limits.
2. Give branch comparison an explicit base rather than treating it as uncommitted changes. Retain linked-worktree, submodule, unusual-filename and initial-commit checks. Keep Git views read-only.
3. Verify the new commit selector and reconnect/tab-close behavior visually on desktop and narrow screens, including keyboard use. State and protocol tests do not establish visual fidelity.

Git views remain read-only; agents perform mutations through Goose tools. The [API coverage notes](acp.md) distinguish callable methods, incomplete UI wiring and dormant components.

## Expansion

These are proposed additions, separate from the correctness fixes above.

### Session continuity

- Persist controller-owned follow-up queues with ordering, recovery and duplicate-submission protection. Goose remains the conversation store.
- Add paginated browser history and improve inactive-session eviction without changing replayed message order, images, fork lineage or concurrent observers.
- Measure long-history rendering and goal controls before introducing more derived state or caches. Inactive transcript-size accounting now reuses unchanged sizes; continue checking its invalidation boundaries when message handling changes.

### Goose and ACP

- Use initialization capabilities to enable supported controls and explain unavailable ones. Keep standard ACP operations separate from Goose-specific methods, with Goose as the default integration. Use advertised extension metadata where upstream supplies it; ACP does not provide a complete custom-method directory. This does not require a fork or a generic service framework.
- Review `skill.list` and dormant extension-UI hooks against their actual callers. Extension-dialog state has no current transport producer. Keep browser MCP guidance aligned with the supported command API. Connect supported behavior without removing features just because their wiring is incomplete.
- Add export, share, import and broader source management only through supported upstream methods and small, safe browser records. Do not duplicate Goose's stores.

### Local operations

- Make readiness and degraded states easier to diagnose. Expose useful build provenance, limited logs and counters locally, without a telemetry service or another runtime.
- Improve remote setup with optional TLS/identity configuration.
- Consider a browser egress policy for private-network and cloud-metadata destinations. Separate state mounts do not restrict host-network access.
- Keep image release notices and compatibility with user-installed upstream Goose easy to audit.

## Verification and maintenance

- Add local backup/restore checks and verify schema migrations and rollback before changing persisted state. This can stay an optional maintenance tool, without a backup service or another runtime.
- Extend compatibility checks when upstream schemas or notification behavior change; method-name checks alone are insufficient.
- Add repeatable desktop and narrow-screen fixtures for navigation, dialogs, streaming and file/image previews. Record interaction and cold-load timing alongside the JavaScript budget.
- Repeat native x86-64 browser checks; emulation is not performance evidence.
- Keep the frontend organized by responsibility. Consider a framework change or generated wire types only when the saved maintenance work exceeds the new machinery.
