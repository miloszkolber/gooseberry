# Review of `opencode-docker`

Source reviewed: `miloszkolber/opencode-docker`, especially `runtime/` and its publication workflow.

## Carried into mewa_code

| Existing practice | mewa implementation |
|---|---|
| Non-root UID/GID 1000 runtime | Compose defaults to `1000:1000` and can match the mounted host paths with `MEWA_UID`/`MEWA_GID`. |
| Read-only root filesystem | Both services use `read_only: true`. |
| Writable bounded runtime directories | `/tmp`, `/run`, Pi/Synara state, and browser artifacts are explicit tmpfs/volumes. |
| Disabled core dumps | Both services set `ulimits.core: 0`. |
| Chromium shared memory | `mewa-browser` retains `shm_size: 512m`. |
| Health checks | Both images and Compose define dependency-free Node health checks. |
| Narrow project mounts | Only configured home/data/repository roots are mounted; Docker, D-Bus, and journal sockets are absent. |
| Browser command allowlist | `mewa-browser/src/policy.mjs` preserves command-specific options and rejects arbitrary browser flags. |
| HTTP(S)-only browsing | File/data/javascript/about/chrome schemes and credential-bearing URLs are rejected. |
| Browser session isolation | Each browser session gets an isolated home, XDG state, socket directory, lock, and storage accounting. |
| Bounded browser execution | Command time, process output, browser state, artifacts, request bodies, and screenshot sizes are bounded. |
| Safe screenshot finalization | Screenshots use a fresh temporary file and hard-link commit; existing targets, symlinks, and path traversal are rejected. |
| Failure cleanup | Failed, timed-out, and quota-limited sessions are closed and partial artifacts removed. |
| Restricted environment | `agent-browser` receives a small constructed environment instead of the controller's credentials. |
| Docker context filtering | Both image directories have `.dockerignore`. |
| CI validation | The new workflow validates Compose, JS/TS, browser policy tests, and both Docker builds. |
| Explicit upstream versions | `versions.env` records the initial Synara, Pi, agent-browser, and Node versions. |

## Replaced by the new architecture

### `opencode-assistant`

The Go broker existed because OpenCode in the container needed a bounded route to Docker, systemd, journal, and selected host commands. In mewa, Pi executes as a dedicated SSH user. Standard Unix account, group, and sudo policy now define authority, so the custom privileged broker is removed.

### Bundled project toolchains

The old runtime included Go, `uv`, Node project tooling, GitHub CLI, Chromium, and `agent-browser`. In mewa:

- project toolchains, Go, `uv`, `gh`, Docker, and systemd stay on the SSH host;
- Chromium and `agent-browser` move to `mewa-browser`;
- `mewa-code` keeps only Node, Git, ripgrep, CA certificates, and tini.

### OpenChamber packaging and patch

OpenChamber, OpenCode, Bun, and `disable-agent-web-tool.patch` are unrelated to Synara/Pi and are not migrated.

## Deliberate differences

- Browser artifacts live in their own volume and are retrieved through an authenticated endpoint instead of being written directly into `.opencode/artifacts`.
- The browser control network is private, but `mewa-browser` also joins the default network for outbound HTTP(S) and host preview access.
- The original image was AMD64-only. The mewa draft does not claim multi-architecture support until Chromium and Synara native dependencies are tested on ARM64.
- The original scheduled updater automatically committed new upstream versions. The mewa draft begins with validation and pinned metadata; automated dependency promotion should be added only after the first runnable stack is stable.

## Remaining validation

1. Confirm Synara's Pi SDK integration accepts the dynamically replaced core tools.
2. Run the browser service against the pinned `agent-browser` npm layout and system Chromium.
3. Verify named-volume ownership when Compose overrides the image user.
4. Test Git/worktree operations against each same-path mount.
5. Test SSH cancellation against commands that spawn process groups.
6. Add a Synara Terminal SSH PTY adapter or disable that surface until implemented.
