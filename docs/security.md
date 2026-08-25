# Mewa Code security boundary

Mewa Code is a trusted development tool, not a sandbox. Pi, installed extensions, and subagents may execute with the configured host SSH user's permissions. Do not grant that account privileges beyond the intended development authority.

## Mount admission

Set `MEWA_MOUNT_ROOTS` to absolute directories that are mounted at the same paths in the controller. `/`, Pi/Mewa state roots, missing directories, and roots that overlap protected state are rejected. Project, workspace, file, and diff paths are canonicalized before use. A symlink whose real target leaves an approved root is rejected. Existing persisted projects outside the roots fail clearly and are never routed through SFTP.

## SSH execution

The controller uses the system OpenSSH client for Pi bash and browser terminals. SSH arguments always include:

- `StrictHostKeyChecking=yes` and an explicit known-hosts file
- `BatchMode=yes`, password and keyboard-interactive authentication disabled
- an explicit private key, `IdentitiesOnly=yes`, and disabled user SSH configuration
- explicit port, connection timeout, server keepalive interval, and keepalive count
- `SendEnv=` and a minimal client environment

The private key and known-hosts file are mounted read-only into the controller. They are not mounted into `mewa-browser`, not returned to Pi, and not written to command logs. Provider and browser tokens are not assigned to remote commands. Remote non-PTY commands use bounded stdout/stderr collection and terminate on timeout, cancellation, or output-limit exhaustion.

The host SSH user, its Unix permissions, its shell, and its host-side SSH policy are the exact execution authority. A pinned host key prevents accidental connection to a different host, but it does not reduce the authority of the configured account.

## Exposure and browser isolation

Bind the controller to loopback unless an authenticated private-network boundary is already configured. Every controller WebSocket and controller file/artifact read requires `MEWA_CODE_TOKEN`. The browser UI receives that token only through a one-time `#token=...` fragment, stores it in session storage, removes the fragment immediately, and negotiates it as a strict WebSocket subprotocol. The controller rejects missing or foreign WebSocket Origins and validates Host. Set `MEWA_CODE_ALLOWED_ORIGINS` for an explicit private-network or reverse-proxy Origin allowlist. `mewa-browser` receives only its separate `MEWA_BROWSER_TOKEN`, never the controller token.

`/health` and the built static UI remain unauthenticated so readiness checks and bootstrap can work. Keep the Compose publish binding on loopback by default. The Origin/Host policy is not a network firewall or a sandbox, so non-loopback deployments still require a trusted private-network identity boundary, TLS where appropriate, and host/container network controls.

Non-browser WebSocket clients are intentionally not anonymous. They must supply an allowed Origin/Host pair and the negotiated controller-token subprotocol, or use the separate ACP interface.
