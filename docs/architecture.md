# Mewa Code architecture

Mewa Code is a browser/ACP-first controller for Pi. The controller owns Pi sessions and UI transport. It has no TUI and does not expose SSH as a model-facing tool.

The ACP adapter is a stdio-only ACP v1 newline-delimited JSON connection. It is not an HTTP or WebSocket listener. Public distribution remains deferred pending complete legal review and attribution checks.

```text
browser UI           ACP client
    |                    |
HTTP + WebSocket     stdio NDJSON
       \              /
        mewa controller
       /            \
same-path mounts    OpenSSH client
files, editor,      Pi bash and browser terminal
Git, worktrees             |
                         host SSH user
```

## Filesystem and execution

- Repository files, editor operations, local Git status/diffs, and worktrees use only local same-path bind mounts.
- `MEWA_MOUNT_ROOTS` contains the absolute controller paths that are admitted for projects and workspaces. Each root must be an existing non-state directory. Canonical realpaths must remain under the root, including for symlinked paths.
- Pi's `bash` tool keeps Pi's public schema and renderer but delegates command execution to the system OpenSSH client. Remote commands run as `bash -lc`, with the selected working directory quoted as a separate shell word.
- Browser terminals allocate a remote PTY by running `ssh -tt ...` through `bun-pty`. The remote command starts an interactive Bash shell in the selected same-path workspace.
- The controller does not use SFTP. A project or workspace outside an approved mount fails clearly instead of falling back to another path transport.

## SSH authority

The SSH account is the host execution authority. The controller requires a host, user, port, private-key file, known-hosts file, strict host-key checking, batch mode, connection timeout, and keepalive settings. The builder disables user SSH configuration and environment sending, and the SSH child receives only a minimal `PATH`, terminal variables for PTYs, and no provider or browser credentials.

Installed Pi extensions and in-process subagents are trusted controller code. Protected-state and path guards reduce accidental exposure but are defense in depth, not a sandbox for hostile repositories or prompts. The SSH account's Unix permissions define the effective authority.

## Browser boundary

`mewa-browser` remains a separate service. It receives browser API requests and temporary browser state only. It has no controller SSH material and no repository bind mount. The browser service is used through the bounded Pi extension and browser/ACP surfaces, not through a general shell.
