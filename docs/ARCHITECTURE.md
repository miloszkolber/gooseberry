# Architecture

## Principle

`mewa-code` owns agent state and orchestration. The Core host owns the development filesystem and process environment. `mewa-browser` owns visual execution.

The design deliberately separates controller state from development content:

- `/home/data` is the single writable controller-state root;
- `/home/core`, `/data`, and `/repo` are selected same-path host mounts;
- SSH and SFTP cover host execution and paths outside those mounts;
- Chromium never runs in `mewa-code` or on the host.

## Data paths

```text
Pi read/write/edit/ls
  ├─ approved real path inside same-path mount -> local filesystem
  └─ unmounted path or symlink escape          -> SFTP host

Pi grep/find/bash/user ! -> SSH host
Pi browser               -> private API -> mewa-browser
Synara Files/Changes     -> local same-path mounts
Synara standalone terminal -> mewa-code container
```

The model sees host paths such as `/home/core` and `/repo/project`. SSH credentials, host fingerprints, reconnect state, local-mount routing, and browser tokens must not enter model context.

## State layout

All known runtime-managed files belong below the `/home/data` bind:

```text
/home/data/
├── pi/
│   ├── auth.json
│   ├── settings.json
│   └── sessions/
├── synara/
├── .config/
├── .local/
└── .cache/
    └── node-compile-cache/
```

Browser artifacts live below the same host state root through the browser service's `/state` mount.

The runtime sets Pi, Synara, XDG, npm, Corepack, Node history, and Node compile-cache paths explicitly. The `/home/core` mount remains the task-facing home so `~` and host shell commands refer to the same development identity.

Bootstrap rejects configured persistent directories that escape `/home/data`. It rewrites Pi settings only when their serialized content actually changes.

## Authority boundaries

### mewa-code

May authenticate to LLM providers, the dedicated browser API, and the configured SSH account. It receives selected host content mounts but no Docker socket, host D-Bus, journal, devices, or namespace access.

### SSH account

The SSH account is the development authority boundary. Its Unix groups, file permissions, and sudo policy define what agents can do. The default Core deployment uses the `core` account. Avoid unrestricted sudo.

### mewa-browser

Receives only authenticated browser-level operations over a private service network. It has no general-purpose API shell. Browser sessions have bounded state, output, time, and artifacts.

## Pi

Pi's core tools expose pluggable operations. `mewa-remote` preserves the native schemas, renderers, edit diffs, truncation, and model-facing tool names while routing work to mounts, SFTP, or SSH.

The image also includes:

- `mewa-browser` for isolated Chromium operations;
- `mewa-question` for focused blocking questions;
- `mewa-plan` for read-only planning.

Bootstrap merges required extension and skill paths into existing Pi settings rather than replacing the user's model, provider, or preference choices.

Global agent rules remain canonical at `/home/core/agents/AGENTS.md`. Pi loads them through a managed link under `/home/data/pi`. Skills remain canonical at `/home/core/agents/skills`.

## Synara

Synara embeds Pi's SDK and supplies local Files, Git, worktree, and terminal services. Same-path mounts make Files and Changes useful without rewriting Synara. The standalone terminal remains container-local, and SFTP-only paths remain Pi-only.

The controller pins a stable Synara tag and follows Synara's release build path for the web and CLI targets. The final image does not contain the Synara monorepo source or build toolchain. It contains only:

```text
/opt/synara/
├── dist/                    built Synara server and web client
├── node_modules/            locked Synara runtime dependencies
├── package.json             generated runtime manifest
└── mewa/
    ├── dist/                compiled repo-owned Pi extensions
    ├── node_modules/        mewa-only runtime dependencies
    ├── package.json
    └── bootstrap.mjs
```

Pi itself comes from Synara's locked runtime dependency set. The mewa layer does not ship another Pi tree. `typebox` is aligned with Pi and resolved from the Synara runtime tree, while `ssh2` remains isolated below `mewa/node_modules`.

The final controller keeps Git because Synara's local Git, Changes, and worktree features operate against mounted repositories. Host-only developer utilities such as `ripgrep`, language toolchains, Docker clients, and project package managers do not belong in the controller image.

Synara exposes a readiness snapshot at `/health`. Docker health requires `startupReady: true`, which covers HTTP, push bus, keybindings, terminal subscriptions, and orchestration subscriptions rather than only checking whether the port is open.

A complete remote Synara workspace would still require a shared workspace transport below Synara's Files, Git, worktree, and terminal services. That work is optional rather than required for the hybrid design.

## Browser

The browser service exposes an authenticated bounded API with command and option allowlists, HTTP(S)-only navigation, session isolation, locking, deadlines, quotas, safe artifact finalization, and cleanup. Pi exposes it as one `browser` tool.

MCP remains an optional future protocol choice. It should replace the private API only if it preserves the same capability boundary and does not expose arbitrary Chromium or process control.
