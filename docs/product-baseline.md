---
id: goal-and-requirements
type: goal-and-requirements
status: active
title: Mewa Code product baseline
covers: [product-goal, web-ui, pi-contract, scope, security, delivery]
tags: [product, baseline]
---

## Authority

This document is the canonical product baseline for the Mewa Code simplification. It records the user's explicit decisions from the August 2026 design conversation, keeps only compatible constraints from the pre-ThinkRail Mewa implementation, and treats ThinkRail as implementation material rather than product scope.

When sources disagree, use this order:

1. The latest explicit user decision.
2. This baseline.
3. Pi's documented behavior and public SDK contract.
4. Current implementation documents as evidence of what exists, not proof that it should remain.
5. Older Mewa and upstream ThinkRail documents as historical context only.

## Product definition

Mewa Code is a separate product, developed in the existing `mewa_code` repository, that provides a focused web interface for the Pi Coding Agent. “OpenChamber-like” means a simple project-and-session sidebar leading to a focused chat view with persistent history. It does not import OpenChamber's implementation or entire feature set. Mewa Code ships Pi with a curated, visible configuration and tightly integrates required Pi tools and extensions with matching web UI surfaces. It is not a new agent framework, workflow platform, full IDE, GitHub client, or repackaged ThinkRail product.

The browser UI and a local engine host are the product. A native desktop application, public marketing website, and hosted cloud service are not required. The host may be used on the same machine or over a trusted private network when exposure and authentication are configured safely.

## Pi agent contract

Pi is the only agent runtime. Mewa Code uses Pi's in-process SDK and does not add a second harness such as the Claude Agent SDK.

Pi remains authoritative for:

- provider credentials and authentication
- provider and model catalogs
- selected model and thinking level
- system prompt and normal agent behavior
- built-in tools
- user and project skills and extensions
- project trust
- retry and compaction behavior
- token, context, and cost accounting
- canonical JSONL session history

Mewa Code exposes those capabilities and invokes explicit user actions without maintaining competing registries or recomputing Pi state. It may supply documented defaults when Pi has no explicit user value, but it must preserve explicit Pi settings, never auto-trust a repository, and never hide an always-on workflow prompt.

The default Mewa profile includes the protected-state guard, browser QA, web search and fetch, memory integration, session goals, and subagent support. These capabilities use Pi's extension and tool mechanisms and have first-class web UI renderers or controls. Their configuration is visible, non-secret options are editable, and non-safety capabilities can be disabled. The web UI and Pi integration are one product contract: the host does not expose an agent tool that the UI cannot represent clearly, and the UI does not invent agent state that Pi or a named extension does not own.

The protected-state guard denies Pi and Mewa credential or state roots across file, search, visible shell-path, subagent, and extension access. It must not alter unrelated prompts, add general host-control tools, or restrict the selected repository. UI transport adapters project Pi state and events without creating a second agent lifecycle.

Pi dependencies use one exact, internally consistent version across the complete package family. Simple routine update discovery should identify the newest stable Pi release, update the family together, and validate the focused integration surface. Runtime dependency ranges must not float silently.

## Required web UI capabilities

### Repositories and projects

- A project is a local Git repository selected by the user.
- The UI lists known projects and allows a repository to be opened, removed from the known-project list, and reopened without deleting the repository or its Pi sessions.
- Sessions are grouped by repository so it is always clear which working directory and Git state a session belongs to.
- The repository's normal working tree is the default workspace. Mewa Code must not force a new branch or Git worktree for every session.
- Worktrees are supported as an explicit project feature. Users can remain in the normal working tree, create a worktree, or attach an existing worktree. Mewa Code must not force worktree creation.

### Sessions and chat

- A project can have multiple persistent Pi sessions.
- At minimum, users can create, select, resume, and abort active generation in a Pi session without disposing that session or affecting unrelated sessions. Rename, retry controls, and deletion are optional follow-up interactions unless Pi requires them for correct lifecycle handling.
- Multiple sessions may run concurrently without events, drafts, models, or usage data crossing between them.
- Reloading the page or restarting the host reconstructs sessions from host and Pi state. The browser is a projection, not the canonical session store.
- Streaming text, thinking, tool calls, tool results, errors, retries, compaction, and completion state are represented without inventing a second lifecycle.
- The UI exposes Pi's current model and thinking level per session and allows explicit user changes through Pi.
- The UI exposes Pi-supported provider status and credential actions. Authentication, model choice, thinking level, and settings remain explicit user choices carried out through Pi rather than Mewa-owned configuration.

### Images

- A user can attach multiple images to one message.
- The composer provides previews and allows individual attachments to be removed before sending. These are derived interaction requirements needed to make multi-image submission controllable, not a separate media-management feature.
- Validation and size handling respect Pi and provider limits and fail clearly before a bad request is sent.
- Image handling must not silently discard attachments or convert a multi-image message into separate turns.

### Usage and context

- Each session shows the token usage, cost, and context-window information Pi reports.
- Usage is attributed to the correct session and updated from Pi events or Pi session state.
- Mewa Code does not estimate a competing total when Pi already supplies the value.
- A later cross-session ledger is optional. It is not required for the baseline.

### Local Git

- The UI shows local repository status and changed files.
- Users can inspect readable local diffs for tracked changes. Untracked files must appear in status, but rendering their full contents is not required.
- Git operations are scoped to the selected repository and never assume a GitHub remote.
- GitHub accounts, pull requests, checks, issues, review submission, and provider-specific metadata are not required.

### Files, editor, terminal, and worktrees

- The UI includes a lightweight repository file tree and text-file viewer/editor.
- The editor supports ordinary source edits, save, dirty state, and navigation to changed files. LSPs, IDE refactors, collaborative editing, and elaborate docking are not required.
- Each repository or selected worktree can open a real terminal rooted at its working directory.
- Terminal controls cover create, attach, resize, input, output, and close. Host-restart persistence and complex terminal layout orchestration are not required.
- The project UI lists the normal working tree and Git worktrees. Users can create a worktree, attach an existing worktree, switch context, and remove only Mewa-managed worktrees with clear confirmation.
- Sessions, Git, files, and terminals always show which working directory they target.

### Browser QA

- Mewa Code includes an isolated `mewa-browser` service rather than running Chromium beside Pi credentials and repositories.
- A Pi extension exposes bounded browser actions for HTTP(S) navigation, readable and accessibility snapshots, screenshots, common interactions, viewport changes, web-vitals inspection, and session close.
- The web UI renders browser steps, snapshots, screenshots, failures, and artifact links as first-class tool results.
- The browser API uses independent authentication, deadlines, output limits, session limits, storage quotas, and guarded artifact paths.
- Browser profiles and artifacts are temporary. Chromium receives no Pi credential mount, repository mount, host-control socket, arbitrary command execution, local-file URL, or unrestricted CLI surface.

### Web search and fetch

- Pi receives configured web-search and web-fetch tools through a focused extension or MCP adapter.
- Search and fetch results retain source URLs and enough metadata for the chat UI to present useful citations.
- The backend and API key are configuration, not hard-coded product identity. Missing optional credentials produce a clear unavailable state rather than breaking sessions.
- Search, fetch, and full browser interaction remain distinct tools because they have different cost and security boundaries.

### Memory

- Pi receives a memory extension that can recall relevant durable context and save explicit durable outcomes.
- Mewa Code exposes memory availability and activity without maintaining a duplicate memory database.
- The extension degrades cleanly when its configured backend is unavailable and never blocks an otherwise valid Pi session.
- Automatic capture, if enabled, is visible and configurable. Credentials, raw secrets, and transient logs are not stored as memories.

### Session goals

- A session may have one visible, editable goal that survives reload and resume.
- Agent-facing goal behavior is implemented as a small Pi extension, not by replacing Pi's system prompt in the host.
- The UI shows the active goal and any extension-reported status without turning goals into a general workflow or specification engine.
- The goal extension is part of the curated Mewa profile and becomes active for a session when the user creates a goal.
- Clearing the goal removes the active stored goal and disables its agent-facing extension behavior for future turns. Existing Pi transcript history is unchanged.

### Subagents

- Mewa Code supports Pi subagents by adopting or adapting a Pi extension rather than creating a separate orchestration runtime.
- A child inherits the parent session's model and thinking defaults unless the user explicitly chooses an override.
- The UI shows parent-child relationships, child status, relevant output, completion, and failure.
- Subagent sessions and events remain isolated from unrelated sessions.
- Vendor-specific subagent formats do not need to be emulated.
- The subagent extension is part of the curated Mewa profile. A child run starts only from an explicit user action or an enabled Pi tool invocation in its parent session.

## State and boundaries

- Pi credentials, settings, extensions, skills, and canonical sessions remain in Pi-owned storage.
- Mewa Code stores only its own project registry, UI preferences, session presentation metadata, and extension-specific product state under its own state root.
- Credentials and application state must never appear as repository files or become browseable through the project file surface.
- Pi and Mewa state roots are protected from project-scoped file and search tools, retained subagents, and optional extensions. Existing symlinks must not turn a project path into access to a protected root.
- Shell-command filtering around protected paths is defense in depth, not a complete sandbox. The stronger boundary is filesystem layout and avoiding credential or state mounts inside repositories.
- Persistent writes use bounded paths and safe replacement. A failed update preserves the last valid state.
- The web client does not import or bundle provider runtime implementations.

## Security and privacy

Mewa Code is a trusted development tool, not a sandbox for hostile repositories or prompts. Pi may read, modify, and execute within the selected repository with the host user's permissions. The UI must make that authority clear.

- Bind to loopback by default.
- Require an explicit authentication boundary before non-loopback use. A trusted private-network identity layer such as Tailscale may provide that boundary.
- Do not expose provider credentials, Pi state, host-control sockets, or unrelated host paths to repositories.
- Do not add product analytics, tracking pixels, or hidden telemetry.
- Clearly state that prompts and selected context are sent to the configured model provider under that provider's terms.
- Browser automation, web search, memory, goals, and subagents are executable integrations. Pin and review their code, expose their state, and keep browser execution isolated from credentials and repository mounts.

## Delivery and engineering constraints

- Keep the product small. Delete inherited features, abstractions, documentation, dependencies, and tests that do not support this baseline.
- Prefer Pi behavior and Pi extensions over host-side replicas.
- Add tests for observable baseline behavior and meaningful failure cases. Do not preserve or add tests merely because an inherited feature once existed.
- During development, run the narrowest relevant checks. Reserve broad end-to-end suites for changes that cross the real browser-host boundary or for a deliberate release gate.
- No production deployment, binary release, installer, self-update channel, public website, or automated release pipeline is required while the product is being simplified.
- Preserve accurate Apache-2.0 attribution and complete legal review before any public distribution.

### Container images

- Provide separate controller and `mewa-browser` images.
- Use multi-stage builds and make final images as close to distroless as the required runtime permits.
- Run as non-root with a read-only root filesystem and bounded writable state or tmpfs mounts.
- Exclude compilers, headers, source trees, test fixtures, package-manager caches, development dependencies, and build tools from final images.
- The controller image contains only the Pi/Mewa runtime, required provider libraries, Git, the minimal shell and PTY support needed by the terminal, CA certificates, and a small init when required.
- The browser image contains only Chromium, its runtime libraries, fonts required for stable rendering, the bounded browser service, CA certificates, and a small init when required.
- Do not install diagnostic clients solely for health checks. Prefer an application-native readiness probe.
- Pin base images and downloaded artifacts, preserve lockfile reproducibility, and verify the effective runtime versions during image builds.

## Explicit non-goals

The following inherited capabilities are not baseline requirements and should not survive solely because ThinkRail implemented them:

- a worktree-first project model
- a recursively dockable IDE workbench or shared multi-client layout document
- a full IDE with LSP orchestration, refactoring, debugging, or collaborative editing
- terminal layout orchestration or terminal persistence across host restarts
- spec graphs, specification approval, drift detection, or spec-driven workflow routing
- local GitHub-style review drafts and agent-resolved review comments
- GitHub or GitLab integration
- bundled visualization, todo, shipping, brainstorming, or project-setup workflows
- compatibility layers for other agents' private skill, hook, model, macro, or subagent formats
- automatic model calls for workspace naming
- a workflow engine, automations, self-improvement loop, or per-step model router
- a native desktop shell, mobile application, public website, blog, survey, or launch material
- release installers, self-update, multi-platform packaging, or release-site infrastructure

Native desktop packaging, a hosted service, and additional Pi extensions may be considered later. They are not part of the clean baseline unless a newer user decision promotes them.

## Implementation order

The simplification should preserve or establish the smallest vertical slice first:

1. Open a local repository and list its Pi sessions.
2. Create and resume a Pi session in that repository.
3. Send text and multiple images and render Pi's streamed result.
4. Select Pi model and thinking settings explicitly.
5. Show Pi-reported usage, cost, and context.
6. Show local Git status and diffs.
7. Keep the lightweight file editor, terminal, and explicit worktree flow while removing the inherited dockable workbench.
8. Integrate web search, isolated browser QA, and memory with matching Pi tools and UI renderers.
9. Integrate the focused session-goal and subagent extensions with their UI.
10. Build lean controller and browser images after the retained runtime surface stabilizes.

Anything not needed for those steps should be removed, deferred, or justified separately.

## Acceptance baseline

The target is met when all of the following are true:

1. A fresh Mewa Code installation starts Pi with the documented Mewa profile and exposes provider, model, thinking, extension, and safety settings through Pi-backed UI state without maintaining duplicates.
2. A user can open a repository, create several sessions, run them concurrently, reload the browser, restart the host, and resume the correct Pi histories.
3. A user can send several images in one message and see clear validation failures before provider submission.
4. Session model, thinking level, token usage, cost, and context reflect Pi's own state.
5. Local status and diffs work without a remote or GitHub account.
6. Files can be viewed and edited, a terminal runs in the selected working directory, and optional worktrees do not displace the normal repository working tree.
7. Web search and fetch return attributable sources, while browser QA executes through the isolated `mewa-browser` service and renders artifacts in chat.
8. Memory recall and explicit save work when configured and degrade cleanly when unavailable.
9. Setting a session goal activates its focused behavior, and clearing it removes the active goal from future turns.
10. A subagent run exposes its relationship, progress, result, and failure in the parent UI.
11. Pi credentials and state are not exposed through repository browsing, project-scoped file/search tools, symlink traversal, subagents, browser execution, logs, telemetry, or client bundles. Shell restrictions remain documented defense in depth rather than a sandbox claim.
12. Final container images contain no build toolchain, test suite, source tree, or package cache and run non-root with read-only roots.
13. Tests and dependencies correspond to retained product behavior rather than the imported foundation's feature inventory.

## Current foundation gap

The ThinkRail-derived branch is much larger than this baseline. It currently couples retained files, editor, terminal, worktree, web-access, and Pi session capabilities to a dockable workbench, spec graph, review, workflow, website, packaging, compatibility, visualization, and todo systems. Its test suite primarily proves that inherited product. Retained capabilities must be extracted from that coupling rather than deleted with it. The isolated pre-import `mewa-browser` and memory integration are currently missing and must be restored or rebuilt.

## Decision trace

| Classification | Baseline decisions |
|---|---|
| Explicit current decisions | Separate Mewa Code product in the existing repository; focused OpenChamber-like web UI; preconfigured and tightly integrated in-process Pi SDK; repositories group sessions; normal working tree plus optional worktrees; multiple persistent sessions and images; Pi-reported usage, cost, and context; local Git without GitHub; lightweight files, editor, and terminal; integrated browser QA, web search, and memory; goals and subagents through Pi extensions; newest stable exact Pi package family with simple update discovery; lean near-distroless Docker images; proportional tests and narrow validation. |
| Compatible constraints retained from pre-import Mewa | User-controlled Pi credentials, model, thinking, and settings; child model/thinking inheritance by default; protected credential and state roots; loopback default and authenticated non-loopback exposure; trusted-development-tool rather than sandbox claim; no hidden product telemetry; isolated Chromium service with bounded authenticated browser actions. |
| Derived interaction necessities | A selectable project list; create/select/resume session operations; reconstruction after reload; image previews and removal before multi-image submission; provider status and Pi-backed credential actions when the web UI is the primary interface. These details support an explicit requirement but do not create broader management products. |
| Deferred decisions | Native desktop packaging, hosted service operation, public distribution, and additional Pi extensions remain deferred. |

## Provenance reviewed

- Current Mewa Code design conversation, August 2026: latest product choices and scope corrections.
- Pre-import Mewa at `65a8d6b`: Pi-default preservation, subagent inheritance, state isolation, trusted-development-tool model, credential separation, safe non-loopback exposure, and optional browser isolation.
- ThinkRail at `eab4755127ee80426e9438c520735c57410072d3`: implementation capability inventory only.
- Existing source and Git history: current foundation behavior and coupling, not automatic product requirements.
