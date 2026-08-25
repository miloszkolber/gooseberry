# Rewrite implementation record

The rewrite phases are complete in the implementation. [`product-baseline.md`](product-baseline.md) remains the authoritative product contract; this file records the delivered sequence so future maintenance does not recreate removed abstractions.

1. Removed repository ceremony and stale contribution/release scaffolding.
2. Removed the Web UI terminal, PTY backend, Monaco editor, save flow, and their runtime dependencies.
3. Reduced the browser shell to projects, chats, goals/tasks, child activity, usage, files, Git visibility, provider/model management, and Signet status.
4. Replaced repository/worktree identity with persistent directory-based multi-root projects and explicit session working directories.
5. Added bounded nested-Git discovery and observational branch, status, change, commit, and diff projection.
6. Extracted strict SSH execution and transparent Pi Bash replacement into `@mewa-code/mewa-remote`; no SFTP or model-visible SSH tool was added.
7. Replaced capability switches with the fixed Mewa profile and reduced Signet settings to enabled state, address, and port.
8. Preserved complete Pi-backed provider/model projection and Mewa-only model visibility preferences.
9. Added typed scout, builder, strategist, and auditor child roles with enforced read-only boundaries and no recursive delegation.
10. Added centralized provider-independent economy, balanced, strong, and deep model routing with lowest-cost healthy suitable selection.
11. Added persistent session goals and ordered pending/active/done tasks in the Web UI and Pi extension context/tool.
12. Reconciled Web UI and ACP lifecycle behavior around project identity and one process-global Pi session registry.
13. Added generated deployment authentication, ready-to-pull GHCR image publishing, and an idempotent deployment setup helper.
14. Added atomic scheduled Pi-family update pull requests and documented fork/upstream-sync policy.
15. Replaced imported abstraction tests with focused project, Git, SSH, profile, goal/task, subagent, routing, authentication, image, and runtime checks.

Future changes should extend these product concepts directly. Do not restore worktree management, editing, terminal, profile-toggle, or alternate agent-framework compatibility layers unless the product baseline is deliberately revised first.
