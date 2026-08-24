# Security

## Trust model

This stack is a development tool, not a sandbox for hostile repositories or prompts. Pi can read and modify its mounted workspace and run commands with the controller user's permissions. Synara and Pi extensions execute as trusted code.

The Compose defaults reduce accidental exposure:

- Synara is published on host loopback only and requires a token.
- The browser API is reachable only from the Compose network and uses a separate token.
- Both containers run as a non-root UID/GID with read-only root filesystems.
- Mutable controller state uses one explicit mount. Browser profiles and artifacts stay on bounded tmpfs.
- No Docker, D-Bus, SSH, device, or host-root sockets are mounted.
- Pi's project-trust policy is left at its upstream default.

Provider credentials live under `/home/data/pi`. Do not mount controller state into a workspace or commit local `data/`. The repository ignores its default state path, but custom state paths remain the operator's responsibility.

## Browser boundary

The browser API allows only selected `agent-browser` commands and HTTP(S) URLs without embedded credentials. It rejects local and executable URL schemes, arbitrary CLI options, malformed requests, oversized output, unsafe artifact paths, and unbounded session storage.

These checks do not provide destination isolation. Chromium can access any HTTP(S) address reachable from its network, potentially including loopback-like gateways, LAN services, or cloud metadata endpoints. Use network policy or a proxy when untrusted prompts must not reach private services.

Chromium currently runs with `--no-sandbox` because the container supplies the isolation boundary. Keep the browser separate from provider credentials and workspaces. Do not weaken the container boundary with privileged mode, host networking, broad mounts, or host-control sockets.

## Tokens and exposure

Use independent high-entropy values for `SYNARA_AUTH_TOKEN` and `MEWA_BROWSER_TOKEN`. Keep `.env` outside version control. If Synara is exposed beyond host loopback, terminate TLS in a trusted reverse proxy, configure `SYNARA_PUBLIC_URL`, and disable insecure remote HTTP.

Treat anyone who can use Synara as able to exercise Pi's workspace and command permissions. Application authentication does not reduce the Unix permissions of the controller process.

## Adding capabilities

Review every extension and package as executable code. Guardrails that block secret-file reads must cover file tools, search tools, shell commands, browser uploads, and any remote transport. A tool-level denylist is defense in depth, not a replacement for filesystem permissions and mount boundaries.
