# Host setup

Use a dedicated Unix account for mewa. The account is both the SSH identity and the authority boundary for agent execution.

## Required account properties

Example:

```bash
sudo useradd --create-home --uid 1000 --shell /bin/bash mewa
sudo install -d -o mewa -g mewa -m 0750 /data /repos
```

Choose a UID/GID that matches `MEWA_UID` and `MEWA_GID` in Compose. Existing installations may use a different UID; consistency matters more than the example value.

The account should have:

- read/write access to the configured mount roots;
- `bash`, `git`, `rg`, `fd`, and `file` available through a login shell;
- project-specific toolchains available through its normal shell startup;
- no unrestricted sudo unless that is a deliberate product decision.

Optional privileges should be ordinary Linux policy:

```text
Docker access       add the user to the Docker group (root-equivalent on most hosts)
user services       systemctl --user / journalctl --user
specific root task  narrow NOPASSWD sudoers rule for one command
```

## SSH authentication

Generate a dedicated key for `mewa-code`; do not reuse a personal key:

```bash
ssh-keygen -t ed25519 -f ./secrets/mewa_ed25519 -C mewa-code
sudo -u mewa install -d -m 0700 /home/mewa/.ssh
cat ./secrets/mewa_ed25519.pub | sudo -u mewa tee -a /home/mewa/.ssh/authorized_keys
sudo chmod 0600 /home/mewa/.ssh/authorized_keys
```

Record the exact host public key in `MEWA_SSH_KNOWN_HOST`. Host-key checking is mandatory; there is no insecure fallback.

Recommended `authorized_keys` restrictions for the controller key:

```text
no-agent-forwarding,no-X11-forwarding,no-user-rc
```

Do not add `no-port-forwarding` if automatic dev-server forwarding is added later.

## Mounted roots

The source and target path must be identical:

```text
MEWA_HOME_ROOT=/home/mewa
MEWA_DATA_ROOT=/data
MEWA_REPO_ROOT=/repos
```

All three paths must exist before `docker compose up`; Compose is configured not to create missing host paths silently.

A dedicated home is strongly preferred over mounting a personal account. Anything readable by the dedicated SSH user is already accessible to agent commands on the host, but a dedicated account keeps unrelated personal configuration and credentials outside the authority boundary.

## Shell environment

SSH exec channels run:

```text
/bin/bash -lc '<command>'
```

Use the account's login-shell configuration to expose Go, `uv`, Node version managers, project CLIs, and other binaries. Keep interactive-only shell output guarded so non-interactive commands do not receive banners or prompts.

## Verification

From the host running Docker:

```bash
ssh -i ./secrets/mewa_ed25519 mewa@localhost \
  'printf "home=%s\n" "$HOME"; command -v git rg fd file; id'
```

Then render the stack before starting it:

```bash
docker compose config --quiet
docker compose up -d --build
```
