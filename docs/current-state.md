# Current implementation state

Mewa Code now implements the product contract in [`product-baseline.md`](product-baseline.md). The rewrite no longer uses Git repositories, branches, or worktrees as project identity.

## Product model

- Projects contain one or more admitted absolute directory roots and may contain zero, one, or many Git repositories.
- Sessions belong to projects and persist their explicit working directory.
- Git is discovered with bounded traversal and projected read-only as repository, branch or detached HEAD, status, changes, commits, and diffs.
- Files are exposed through a bounded read-only tree and preview. There is no editor, save flow, terminal, PTY, worktree manager, staging flow, or hosting-provider integration.

## Pi integration

- The controller embeds Pi and preserves Pi ownership of sessions, providers, models, credentials, retry, compaction, trust, and usage accounting.
- The fixed Mewa profile always loads protected-state guarding, SSH-backed Bash, browser QA, web access, goals/tasks, and subagents.
- Signet is the only optional integration and is configured by enabled state plus address and port.
- Pi user resources remain Pi-owned. Project resources follow Pi's project-trust setting and are not silently admitted by Mewa.

## Goals, tasks, and subagents

- Each session may persist one goal and an ordered task list with `pending`, `active`, and `done` states.
- The `objective_update` extension exposes the same state to Pi through ephemeral context and a structured tool.
- Subagents use typed `scout`, `builder`, `strategist`, and `auditor` roles. Read-only roles cannot write, children cannot delegate, and child progress and Pi-reported usage remain structured.
- Routing uses provider-independent `economy`, `balanced`, `strong`, and `deep` groups. Provider/model classification is isolated in one module and the resolver selects the lowest-cost healthy suitable model.

## Runtime and delivery

- `@mewa-code/mewa-remote` owns strict SSH command execution and Pi Bash replacement. Files and Git continue to use same-path mounts; SFTP is intentionally absent.
- Compose can generate and retain the controller login token, uses an internal browser-service token by default, and requires only mount and SSH credentials for a normal deployment.
- The container workflow validates both architectures and publishes controller and browser images to GHCR from `main` and version tags.
- A scheduled workflow atomically checks and updates the exact Pi package family through a pull request. Fork delta and sync policy are documented in [`pi-fork-delta.md`](pi-fork-delta.md).

## Deliberate boundaries

Mewa remains a trusted single-user appliance, not a hostile-code sandbox or multi-tenant service. It does not include SFTP, a browser terminal, a full IDE, project-management workflows, a general extension marketplace, or manual branch/worktree controls.
