# Synara remote workspace seam

This is the main unfinished integration boundary in the draft.

Synara currently assumes local filesystem and child-process access for workspace services. A complete full-SSH implementation should introduce a workspace transport below those services rather than special-casing SSH in individual UI features.

Proposed interface:

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

Initial SSH implementation:

- files: SFTP
- commands/Git/worktrees/search: SSH exec
- terminals: SSH PTY
- dev-server previews: SSH port forwarding

The same transport instance should be shared by Synara's Pi adapter and Synara workspace services so all consumers agree on host identity, cwd, reconnect state and path semantics.

## Pi integration

Pi already allows custom operations for its native coding tool definitions. The current prototype uses this for `read`, `write`, `edit` and `bash` instead of defining new model-facing tools.

The next Pi step is remote resource discovery. Pi's SDK supports a custom `ResourceLoader`; use that to load project `AGENTS.md`, `.pi/*`, `.agents/skills/*`, prompts and project extensions through the remote workspace. Global Pi state and provider credentials remain local to mewa-code.

## Synara integration order

1. Add `WorkspaceTransport` and `SshWorkspaceTransport`.
2. Convert Files/editor reads and writes.
3. Convert Git status/diff/worktree operations.
4. Convert terminal manager to SSH PTY.
5. Convert project discovery/search/watch behavior.
6. Add remote Pi `ResourceLoader` and inject the same transport into Pi tool operations.
7. Add SSH forwarding for preview ports.

Until these are complete, the branch should be treated as an architecture and transport prototype, not a complete Synara remote-workspace build.
