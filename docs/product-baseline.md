# Mewa Code product baseline

## Product goal

Mewa Code is a focused, ready-to-run Web UI and ACP host for the Pi Coding Agent. It is intended to replace the useful parts of OpenChamber without becoming a full IDE or a second agent framework.

The product should make Pi convenient for repository and multi-repository coding work while keeping Pi itself recognizably upstream, mostly immutable, and authoritative for normal agent behavior.

## Core principles

1. **Pi is the engine.** Mewa uses Pi's public SDK and extension mechanisms. It does not replace Pi's provider registry, model catalog, session format, built-in tools, retry, compaction, project trust, usage accounting, or normal prompt behavior.
2. **Mewa is thin and opinionated.** It supplies a small fixed integration profile, projects Pi state into Web UI and ACP, and owns only product concepts Pi does not own.
3. **SSH is hidden infrastructure.** Pi's public `bash` tool keeps its normal schema and renderer while command execution happens through the host SSH account. Agents do not receive an `ssh` tool.
4. **The host is the development environment.** Language runtimes, package managers, Docker, system services, and project tooling stay on the host rather than being bundled into the controller image.
5. **Web UI and ACP are the interfaces.** There is no Mewa TUI and no Web UI terminal.
6. **Deletion is preferred to adaptation.** ThinkRail-derived abstractions, dependencies, tests, and UI surfaces survive only when this baseline requires them.

## Product model

### Projects

A project is one or more admitted absolute directory roots. It does not need to be a Git repository.

- A normal project has one directory root.
- A project may contain zero, one, or several Git repositories.
- A project may manually group several disjoint roots for coordinated work.
- Sessions belong to a project and have an explicit working directory under one of its roots.
- The project model must not force a branch, worktree, or repository selection before an agent can work.

### Git

Git is observational rather than managerial.

- Mewa discovers Git repositories below project roots with bounded traversal.
- The UI shows repository path/name, current branch or detached HEAD, clean/dirty state, changed files, and readable diffs.
- Git state refreshes after relevant agent work and on demand.
- Agents may create or switch branches through normal Bash; the UI reflects the result.
- Mewa does not provide GitHub/GitLab integration, pull requests, review submission, staging workflows, branch creation controls, or worktree management UI.

### Sessions and chat

- A project may have several persistent Pi sessions, including concurrent sessions.
- The browser reconstructs sessions from controller/Pi state and is not the canonical transcript store.
- Streaming text, thinking, tool calls/results, retries, compaction, errors, completion, model identity, reasoning level, token use, context use, and cost come from Pi state/events.
- A message may include several images in one turn with previews, removal before send, and clear validation failures.

### Files

- The UI provides a bounded read-only file tree and preview for admitted project roots.
- Source previews use Shiki syntax highlighting.
- There is no editor, save flow, Monaco dependency, LSP, refactoring UI, debugger, or collaborative editing.

### Goals and tasks

A session may have one goal and a lightweight task list.

- Goal and tasks survive reload/resume.
- Tasks have only pending, active, and done states.
- A small Pi extension exposes the same state to the agent through context and a structured tool.
- Goal/task context is ephemeral; it does not replace Pi's system prompt or rewrite the canonical transcript.
- This is not a workflow engine, specification graph, approval system, or project-management product.

### Subagents

Subagents are tightly integrated in-process Pi child sessions, not Markdown-only roles or a separate harness.

The built-in roles are:

- **scout** — read-only exploration, research, file/symbol discovery, and evidence gathering.
- **builder** — implementation of both small and substantial scoped changes; replaces the former worker/specialist split.
- **strategist** — read-only architecture, difficult decisions, migrations, and actionable planning.
- **auditor** — read-only independent review of requirements, implementation, security, regressions, and verification.

Rules:

- Children inherit project roots, working directory, guards, integrations, parent defaults, and Pi runtime generation.
- Read-only roles cannot edit or write through active Pi tools.
- Children cannot delegate recursively.
- Parent/child identity, role, task, status, current tool, output, failure, duration, model, reasoning, tokens, and cost are structured and visible in the UI.
- The primary agent should delegate only when a separate workstream, independent evidence, parallelism, or independent review provides a clear benefit.

### Model routing

Role definitions are provider/model agnostic.

- Roles declare allowed model groups and reasoning ranges, not provider-specific model IDs.
- Initial model groups are `economy`, `balanced`, `strong`, and `deep`.
- The orchestrator chooses a role, model group, and reasoning level based on task complexity, expected benefit, and usage cost.
- A resolver selects the cheapest healthy available Pi model that satisfies the requested group.
- Provider-specific classification lives in one small routing module and never in role prompts.
- Exact model choice and usage data remain visible.

## Fixed Mewa profile

The normal image ships preconfigured with:

- protected-state guard — always enabled;
- transparent SSH Bash (`mewa-remote`) — always enabled;
- isolated browser QA — enabled;
- web search/fetch — enabled;
- goals/tasks — available;
- subagents — available;
- Signet memory — optional.

The ordinary product settings surface contains only:

- Pi/provider authentication actions;
- Signet enabled/disabled;
- Signet address/port where needed.

SSH keys and known-hosts material are deployment credentials. Mount roots, internal service tokens, network bindings, and transport limits are deployment plumbing rather than end-user behavior settings.

There is no themes manager, skills manager, Pi profile toggles, terminal settings, workflow settings, or general extension marketplace in the Mewa UI. Pi user/project skills and extensions may still work through Pi itself.

## Interfaces

### Web UI

The product shell is centered on:

- directory-based projects and their sessions;
- active chat and multi-image composer;
- goal/tasks;
- subagent activity;
- Pi-reported usage/context/cost;
- discovered Git repositories, branches, changes, and diffs;
- read-only file tree and preview;
- provider authentication and optional Signet status.

The entire interface uses one bundled monospaced font. A simple system light/dark treatment is acceptable; a theme registry is not.

### ACP

ACP is a first-class stdio NDJSON interface to the same Pi session host. It must not create a second agent lifecycle, model registry, session store, or tool semantics.

## Runtime and delivery

- `mewa-code` and `mewa-browser` are separate images.
- Final images use multi-stage builds, exact dependency pins, digest-pinned bases where practical, non-root users, read-only roots, and bounded writable state/tmpfs.
- Final images exclude source trees, tests, compilers, headers, package caches, development dependencies, and build tooling.
- The controller contains only the Pi/Mewa runtime, minimal shell/SSH/Git/CA/init requirements, and retained provider libraries.
- The browser image contains only Chromium/runtime libraries, stable-rendering fonts, the bounded browser service, CA certificates, and a small init when required.
- Pi package-family versions are exact and internally consistent, but a scheduled workflow keeps them on the newest stable compatible release through atomic update pull requests.
- Forked extensions or Pi packages require a documented minimal delta and an upstream-sync path.

## Testing

Tests protect observable product contracts and meaningful security/failure boundaries. They do not preserve imported abstractions.

High-value contracts include:

- controller/Web UI/ACP startup and connection;
- project roots and multi-repository discovery;
- persistent isolated Pi sessions and multi-image turns;
- SSH-backed Bash without credential forwarding;
- Git branch/status/diff projection;
- read-only file preview;
- goal/task persistence and Pi context/tool integration;
- subagent permissions, no recursion, routing, progress, and usage attribution;
- isolated browser operation;
- Signet enabled/disabled behavior;
- protected state and credential boundaries;
- final image contents and non-root/read-only operation.

## Explicit non-goals

- Web UI terminal or terminal persistence;
- full IDE/workbench, editor, LSP, debugging, or refactoring UI;
- manual branch/worktree management;
- GitHub/GitLab integration;
- themes or skills management UI;
- TUI;
- workflow engine, automations, specification graphs, approval flows, or self-improvement loops;
- compatibility layers for other agents' private role/skill formats;
- native desktop/mobile shell, hosted cloud service, marketing site, or release installer during the rewrite.
