# Architecture

## Principle

`mewa-code` owns agent state and orchestration. The SSH host owns the development filesystem and process environment. `mewa-browser` owns visual/browser execution.

No project repository is mounted into `mewa-code`.

## Data paths

```text
Pi read/write/edit  -> SFTP -> host
Pi bash             -> SSH exec -> host
Synara terminal     -> SSH PTY -> host
Synara files        -> SFTP -> host
Synara Git/worktree -> SSH exec -> host
host dev server     -> SSH forwarding -> mewa-code -> mewa-browser
browser actions     -> private service network -> mewa-browser
```

The model should see host paths such as `/home/mewa` and `/data/repos/project`, never container paths. SSH credentials, host fingerprints, reconnect state, and protocol details must not enter model context.

## Authority boundaries

### mewa-code

May authenticate to LLM providers and to the dedicated host SSH account. It should not receive the Docker socket, host D-Bus, journal mounts, or host project volumes.

### SSH account

The SSH account is the development authority boundary. Give it only the repository/toolchain/Docker/system permissions intended for agents. Prefer no unrestricted sudo.

### mewa-browser

Receives only browser-level operations over the private service network. It must not expose a general-purpose command endpoint.

## Pi

Current Pi tool definitions already expose pluggable operations for the core coding tools. `mewa-remote` reuses those definitions so the model retains Pi's native schemas, rendering, diff behavior and truncation while I/O happens remotely.

Project resource discovery is a separate concern. A complete implementation must make `AGENTS.md`, project skills, project extensions and prompts load from the remote workspace rather than the container filesystem.

## Synara

Synara currently constructs Pi runtimes and implements Files/Git/worktrees with local filesystem/process services. Full SSH therefore requires a Synara `RemoteWorkspace` layer rather than only Pi tool overrides. See `SYNARA_REMOTE.md`.

## Browser

The initial browser bridge is intentionally small. It should evolve toward MCP if MCP can preserve the same policy boundary without exposing raw process execution or arbitrary Chromium flags.
