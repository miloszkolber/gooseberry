# mewa_code

Private experimental development controller built around two services:

- **mewa-code** — Synara + Pi, repo-owned Pi extensions, selected same-path host mounts, and transparent host execution over SSH.
- **mewa-browser** — isolated Chromium + `agent-browser` with a bounded authenticated API.

## Architecture

```text
                       mewa-browser
                  Chromium + agent-browser
                            ▲
                            │ bounded browser tool
                            │
┌───────────────────────────┴──────────────────────────┐
│ mewa-code                                            │
│                                                     │
│ Synara + Pi                                         │
│ /home/data         all controller state             │
│ /home/core         same-path host mount             │
│ /data              same-path host mount             │
│ /repo              same-path host mount             │
│                                                     │
│ read/write/edit/ls local mount, SFTP fallback       │
│ grep/find/bash     SSH host                         │
└───────────────────────────┬──────────────────────────┘
                            │ SSH
                            ▼
                       Core development host
               Git, project runtimes, Docker, systemd
```

The model sees ordinary Pi tools. SSH, SFTP, mounts, and browser RPC remain implementation details.

## Controller image

The controller is intentionally smaller than a general development container. Synara is built from its stable tagged source using its frozen Bun lockfile and release web/CLI targets. The final image contains the built Synara `dist`, locked runtime dependencies, the compiled mewa extensions, Node, Git, CA certificates, and `tini`.

It does not carry the Synara monorepo source, build toolchain, a second Pi dependency tree, `ripgrep`, Docker clients, or project language runtimes. Pi uses the version locked by Synara. Host development commands continue to run through SSH.

The current pins are recorded in `versions.env`.

## State contract

One host directory is mounted at `/home/data`. All known controller-managed configuration, credentials, sessions, and caches are directed below it:

```text
data/
├── pi/
│   ├── auth.json
│   ├── settings.json
│   └── sessions/
├── synara/
├── .config/
├── .local/
├── .cache/
│   └── node-compile-cache/
└── browser/
    └── artifacts/
```

Set its host path with `MEWA_STATE_PATH`. This state mount is separate from the development-content mounts. Bootstrap rejects persistent runtime paths that escape `/home/data` and does not rewrite Pi settings when their effective content is unchanged.

## Filesystem contract

Configured development roots are mounted at the same absolute path on the host and in `mewa-code`:

```text
host        /home/core   /data   /repo
mewa-code   /home/core   /data   /repo
```

Pi selects the backend per path:

1. Existing paths whose resolved real path remains inside an approved mount use the local bind mount.
2. Paths outside those roots, including symlinks that escape them, use SFTP when fallback is enabled.
3. `grep`, `find`, and process execution always run on the SSH host.

This keeps `~`, repository paths, file tools, and shell commands coherent while preventing controller internals from becoming the development environment.

## Preconfigured Pi

The image compiles and loads repo-owned extensions:

- `mewa-remote` — transparent mounted-filesystem, SFTP, and SSH tools;
- `mewa-browser` — bounded visual testing through the separate browser service;
- `mewa-question` — structured blocking questions;
- `mewa-plan` — read-only planning mode.

Bootstrap preserves existing user settings and adds required defaults only when absent. It links Pi's global `AGENTS.md` to `/home/core/agents/AGENTS.md` and loads skills from `/home/core/agents/skills`.

Pi provider credentials and user choices stay in `/home/data/pi`. Extensions remain immutable image content from this repository.

## Host prerequisites

The SSH account defaults to `core` and should have:

- access to `/home/core`, `/data`, and `/repo`;
- `bash`, `git`, `rg`, `fd`, and `file` on `PATH`;
- the project runtimes agents may invoke;
- Docker, systemd, or sudo rights only when intentionally granted.

The SSH account is the host authority boundary. `mewa-code` does not mount Docker, D-Bus, journal, or other privileged host sockets.

## Start

```bash
cp .env.example .env
mkdir -p data/browser secrets
chown -R 1000:1000 data
# Put the controller SSH private key at secrets/mewa_ed25519.
# Verify /home/core, /data, and /repo exist.
docker compose config --quiet
docker compose up -d --build
```

Open `http://127.0.0.1:3773` and authenticate with `SYNARA_AUTH_TOKEN`.

Docker health uses Synara's `/health` readiness snapshot and requires full startup readiness, not only an open TCP port.

## Current status

This branch remains a draft. It includes:

- one mounted controller-state root;
- a slim release-style Synara runtime image;
- one shared Synara/Pi runtime dependency tree;
- precompiled repo-owned Pi extensions;
- hybrid mounted/SFTP Pi filesystem operations;
- SSH-backed shell, search, and user `!` commands;
- authenticated, quota-limited browser sessions and screenshot retrieval;
- read-only root filesystems, graceful shutdown, readiness health checks, restricted mounts, and CI checks.

Known controller-level limitations remain:

- Synara's standalone terminal starts inside `mewa-code`, while Pi `bash` runs on the host.
- Synara Files and Changes cover mounted roots, but not SFTP-only paths.
- host development ports are not forwarded automatically to `mewa-browser` yet.

See `docs/ARCHITECTURE.md`, `docs/HOST_SETUP.md`, and `docs/SYNARA_REMOTE.md`.
