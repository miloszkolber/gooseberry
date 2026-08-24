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

Mewa Code is a separate product, developed in the existing `mewa_code` repository, that provides a focused web interface for the Pi Coding Agent. “OpenChamber-like” means a simple project-and-session sidebar leading to a focused chat view with persistent history. It does not import OpenChamber's implementation or entire feature set. Mewa Code makes Pi's existing state and events understandable in a browser and adds only explicitly chosen Pi extensions. It is not a new agent framework, workflow platform, full IDE, GitHub client, or repackaged ThinkRail product.

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

Mewa Code may expose those capabilities and invoke explicit user actions, but it must not maintain competing registries, silently rewrite Pi settings, recompute Pi statistics, replace Pi's file or shell tools, select a model on the user's behalf, auto-trust a repository, or inject an always-on workflow prompt.

With Mewa product extensions disabled, a Mewa Code session should behave like stock Pi with the same Pi configuration, except for one mandatory protected-state safety guard. UI transport adapters may project Pi state and events, but they must not register agent-facing tools, alter the system prompt, or change resource discovery. The safety guard may deny Pi and Mewa credential or state roots across file, search, visible shell-path, subagent, and extension access. It must not alter prompts, add general tools, or restrict the selected repository. Any other agent-facing Mewa feature must be an identifiable Pi extension enabled through an explicit user choice.

Pi dependencies use one exact, internally consistent version across the complete package family. Simple routine update discovery should identify the newest stable Pi release, update the family together, and validate the focused integration surface. Runtime dependency ranges must not float silently.

## Required web UI capabilities

### Repositories and projects

- A project is a local Git repository selected by the user.
- The UI lists known projects and allows a repository to be opened, removed from the known-project list, and reopened without deleting the repository or its Pi sessions.
- Sessions are grouped by repository so it is always clear which working directory and Git state a session belongs to.
- The repository's normal working tree is the default workspace. Mewa Code must not force a new branch or Git worktree for every session.
- Worktree support is deferred. It must not shape the baseline project or session model.

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

### Session goals

- A session may have one visible, editable goal that survives reload and resume.
- Agent-facing goal behavior is implemented as a small Pi extension, not by replacing Pi's system prompt in the host.
- The UI shows the active goal and any extension-reported status without turning goals into a general workflow or specification engine.
- The goal extension is enabled for a session when the user creates or enables a goal. A session without the feature enabled retains stock Pi agent-facing behavior.
- Clearing the goal removes the active stored goal and disables its agent-facing extension behavior for future turns. Existing Pi transcript history is unchanged.

### Subagents

- Mewa Code supports Pi subagents by adopting or adapting a Pi extension rather than creating a separate orchestration runtime.
- A child inherits the parent session's model and thinking defaults unless the user explicitly chooses an override.
- The UI shows parent-child relationships, child status, relevant output, completion, and failure.
- Subagent sessions and events remain isolated from unrelated sessions.
- Vendor-specific subagent formats do not need to be emulated.
- The subagent extension is enabled explicitly for a parent session. It is not an app-wide or project-wide default and is not part of the neutral default extension set.

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
- Optional browser automation or web-search integrations are executable extensions and require separate review. Browser isolation from credentials and repository mounts remains mandatory if browser automation returns.

## Delivery and engineering constraints

- Keep the product small. Delete inherited features, abstractions, documentation, dependencies, and tests that do not support this baseline.
- Prefer Pi behavior and Pi extensions over host-side replicas.
- Add tests for observable baseline behavior and meaningful failure cases. Do not preserve or add tests merely because an inherited feature once existed.
- During development, run the narrowest relevant checks. Reserve broad end-to-end suites for changes that cross the real browser-host boundary or for a deliberate release gate.
- No production deployment, binary release, installer, self-update channel, public website, or automated release pipeline is required while the product is being simplified.
- Preserve accurate Apache-2.0 attribution and complete legal review before any public distribution.

## Explicit non-goals

The following inherited capabilities are not baseline requirements and should not survive solely because ThinkRail implemented them:

- a worktree-first project model
- a recursively dockable IDE workbench or shared multi-client layout document
- a full Monaco-based code editor
- persistent browser terminals or terminal layout orchestration
- spec graphs, specification approval, drift detection, or spec-driven workflow routing
- local GitHub-style review drafts and agent-resolved review comments
- GitHub or GitLab integration
- bundled web access, visualization, todo, shipping, brainstorming, or project-setup workflows
- compatibility layers for other agents' private skill, hook, model, macro, or subagent formats
- automatic model calls for workspace naming
- a workflow engine, automations, self-improvement loop, or per-step model router
- a native desktop shell, mobile application, public website, blog, survey, or launch material
- release installers, self-update, multi-platform packaging, or release-site infrastructure

Files, a lightweight editor, a terminal, optional worktrees, web search, browser visual QA, memory, and additional Pi extensions may be considered later. They are not part of the clean baseline unless a newer user decision promotes them.

## Implementation order

The simplification should preserve or establish the smallest vertical slice first:

1. Open a local repository and list its Pi sessions.
2. Create and resume a Pi session in that repository.
3. Send text and multiple images and render Pi's streamed result.
4. Select Pi model and thinking settings explicitly.
5. Show Pi-reported usage, cost, and context.
6. Show local Git status and diffs.
7. Add the focused session-goal extension and UI.
8. Add the focused subagent extension and UI.

Anything not needed for those steps should be removed, deferred, or justified separately.

## Acceptance baseline

The target is met when all of the following are true:

1. With the same Pi configuration and Mewa product extensions disabled, a Mewa Code session has the same agent-facing prompt, tools, model defaults, trust, retry, compaction, skills, and extensions as stock Pi, except for the narrow protected-state safety guard. UI transport adapters do not add tools or prompt text.
2. A user can open a repository, create several sessions, run them concurrently, reload the browser, restart the host, and resume the correct Pi histories.
3. A user can send several images in one message and see clear validation failures before provider submission.
4. Session model, thinking level, token usage, cost, and context reflect Pi's own state.
5. Local status and diffs work without a remote or GitHub account.
6. Setting a session goal activates its focused Pi extension. Clearing it removes the active goal and restores neutral behavior for future turns.
7. Explicitly enabling subagents allows a child to run through its Pi extension and makes its relationship, progress, result, and failure visible in the parent UI.
8. Pi credentials and state are not exposed through repository browsing, project-scoped file/search tools, symlink traversal, retained subagents, logs, telemetry, or client bundles. Shell restrictions remain documented defense in depth rather than a sandbox claim.
9. Tests and dependencies correspond to retained product behavior rather than the imported foundation's feature inventory.

## Current foundation gap

The ThinkRail-derived branch is much larger than this baseline. It currently includes forced or prominent worktree concepts, spec graph, review, terminal and editor workbench systems, a marketing website, binary packaging, compatibility skill discovery, and automatically bundled workflow, web, visualization, spec, and todo extensions. Its test suite primarily proves that inherited product. Those systems are candidates for removal, not presumptive requirements.

## Decision trace

| Classification | Baseline decisions |
|---|---|
| Explicit current decisions | Separate Mewa Code product in the existing repository; focused OpenChamber-like web UI; in-process Pi SDK with Pi as sole agent authority; repositories group sessions; normal working tree by default; multiple persistent sessions; multiple images per message; Pi-reported usage, cost, and context; local Git status and diff without GitHub; session goals through a Pi extension; subagents through a Pi extension; newest stable exact Pi package family with simple routine update discovery and validation; proportional tests and narrow validation. |
| Compatible constraints retained from pre-import Mewa | User-controlled Pi credentials, model, thinking, and settings; child model/thinking inheritance by default; protected credential and state roots; loopback default and authenticated non-loopback exposure; trusted-development-tool rather than sandbox claim; no hidden product telemetry; isolated review before adding browser automation. |
| Derived interaction necessities | A selectable project list; create/select/resume session operations; reconstruction after reload; image previews and removal before multi-image submission; provider status and Pi-backed credential actions when the web UI is the primary interface. These details support an explicit requirement but do not create broader management products. |
| Deferred decisions | Whether any lightweight file viewer, editor, terminal, worktree support, remote-access packaging, browser visual QA, web search, memory, native shell, or release packaging returns after the core baseline works. Deferred features are removed from the simplification target unless promoted by a newer user decision. |

## Provenance reviewed

- Current Mewa Code design conversation, August 2026: latest product choices and scope corrections.
- Pre-import Mewa at `65a8d6b`: Pi-default preservation, subagent inheritance, state isolation, trusted-development-tool model, credential separation, safe non-loopback exposure, and optional browser isolation.
- ThinkRail at `eab4755127ee80426e9438c520735c57410072d3`: implementation capability inventory only.
- Existing `README.md`, `architecture.md`, and module `SPEC.md` files: current foundation behavior and coupling, not automatic product requirements.
