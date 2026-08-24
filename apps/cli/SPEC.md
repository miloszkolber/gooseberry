---
id: module-cli
type: module-design
status: active
title: CLI host launcher
parent: architecture
depends-on: [module-server, module-shared]
tags: [v1, host]
---

## Responsibility

The `mewa-code` command is the thin V1 launcher. It parses launch options, boots the engine host in-process, reports the resolved endpoint, and opens the browser unless `--no-open` is selected. Agent and project behavior remain in `packages/server`.

## Launch interface

- `mewa-code [options] [project-dir]`
- `--port`, `--host`, `--no-open`, `--version`, and `--help`
- `MEWA_CODE_PORT`, `MEWA_CODE_HOST`, and `MEWA_CODE_STATIC_DIR` supply environment defaults.
- A positional repository path is opened as the initial project.
- The source entry uses `src/index.ts`. The compiled entry stages embedded web/runtime assets before calling the same launcher.

## Distribution state

Binary compilation is available only as a developer verification path. Mewa Code does not currently publish binaries or installers. The reserved `mewa-code update` subcommand exits with a clear unavailable message and performs no network request. Installer and self-update implementations are intentionally absent until real release channels exist.

`mewa-code uninstall` remains available to clean up an earlier local binary installation without deleting Pi's own state. It keeps Mewa Code project and worktree data by default.

## Compiled runtime

`build:binary` embeds the web UI, native runtime helpers, OAuth/Bedrock registrations, and the currently inherited extension bundle. The extension bundle is not the target neutral Pi boundary. It must be split into mandatory UI adapters and explicitly enabled optional extensions before distribution.

## Boundary

- The launcher may configure host lifecycle and browser opening.
- It must not implement agent policy or maintain an independent provider/model registry.
- Release activation requires real artifact channels, license and notice packaging, and end-to-end installer/update verification.
