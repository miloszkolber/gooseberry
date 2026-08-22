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
├── .cache/
└── browser/
    └── artifacts/
```

The runtime sets Pi, Synara, XDG, npm, Corepack, and Node history paths explicitly. The `/home/core` mount remains the task-facing home so `~` and host shell commands refer to the same development identity.

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

A complete remote Synara workspace would still require a shared workspace transport below Synara's Files, Git, worktree, and terminal services. That work is optional rather than required for the hybrid design.

## Paseo comparison

The `draft/paseo-pi` branch tests Paseo against the same Pi extensions, mounts, state layout, and browser boundary.

Paseo gives Pi a cleaner subprocess/RPC boundary, but its own Files, Git, worktrees, and terminals are also daemon-local. Its full Docker image includes shell, Git, OpenSSH, process utilities, and PTY support, so it is not automatically closer to a distroless full-featured controller.

## Browser

The browser service exposes an authenticated bounded API with command and option allowlists, HTTP(S)-only navigation, session isolation, locking, deadlines, quotas, safe artifact finalization, and cleanup. Pi exposes it as one `browser` tool.

MCP remains an optional future protocol choice. It should replace the private API only if it preserves the same capability boundary and does not expose arbitrary Chromium or process control.
