---
id: submodule-server-persistence
type: submodule-design
status: active
title: persistence — JSON app state
parent: module-server
depends-on: [module-contracts]
tags: [v1]
---

## Responsibility

Durable app state — projects, workspaces, server-synced app config, terminal sessions, and per-workspace
workbench snapshots — as JSON under the data dir.

## Boundary

- **Owns:** `dataDir()` (`MEWA_CODE_DATA_DIR` for dev/e2e isolation, else `~/.mewa-code`);
  `loadProjects`/`saveProjects`, `loadWorkspaces`/`saveWorkspaces`,
  `loadTerminalSessions`/`saveTerminalSessions`, and `loadConfig`/`saveConfig`
  (`config.json`, fieldwise-normalized over `DEFAULT_CONFIG`—including nested layout settings—so a missing
  file or key degrades cleanly, while unknown top-level extension fields survive known-field updates),
  `loadWorkspaceLayout`/`loadWorkspaceLayoutBackup`/`saveWorkspaceLayout`/`removeWorkspaceLayout`
  (versioned full snapshots in traversal-safe workspace-keyed filenames; atomic replacement with a
  last-known-good copy so a torn/corrupt write cannot blank a workspace; complete cleanup when its
  workspace is archived), and
  — all tab-indented JSON.
- **Public surface (barrel):** `dataDir`, `loadProjects`, `saveProjects`, `loadWorkspaces`,
  `saveWorkspaces`, `loadTerminalSessions`, `saveTerminalSessions`, `loadConfig`, `saveConfig`,
  `loadWorkspaceLayout`, `loadWorkspaceLayoutBackup`, `saveWorkspaceLayout`, `removeWorkspaceLayout`.
- **Allowed deps:** `contracts` (`Project`/`Workspace`/`AppConfig`/`WorkspaceLayoutSnapshot` types + `DEFAULT_CONFIG`); Node
  `fs`/`os`/`path`.
- **Forbidden:** importing any sibling module or `host` — this is a leaf others depend on.
