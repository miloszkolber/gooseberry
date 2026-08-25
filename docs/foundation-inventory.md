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

- `apps/cli` starts the local host and opens the browser.
- `packages/server` runs Pi in-process and exposes HTTP and WebSocket behavior.
- `packages/contracts` carries shared client-host types.
- `apps/web` renders the browser interface.
- Pi's SDK, provider packages, settings, and JSONL sessions currently supply the agent runtime.

This path contains the likely baseline seam, but each package still includes behavior inherited from ThinkRail.

## Inherited coupled surfaces

The server composes projects, workspaces, Git, terminals, editor support, layouts, native Pi skill admission, history, auth, and Pi sessions. The web client contains matching project and workspace navigation, shared layout persistence, editor, terminal, chat, and retained web-tool presentation.

Development and compiled modes inject the retained `pi-web-access` extension together with the curated subagent profile, protected-state guard, and optional Signet connector. Visualization, spec graph, workflow, todo, review, template, and GitHub feature extensions and consumers have been removed. Web access remains behind its explicit contract.

The current project model gives Git worktrees first-class status and carries a default-workspace exception for the repository's normal working tree. Pi session identity is coupled to the exact working directory. The baseline reverses that emphasis: the normal repository working tree is primary and worktrees remain an explicit optional capability.

The current repository retains a deferred desktop launcher and broad inherited unit and end-to-end suites for historical context. The unpublished website, binary build actions, and other release-era surfaces were removed because none are baseline requirements. The isolated `mewa-browser` service and current Pi browser extension are restored. The protected-state guard rejects Pi tool paths and shell references into Pi or Mewa state roots, while project and workspace file roots reject protected state roots. The curated subagent and env-gated Signet memory extensions are integrated with matching web renderers.

## Simplification reading rule

Historical module specs were removed during documentation centralization. Git history remains available when an implementation detail needs archaeology. If current code conflicts with `product-baseline.md`, the baseline wins and the conflict is deletion or adaptation work.

The implementation should become more accurate by getting smaller. Do not preserve a current abstraction, protocol method, state document, compatibility layer, or test unless retained baseline behavior needs it.
