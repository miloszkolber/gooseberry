---
id: architecture
type: implementation-inventory
status: draft
title: Imported foundation architecture inventory
parent: goal-and-requirements
tags: [current-state, simplification]
---

## Purpose

This document records the current ThinkRail-derived implementation so simplification work can find its boundaries. It is not a product specification and contains no authority to retain a feature. [`product-baseline.md`](product-baseline.md) is the product baseline.

## Current core path

- `mewa-code/apps/controller` starts the local host and opens the browser.
- `mewa-code/packages/server` runs Pi in-process and exposes HTTP and WebSocket behavior.
- `mewa-code/packages/contracts` carries shared client-host types.
- `mewa-code/webui` renders the browser interface.
- Pi's SDK, provider packages, settings, and JSONL sessions currently supply the agent runtime.

The controller uses same-path bind mounts for repository, file, editor, local Git, diff, and worktree paths. `MEWA_MOUNT_ROOTS` admits canonical mounted paths and rejects state roots, missing mounts, and symlink escapes. Pi bash and browser terminals use the system OpenSSH client to the configured host account. SSH is not exposed as a model tool, and SFTP is intentionally absent.

This path contains the likely baseline seam, but each package still includes behavior inherited from ThinkRail.

## Inherited coupled surfaces

The server composes projects, workspaces, Git, terminals, editor support, layouts, native Pi skill admission, history, auth, and Pi sessions. The web client contains matching project and workspace navigation, shared layout persistence, editor, terminal, chat, and retained web-tool presentation.

Development and compiled modes inject the retained `pi-web-access` extension together with Mewa's small built-in in-process subagent extension, protected-state guard, and optional Signet connector. Visualization, spec graph, workflow, todo, review, template, and GitHub feature extensions and consumers have been removed. Web access remains behind its explicit contract.

The current project model gives Git worktrees first-class status and carries a default-workspace exception for the repository's normal working tree. Pi session identity is coupled to the exact working directory. The baseline reverses that emphasis: the normal repository working tree is primary and worktrees remain an explicit optional capability.

The current repository retains broad inherited unit suites only where their behavior is still being reduced to focused coverage. The unpublished website, desktop launcher, binary build actions, and other release-era surfaces are not part of the product. The isolated `mewa-browser` service and current Pi browser extension are restored. The protected-state guard rejects Pi tool paths and shell references into Pi or Mewa state roots, while project and workspace file roots reject protected state roots. The curated subagent and env-gated Signet memory extensions are integrated with matching web renderers. Installed extensions and subagents are trusted controller code, and guardrails are defense in depth rather than a sandbox claim. Browser and ACP clients are primary, with no TUI.

## Simplification reading rule

Historical module specs were removed during documentation centralization. Git history remains available when an implementation detail needs archaeology. If current code conflicts with `product-baseline.md`, the baseline wins and the conflict is deletion or adaptation work.

The implementation should become more accurate by getting smaller. Do not preserve a current abstraction, protocol method, state document, compatibility layer, or test unless retained baseline behavior needs it.
