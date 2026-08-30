# Roadmap

These are candidate improvements beyond the [current baseline](baseline.md), not promises or setup requirements. Move an item into current-state documentation only when implementation and proportionate verification support it.

## Verification and performance

- Confirm the local controller p95 gate on the deployment host with representative concurrent Chromium activity. Preserve the 5% limit, path authorization, replay guarantees and bounded reads.
- Establish deterministic desktop/narrow-screen screenshot fixtures for navigation, dialogs, streaming and source/image previews. Record cold-load and interaction timing alongside the enforced bundle budget.
- Profile long-history row projection and goal-control subscriptions before adding incremental state or further memoization.
- Repeat native x86-64 runtime and browser interaction checks; emulated execution is not native performance evidence.

## Goose integration

- Keep compatibility fixtures aligned with upstream updates. Method availability is only one part of compatibility: changed schemas, notification ordering and authorization behavior still need focused review.
- Consider conversation truncation, session import/export and additional provider diagnostics only where a focused workflow justifies their UI and security cost.
- Expand model/agent metadata only when Goose provides a safe, useful projection. Do not infer source capabilities or introduce independent provider/model/credential registries.

## Deployment and security

- Offer optional managed TLS/identity configuration for trusted remote deployment.
- Add an optional browser egress policy covering private-network and cloud-metadata destinations. It would complement, not replace, the shared-filesystem trust model.
- Consolidate distribution notices into a release-level dependency index if it reduces the work of auditing the existing image and host binary.

## Maintenance

- Continue organizing the existing frontend by responsibility. A framework migration is optional and needs measured improvement in maintenance cost or behavior while preserving functionality, accessibility and visual fidelity.
- Keep browser automation and the controller in one Go module behind small, explicit boundaries. Avoid a permanent language bridge, custom JSON-RPC implementation or generic service framework.
- Generate wire types only when genuine duplication outweighs the generator, allowlist and representation mappings. Keep internal Go state private.
