# mewa_code

Private experimental development controller built around two services:

- **mewa-code** — Synara + Pi, persistent agent state, selective same-path bind mounts, and transparent host execution over SSH.
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
│ /var/lib/mewa      private container state          │
│ /home/mewa         same-path bind mount             │
│ /data              same-path bind mount             │
│ /repos             same-path bind mount             │
│                                                     │
│ read/write/edit     local mount, SFTP fallback       │
│ grep/find/ls        host-backed                      │
│ bash                SSH host                        │
└───────────────────────────┬──────────────────────────┘
                            │ SSH
                            ▼
                       development host
               Git, project runtimes, Docker, systemd
```

The model sees ordinary Pi tools. SSH and SFTP are transport details, not tools exposed to the model.

## Filesystem contract

Configured roots are mounted at the **same absolute path** on the host and in `mewa-code`. For example:

```text
host        /repos/project
mewa-code   /repos/project
```

Pi selects the backend per path:

1. Existing paths whose resolved real path remains inside an approved mount use the local bind mount.
2. Paths outside those roots, including symlinks that escape them, use SFTP when fallback is enabled.
3. Process execution always runs on the SSH host.

This prevents the common split where `read("~/x")` sees a container home while `bash("cat ~/x")` sees a host home.

## Host prerequisites

The dedicated SSH user should have:

- access to the configured home/data/repository roots;
- `bash`, `git`, `rg`, `fd`, and `file` on `PATH`;
- the project toolchains the agents may invoke;
- Docker, user-systemd, or narrowly scoped `sudo` rights only when intentionally granted.

The SSH user is the authority boundary. `mewa-code` does not mount Docker, D-Bus, journal, or other privileged host sockets.

## Start

```bash
cp .env.example .env
mkdir -p secrets
# Put the dedicated SSH private key at secrets/mewa_ed25519.
# Ensure MEWA_HOME_ROOT, MEWA_DATA_ROOT, and MEWA_REPO_ROOT already exist.
docker compose config --quiet
docker compose up -d --build
```

Open `http://127.0.0.1:3773` and authenticate with `SYNARA_AUTH_TOKEN`.

## Current status

This branch is a draft implementation, not a finished distribution. It includes:

- hybrid local/SFTP Pi filesystem operations;
- SSH-backed Pi shell execution and user `!` commands;
- native Pi tool schemas and edit rendering;
- authenticated, quota-limited browser sessions and screenshot retrieval;
- read-only root filesystems, health checks, restricted mounts, and CI checks.

Synara's own Files/Git surfaces work for the same-path mounted roots. Synara's standalone terminal and paths outside the mounts still need a dedicated host-workspace adapter before they can be described as fully transparent remote surfaces. See `docs/SYNARA_REMOTE.md`.
