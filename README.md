# mewa_code

`mewa_code` packages [Synara](https://github.com/Emanuele-web04/synara), its bundled [Pi](https://pi.dev/) runtime, and an isolated browser service as two containers:

- **mewa-code** runs Synara and Pi.
- **mewa-browser** runs Chromium and `agent-browser` behind a small authenticated API.

The integration stays close to default Pi behavior. It adds one `browser` tool and redirects mutable state below `/home/data`. It does not replace Pi's file or shell tools, select a model or thinking level, trust projects automatically, or add custom plan and subagent behavior.

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

The generic Compose file mounts `MEWA_WORKSPACE_PATH` at `/workspace`. Pi commands run inside `mewa-code`, not on the Docker host. The image intentionally contains only Node.js, Git, CA certificates, `tini`, Synara, Pi, and the browser extension. Add project runtimes in a derived image when a workspace needs them.

## Browser behavior

The `browser` tool supports a bounded visual-QA command set: HTTP(S) navigation, page snapshots and reads, screenshots, common interactions, accessibility checks, web vitals, viewport changes, and session close.

`mewa-browser` applies bearer authentication, request and process deadlines, output limits, session limits, per-session and global storage quotas, and guarded artifact retrieval. Browser profiles and screenshots are temporary. A successful session close removes them immediately. Failed cleanup can retain screenshots until the browser container restarts.

The browser service is isolation for controller credentials, not a complete web sandbox. It can reach HTTP(S) destinations available from its Docker network, including private services. See [docs/SECURITY.md](docs/SECURITY.md).

## Build and test

```bash
npm --prefix mewa-code ci --include=dev
npm --prefix mewa-code run check
npm --prefix mewa-code run build
npm --prefix mewa-browser test
node scripts/check-versions.mjs

docker build -t mewa-code:local mewa-code
docker build -t mewa-browser:local mewa-browser
```

Component versions are recorded in `versions.env`. Downloaded Synara and `agent-browser` artifacts are checksum-verified during image builds.

## Current limits

- Pi and Synara terminals execute inside the controller image, so host tools are unavailable unless explicitly installed or exposed.
- Synara Files and Changes operate on mounted workspaces only.
- Host development-server routing into `mewa-browser` is deployment-specific.
- ARM64 browser downloads are checksum-pinned but are not covered by this repository's current CI.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the runtime contract and [NOTICE.md](NOTICE.md) for upstream attribution.
