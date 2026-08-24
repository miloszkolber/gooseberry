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

The current server composes projects, workspaces, Git, GitHub metadata, reviews, terminals, editor support, layouts, templates, todos, spec graphs, skill compatibility, history, auth, and Pi sessions. The web client contains matching IDE panels, shared layout persistence, editor, terminal, review, spec, todo, and workflow presentation.

Development and compiled modes currently inject or bundle `pi-web-access`, `pi-visualize`, `pi-spec-graph`, `pi-mewa-code-workflow`, and `pi-todos`. Web access is retained but needs a smaller explicit contract. Visualization, spec graph, workflow, and todos are removal targets. Some server and UI modules import extension cores directly, so removal must include their host and UI consumers.

The current project model gives Git worktrees first-class status and carries a default-workspace exception for the repository's normal working tree. Pi session identity is coupled to the exact working directory. The baseline reverses that emphasis: the normal repository working tree is primary and worktrees remain an explicit optional capability.

The current repository also includes an unpublished website, deferred desktop launcher, binary build actions, extensive release-era code, and broad inherited unit and end-to-end suites. None of those are baseline requirements. The pre-import isolated `mewa-browser` service and memory connector are absent from the current tree.

## Simplification reading rule

Historical module specs were removed during documentation centralization. Git history remains available when an implementation detail needs archaeology. If current code conflicts with `product-baseline.md`, the baseline wins and the conflict is deletion or adaptation work.

The implementation should become more accurate by getting smaller. Do not preserve a current abstraction, protocol method, state document, compatibility layer, or test unless retained baseline behavior needs it.
