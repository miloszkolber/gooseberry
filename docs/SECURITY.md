# Security model

`mewa_code` is a single-user development system. It is not a sandbox or a multi-tenant service.

## Authority

Pi can ask its tools to read, write, edit, search, and execute commands. The effective authority is:

- local file tools: permissions of the numeric `mewa-code` container user on the configured bind mounts;
- SFTP and shell tools: permissions of the dedicated SSH user;
- browser tool: the bounded `mewa-browser` command policy;
- Synara UI: anyone holding `SYNARA_AUTH_TOKEN` can direct the controller.

Do not give the SSH account access that agents should not have. Membership in the Docker group is normally root-equivalent.

## Credentials

- The controller SSH private key is a Docker secret and is not stored in the mounted home.
- The exact SSH host key is pinned; unknown or changed keys fail closed.
- LLM credentials stay in Pi's private `/var/lib/mewa/pi` state.
- Browser and Synara tokens are separate.
- Only environment names listed by `MEWA_SSH_FORWARD_ENV` are sent to host commands.

A dedicated host home is recommended. Mounting a personal home places all of its readable content inside the same authority boundary as the agent.

## Container restrictions

Both containers use:

- non-root users;
- read-only root filesystems;
- `no-new-privileges`;
- explicit writable volumes/tmpfs;
- disabled core dumps;
- no Docker, D-Bus, journal, or device sockets.

These restrictions reduce accidental container reach but do not constrain what the dedicated SSH account can do on the host.

## Browser boundary

`mewa-browser` exposes no generic shell. It rejects arbitrary browser options, non-HTTP URL schemes, credential-bearing URLs, reused screenshot targets, symlink artifacts, oversized requests/output/state, and concurrent commands in one session. Failed or timed-out sessions are closed and their transient state is removed.

The service joins an internal control network and a normal outbound network. Its bearer token remains required even on the internal network.

## Exposure

- Keep Synara bound to loopback unless protected by a trusted reverse proxy or private network.
- Use HTTPS for any non-loopback browser access.
- Rotate Synara, browser, and SSH credentials independently.
- Review diffs and host-side changes before promoting agent output.
