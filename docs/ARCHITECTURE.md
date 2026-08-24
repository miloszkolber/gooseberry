# Architecture

## Components

```text
browser ──> Synara on mewa-code ──> Pi
                    │                │
                    │                └── browser tool ──> mewa-browser ──> HTTP(S)
                    └── mounted workspace and persistent state
```

`mewa-code` builds Synara from its tagged source and frozen Bun lockfile. The final image keeps Synara's generated server and web assets, Synara's own Pi dependency tree, the compiled Mewa browser extension, and the small bootstrap. Build tools and source trees stay in build stages.

`mewa-browser` contains Chromium, a checksum-verified `agent-browser` executable, and a dependency-free Node.js API. Keeping Chromium separate prevents normal browser compromise from directly exposing Pi provider credentials or mounted workspaces.

## Pi contract

The bootstrap keeps its changes narrow:

1. It creates and validates directories below `/home/data`.
2. It preserves the user's Pi settings and adds the bundled browser extension if absent.
3. It removes exact paths for three extensions retired from earlier drafts.
4. It starts Synara and forwards termination signals.

Pi retains its default project trust, tools, model selection, thinking level, retry policy, compaction, telemetry settings, skills, and agent instructions. This keeps plain Pi behavior understandable and avoids encoding orchestration policy in the image.

Pi's file and shell tools execute in `mewa-code`. Mounted workspaces are local container paths. The controller does not mount the Docker socket, system D-Bus, SSH credentials, or other host-control interfaces.

## State contract

One writable mount at `/home/data` contains:

```text
/home/data/
├── pi/          settings, provider auth, and sessions
├── synara/      Synara application state
├── .config/     XDG configuration
├── .local/      XDG data and state
└── .cache/      Node and package caches
```

Configured persistent paths must remain physically below the state root after symlink resolution. Settings updates use a temporary file and atomic rename and occur only when serialized content changes.

Browser artifacts, profiles, and sockets stay on bounded tmpfs. A successful close deletes them immediately. Failed best-effort cleanup can retain screenshots until the browser container restarts.

## Browser protocol

The controller calls two authenticated endpoints:

- `POST /v1/browser` validates and executes one command.
- `GET /v1/artifacts/<session>/<name>` returns a screenshot.

The API does not expose arbitrary browser CLI flags, JavaScript evaluation, local files, profiles, downloads, or raw process execution. It limits command duration, response size, stored state, artifact bytes, and session count. A successful `close` removes both browser state and artifacts.

## Deliberate omissions

Remote host execution, SFTP fallback, custom plan mode, structured question tools, bundled subagent roles, web search, guardrail policy, LSPs, MCP, and Signet are not part of this image. Each changes Pi behavior or authority and should be added as an independently reviewed, optional extension or derived image.
