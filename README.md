# mewa_code

Experimental remote coding workspace built around two services:

- **mewa-code** — Synara + Pi controller. The development machine is the filesystem and execution environment of record; Pi tools reach it transparently over SSH/SFTP.
- **mewa-browser** — isolated Chromium + agent-browser service for visual testing.

## Core invariant

The `mewa-code` container does **not** mount project repositories and does not pretend its own `$HOME` is the developer's home. Project paths exposed to agents are host paths. File operations use SFTP and command execution uses SSH, while Pi still exposes ordinary `read`, `write`, `edit`, and `bash` tools to the model.

```text
mewa-code
  Synara
  Pi
  remote workspace transport
    read/write/edit -> SFTP
    bash            -> SSH exec
    terminal        -> SSH PTY
    ports           -> SSH forwarding
        |
        v
      host
      repos / git / toolchains / docker / systemd / dev servers

mewa-browser
  Chromium
  agent-browser
  bounded control API
```

SSH is a transport implementation detail, not an LLM-facing tool.

## Status

This branch is an architectural prototype. The SSH transport and Pi tool-override seam are intentionally separated from the Synara adapter. Synara currently assumes local workspace filesystem/Git services, so `docs/SYNARA_REMOTE.md` defines the patch boundary required before this is a complete remote workspace.

## Repository layout

```text
mewa-code/      controller image, SSH transport, Pi extension
mewa-browser/   isolated browser image/service
docs/           architecture and Synara integration notes
compose.yaml    local deployment skeleton
```

## Security model

The SSH account is the development authority boundary. `mewa-code` should use a dedicated key, pinned host key, and a dedicated host user with only the privileges intended for agents. No Docker socket, system D-Bus, journal, project volume, or privileged assistant broker is mounted into `mewa-code`.
