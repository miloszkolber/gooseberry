# mewa_code

`mewa_code` packages [Synara](https://github.com/Emanuele-web04/synara), its bundled [Pi](https://pi.dev/) runtime, and an isolated browser service as two containers:

- **mewa-code** runs Synara and Pi.
- **mewa-browser** runs Chromium and `agent-browser` behind a small authenticated API.

The integration stays close to default Pi behavior. It adds an isolated `browser` tool, Exa web search and fetch through MCP, subagents, optional Signet memory, a focused `question` tool, and configurable restricted-path checks. It does not replace Pi's file or shell tools, select a model or thinking level, trust projects automatically, or add custom plan behavior.

## Start locally

Requirements: Docker Compose, a writable state directory owned by the configured UID/GID, and a workspace that can be mounted into the controller.

```bash
cp .env.example .env
mkdir -p data
chown -R 1000:1000 data
# Replace both example tokens in .env.
docker compose config --quiet
docker compose up -d --build
```

Open `http://127.0.0.1:3773` and use `SYNARA_AUTH_TOKEN` when prompted. Pi credentials and settings persist under `data/pi`. Synara state persists under `data/synara`.

The generic Compose file mounts `MEWA_WORKSPACE_PATH` at `/workspace`. Pi commands run inside `mewa-code`, not on the Docker host. The final controller image retains Node.js and npm, Bash, Git, OpenSSH client, CA certificates, and `tini` because normal Pi and Git workflows need them. Compilers, package source trees, and build-only dependencies stay outside the final image. Add project runtimes in a derived image when a workspace needs them.

## Pi integrations

`pi-subagents` is pinned and loaded from the image. Its built-in role thinking defaults are disabled unless the user has already chosen a different setting, so children inherit the current session's thinking level. The parent can still select a child model per run. The image supplies a model-neutral `researcher` role that uses the MCP proxy.

`pi-mcp-adapter` is pinned to the newest release compatible with Pi 0.81.1. The bootstrap non-destructively adds an image-managed `mewa-exa` entry for Exa's hosted `web_search_exa` and `web_fetch_exa` tools to the standard user-global MCP file. Exa's free tier works without a key. Set `EXA_API_KEY` for higher limits, or set `MEWA_EXA_ENABLED=0` to remove the image-managed entry. Existing servers, comments, settings, and custom `exa` definitions are preserved. Project-level MCP files can override the image default.

The Signet Pi connector is baked into the image but loaded only when `SIGNET_DAEMON_URL` is non-empty. Set `SIGNET_AGENT_ID` and `SIGNET_PATH` as needed. The default host deployment points it at the existing daemon through `host.docker.internal`.

Pi 0.81.1 includes ChatGPT Plus/Pro OAuth under the `openai-codex` provider and API-key providers for OpenCode Zen (`opencode`) and OpenCode Zen Go (`opencode-go`). The image leaves provider authentication, model choice, and thinking level to Pi and the user.

`MEWA_RESTRICTED_PATHS` is a PATH-style list of absolute paths. It defaults to `/home/data`, preventing normal Pi file and search tools from opening provider credentials, sessions, and application state. The guard also resolves existing symlinks and rejects shell commands that visibly reference a restricted path. Shell parsing is defense in depth, not a complete sandbox. Do not mount secrets or untrusted host paths into the controller.

## Browser behavior

The `browser` tool supports a bounded visual-QA command set: HTTP(S) navigation, page snapshots and reads, screenshots, common interactions, accessibility checks, web vitals, viewport changes, and session close.

`mewa-browser` applies bearer authentication, request and process deadlines, output limits, session limits, per-session and global storage quotas, and guarded artifact retrieval. Browser profiles and screenshots are temporary. A successful session close removes them immediately. Failed cleanup can retain screenshots until the browser container restarts.

The browser service is isolation for controller credentials, not a complete web sandbox. It can reach HTTP(S) destinations available from its Docker network, including private services. See [docs/SECURITY.md](docs/SECURITY.md).

## Build and test

```bash
npm --prefix mewa-code ci --include=dev
npm --prefix mewa-code run check
npm --prefix mewa-code test
npm --prefix mewa-browser test
node scripts/check-versions.mjs

docker build -t mewa-code:local mewa-code
docker build -t mewa-browser:local mewa-browser
```

Component versions are recorded in `versions.env`. Downloaded Synara and `agent-browser` artifacts are checksum-verified during image builds.

## Current limits

- Pi and Synara terminals execute inside the controller image, so host tools are unavailable unless explicitly installed or exposed.
- Synara Files and Changes operate on mounted workspaces only.
- The hosted Exa endpoint is externally operated and its free tier is rate-limited.
- Restricted-path checks cannot prove the behavior of arbitrary shell programs or prevent access through every possible indirection.
- Host development-server routing into `mewa-browser` is deployment-specific.
- ARM64 browser downloads are checksum-pinned but are not covered by this repository's current CI.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the runtime contract and [NOTICE.md](NOTICE.md) for upstream attribution.
