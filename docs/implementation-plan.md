# Implementation plan

This plan is ordered for coding agents. Each phase should be a focused commit or small commit series. Delete obsolete code and tests in the same phase that removes the behavior.

## 1. Establish the baseline and remove repository ceremony

- Make `product-baseline.md` authoritative.
- Keep only useful product/architecture/security/current-state/implementation documentation.
- Remove CODEOWNERS, issue templates, pull-request templates, generic code-of-conduct/contributing boilerplate, and references to them.

Acceptance: documentation describes the same product and no stale terminal/editor/worktree/theme/skills-management requirement remains.

## 2. Remove the Web UI terminal and PTY backend

- Remove terminal panels, settings, state, transport messages, server terminal manager, tests, and browser-terminal SSH code.
- Remove `bun-pty`, xterm packages/addons, PTY native library handling, and terminal-specific image/runtime code.
- Preserve Pi Bash over SSH.

Acceptance: no terminal UI/protocol/runtime remains; controller, Web UI, ACP, and SSH Bash still build.

## 3. Reduce the UI to the OpenChamber-like shell

Retain:

- project/session sidebar;
- chat and multi-image composer;
- goal/tasks;
- subagent activity;
- usage/context/cost;
- Git repositories/branches/changes/diffs;
- read-only file tree/preview;
- provider authentication and optional Signet state.

Remove:

- workbench/layout system;
- editor/save flow and Monaco;
- branch/worktree management controls;
- theme registry/settings;
- skills management UI;
- Pi profile settings and routine model/reasoning selectors.

Use one bundled monospaced font throughout. Keep Shiki for source and diff highlighting.

Acceptance: the UI has no editing or terminal path and its dependency graph matches retained surfaces.

## 4. Introduce directory-based multi-root projects

- Replace repository/workspace-first identity with `Project { id, name, roots[] }`.
- Migrate existing persisted projects to one-root projects.
- Admit every root through `MEWA_MOUNT_ROOTS` and protected-state checks.
- Allow a session cwd below any project root.

Acceptance: a project may be a non-Git directory, contain several repositories, or group disjoint roots.

## 5. Add bounded Git discovery and aggregate projection

- Discover nested repositories below project roots with fixed depth/count/ignore bounds.
- Project repository branch/detached state, dirty state, changed/untracked paths, and diffs.
- Refresh after relevant Pi tool completion, when opening Git UI, and manually.
- Remove branch checkout, staging, worktree creation, and hosting-provider behavior.

Acceptance: an agent can change branches through Bash and the UI reports the new state across several repositories.

## 6. Extract `mewa-remote`

- Create a small package owning SSH config, command construction, execution, and Pi Bash operations.
- Move the current SSH Bash extension and tests into it.
- Keep strict host-key checking, explicit credentials, minimal environment, cancellation, timeout, and streaming.
- Do not add SFTP or a model-visible SSH tool.

Acceptance: Pi Bash and `!` commands execute remotely with Pi's normal schema/renderer.

## 7. Replace profile toggles with the fixed Mewa profile

- Always load protected-state guard, `mewa-remote`, browser, web access, goals/tasks, and subagents.
- Retain only optional Signet enablement and endpoint/port.
- Remove profile capability toggles and matching UI/settings state.
- Keep provider authentication Pi-owned.

Acceptance: a fresh image is usable after deployment credentials/provider auth, without extension assembly.

## 8. Expose complete provider and model management

- List every provider present in Pi's provider registry, model catalog, or credential store without a Mewa allowlist.
- Expose Pi-supported OAuth and API-key actions and clearly label providers managed through environment/configuration/extensions.
- Project the complete Pi model catalog, including unavailable models.
- Show context/output limits, input modality, reasoning support, availability, and Pi-reported input/output/cache/tiered pricing.
- Persist individual and bulk model visibility as Mewa presentation state without mutating Pi's canonical catalog.
- Add focused tests for metadata projection, provider coverage, persistence, filtering, and visibility controls.

Acceptance: every Pi provider/model is inspectable in the Web UI, supported credentials can be configured through Pi, and hidden models remain distinct from unavailable or deleted models.

## 9. Refactor subagents into typed roles

- Add `scout`, `builder`, `strategist`, and `auditor` typed role definitions.
- Merge worker/specialist behavior into `builder`.
- Enforce role tool access; read-only roles cannot write.
- Remove the subagent tool from child sessions to prevent recursive delegation.
- Expose role and relationship data through the existing structured child-session protocol/UI.

Acceptance: each role behaves according to permissions, and children cannot create grandchildren.

## 10. Add provider-agnostic cost-aware model routing

- Add model groups: `economy`, `balanced`, `strong`, `deep`.
- Keep provider-specific mappings in one routing module.
- Use Pi's available catalog, pricing/metadata where available, and health/auth state.
- Resolve the cheapest suitable candidate for the requested group and reasoning range.
- Let the parent request role/group/reasoning rather than a provider-specific model ID.
- Surface chosen model, reasoning, duration, tokens, and cost.

Acceptance: role prompts contain no provider IDs and routing falls back predictably when a preferred model is unavailable.

## 11. Extend goals to lightweight tasks

- Store one goal plus tasks with pending/active/done states.
- Add small controller APIs and Web UI controls.
- Extend the Pi goal extension with concise ephemeral context and one structured update tool.
- Preserve Pi transcript history when objectives change.

Acceptance: state survives restart/resume and both UI and agent see the same objective.

## 12. Automate Pi-family updates

- Keep exact Pi family versions in the dependency catalog.
- Add a scheduled workflow that discovers the newest stable family, updates all packages atomically, refreshes the lockfile, runs the focused compatibility suite, and opens an update PR.
- Audit the `@earendil-works` namespace delta; return to direct upstream packages when no fork-only behavior is required, otherwise document and continuously sync the minimal fork.

Acceptance: reproducible builds and routine upstream updates coexist.

## 13. Simplify deployment configuration

- Keep provider authentication in Pi/Web UI.
- Keep SSH key/known-hosts material and optional Signet enablement/port as the meaningful operator inputs.
- Default or generate internal service tokens and transport tuning where practical.
- Treat mount roots/network binding as deployment plumbing rather than product preferences.

Acceptance: normal setup does not require assembling extensions or choosing internal policy toggles.

## 14. Prune dependencies and images

- Remove packages made obsolete by terminal/editor/workbench/theme/skills UI deletion.
- Rebuild production dependency pruning around retained runtime imports.
- Verify final images exclude source, tests, toolchains, caches, PTY/editor dependencies, and unused assets.

Acceptance: non-root read-only images build for supported architectures and contain only retained runtime capability.

## 15. Replace inherited tests with the focused contract suite

Keep tests for startup/transport, projects/multi-repo Git, session persistence/isolation, images, SSH Bash, file preview, goals/tasks, subagent permissions/routing/usage, ACP, browser isolation, Signet degradation, protected paths, and final images.

Delete tests whose only purpose is preserving removed ThinkRail abstractions.

## Working rules

- Inspect only the affected subsystem before each phase.
- Prefer deletion to compatibility adapters.
- Make the smallest coherent change and update documentation with boundary changes.
- Run narrow tests during development; run the full retained compatibility/image gate for cross-boundary or release changes.
- Do not silently broaden product scope to save an inherited abstraction.
