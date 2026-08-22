# Host setup

The default Core deployment uses the existing `core` account as both the SSH identity and the authority boundary for agent execution.

## Required account properties

The account should have:

- read/write access to `/home/core`, `/data`, and `/repo` as required by current projects;
- `bash`, `git`, `rg`, `fd`, and `file` available through a login shell;
- Go, `uv`, Node tooling, and project-specific runtimes available through normal shell startup;
- Docker, systemd, and sudo rights only where intentionally granted.

Set `MEWA_UID` and `MEWA_GID` to the host account's numeric IDs. The same IDs must own the controller state directory and browser artifact directory.

Check the account before deployment:

```bash
id core
getent passwd core
sudo -u core bash -lc 'printf "home=%s\n" "$HOME"; command -v git rg fd file go uv; pwd'
```

## Controller state

Create one writable host directory for all mewa-managed state:

```bash
mkdir -p ./data/browser
chown -R 1000:1000 ./data
chmod 0700 ./data
```

Set:

```text
MEWA_STATE_PATH=./data
```

It is mounted at `/home/data`. Pi, Synara, XDG, npm, Corepack, sessions, credentials, caches, and browser artifacts are directed below that root.

Do not place project repositories or ordinary host data inside the state directory.

## Same-path mounts

The source and target path must be identical:

```text
MEWA_HOME_ROOT=/home/core
MEWA_DATA_ROOT=/data
MEWA_REPO_ROOT=/repo
```

All three paths must exist before `docker compose up`. Compose is configured not to create missing host paths silently.

Anything available through these mounts is visible to Synara's local Files and Changes surfaces. Pi validates real paths before local file access and routes mount escapes through SFTP when fallback is enabled.

## SSH authentication

Generate a dedicated controller key. Do not reuse a personal workstation key:

```bash
mkdir -p secrets
ssh-keygen -t ed25519 -f ./secrets/mewa_ed25519 -C mewa-code
install -d -o core -g core -m 0700 /home/core/.ssh
cat ./secrets/mewa_ed25519.pub | sudo -u core tee -a /home/core/.ssh/authorized_keys >/dev/null
chmod 0600 /home/core/.ssh/authorized_keys
chown core:core /home/core/.ssh/authorized_keys
```

Record the exact host public key in `MEWA_SSH_KNOWN_HOST`. Host-key checking is mandatory.

Recommended `authorized_keys` restrictions for the controller key:

```text
no-agent-forwarding,no-X11-forwarding,no-user-rc
```

Do not add `no-port-forwarding` if dev-server forwarding is implemented later.

The SSH private key is mounted as a Docker secret. It must not be stored in `/home/data`, `/home/core/agents`, or the image.

## Shell environment

SSH exec channels run the configured shell as a login shell:

```text
/bin/bash -lc '<command>'
```

Keep interactive-only shell output guarded so non-interactive commands do not receive banners or prompts. Ensure project runtime version managers initialize for non-interactive login shells when agents require them.

Pi forwards only the explicit `MEWA_SSH_FORWARD_ENV` allowlist. Do not add provider keys or controller tokens to it.

## Authority

The `core` account's normal Linux authority defines agent authority:

```text
Docker access       membership in the Docker group, usually root-equivalent
user services       systemctl --user and journalctl --user
root operation      existing sudo policy or a narrow explicit sudoers rule
```

Do not add a privileged helper, Docker socket mount, system D-Bus mount, or unrestricted sudo merely to avoid configuring SSH authority correctly.

## Canonical agent files

The runtime expects:

```text
/home/core/agents/AGENTS.md
/home/core/agents/skills/
```

Bootstrap links the global Pi rules into `/home/data/pi/AGENTS.md` and adds the skill directory to Pi settings. Presets under `/home/core/agents/presets` remain OpenCode-specific unless a future Pi orchestrator consumes them.

## Verification

Verify SSH independently:

```bash
ssh -i ./secrets/mewa_ed25519 core@localhost \
  'printf "home=%s cwd=%s\n" "$HOME" "$PWD"; command -v git rg fd file go uv; id'
```

Then render and start the stack:

```bash
docker compose config --quiet
docker compose up -d --build
```

After startup, verify:

- Synara responds on port 3773;
- Pi discovers all four bundled mewa extensions;
- Pi loads `/home/core/agents/AGENTS.md` and skills;
- `read` and `bash` agree on paths under `/home/core`, `/data`, and `/repo`;
- a symlink escaping a mounted root uses SFTP rather than container-local access;
- browser snapshot and screenshot operations work through `mewa-browser`.
