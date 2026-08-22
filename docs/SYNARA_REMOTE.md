# Synara workspace boundary

The hybrid architecture does not require a full Synara remote-workspace fork. Same-path mounts make Synara Files, Changes, and worktrees useful for the Core roots, while Pi routes execution and exceptional paths through SSH/SFTP.

## Current behavior

```text
Synara Files/Changes/worktrees -> local same-path mounts
Synara standalone terminal     -> controller container
Pi file tools                  -> mounts with SFTP fallback
Pi bash/grep/find              -> SSH host
Pi browser                     -> mewa-browser
```

This is coherent for normal work under `/home/core`, `/data`, and `/repo`. The model uses Pi tools and does not need to understand the split.

## Remaining limitations

- Synara's standalone terminal does not share the host shell environment.
- SFTP-only paths do not appear in Synara Files or Changes.
- host development ports are not forwarded automatically to browser previews.
- Synara's local Git and file watchers observe only mounted roots.

Use Pi `bash` for host commands. Do not rely on the standalone terminal for host-state verification.

## Optional complete remote adapter

A future complete remote workspace could introduce a transport below Synara's local services:

```ts
interface WorkspaceTransport {
  readFile(path: string): Promise<Uint8Array>
  writeFile(path: string, data: Uint8Array | string): Promise<void>
  stat(path: string): Promise<RemoteStat>
  list(path: string): Promise<RemoteDirEntry[]>
  exec(input: RemoteExecInput): Promise<RemoteExecResult>
  openPty(input: RemotePtyInput): Promise<RemotePty>
  forwardPort(input: RemoteForwardInput): Promise<RemoteForward>
}
```

An SSH implementation would use:

- SFTP for files;
- SSH exec for Git, worktrees, and search;
- SSH PTY for terminals;
- SSH forwarding for development servers.

The same transport instance should be shared by Synara's Pi adapter and workspace services so all consumers agree on host identity, cwd, reconnect state, and path semantics.

## Why this is optional

The adapter adds substantial maintenance surface inside an early-stage controller. It is justified only if real use shows that one of these is critical:

- editing unmounted paths through Synara Files;
- using Synara's terminal as the authoritative host terminal;
- managing worktrees outside the mounted roots;
- presenting several remote machines through one Synara daemon.

Until then, the hybrid mount plus transparent Pi transport is the preferred design.

## Paseo comparison

Paseo does not remove this class of limitation. Its file explorer uses local filesystem APIs, its Git/worktree services operate on daemon-local paths, and its terminal uses local PTYs. Paseo's advantage is a cleaner Pi subprocess/RPC boundary and stronger general orchestration, not automatic remote-workspace transparency.
