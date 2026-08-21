# Migration from opencode-docker

Run mewa beside the existing OpenChamber/OpenCode stack until the host transport and browser checks are proven.

## State separation

Do not reuse the old `/home/data` application state as `/var/lib/mewa`.

```text
opencode-docker data   legacy OpenChamber/OpenCode sessions and credentials
mewa-state             Synara state, Pi sessions, Pi credentials and settings
mounted roots          ordinary host home/data/repository files
```

OpenCode sessions are not Pi sessions and should remain available through the old runtime during the transition.

## Suggested sequence

1. Create the dedicated SSH user and key described in `HOST_SETUP.md`.
2. Configure the same-path home/data/repository roots.
3. Start `mewa-code` and verify a harmless Pi prompt can read a mounted file and run `pwd`, `id`, and `git status` on the host.
4. Verify a path outside the mounts is read through SFTP rather than from the container.
5. Run the browser smoke flow against a local host dev server.
6. Move shared Agent Skills into Pi's configured global skill path or the dedicated host home.
7. Recreate provider authentication in Pi; do not copy OpenCode OAuth/plugin state blindly.
8. Keep `opencode-assistant` running only for the old OpenCode stack.
9. Remove the old runtime and assistant after important sessions, browser QA, Git/worktrees, Docker access, and scheduled workflows have replacements.

## Tools that move to the host

- project Node/Bun/npm tooling;
- Go and `uv` binaries already installed there;
- `gh` and Git credentials;
- Docker and systemd access;
- project language servers.

Chromium and `agent-browser` move to `mewa-browser`, not the host.

## Rollback

The stacks use separate ports, images, and state. Rollback is stopping mewa and starting the unchanged OpenChamber/OpenCode services; project files remain host-owned throughout.
