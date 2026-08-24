# Architecture

## Components

```text
browser ──> Synara on mewa-code ──> Pi ──> subagents
                    │                ├── MCP proxy ──> hosted Exa
                    │                ├── Signet connector ──> Signet daemon
                    │                └── browser tool ──> mewa-browser ──> HTTP(S)
                    └── mounted workspace and persistent state
```

`mewa-code` builds Synara from its tagged source and frozen Bun lockfile. The final image keeps Synara's generated server and web assets, Synara's own Pi dependency tree, pinned Pi extensions, compiled Mewa extensions, and the small bootstrap. Build tools and source trees stay in build stages. Runtime tools are limited to Node.js and npm, Bash, Git, OpenSSH client, CA certificates, and `tini`.

`mewa-browser` contains Chromium, a checksum-verified `agent-browser` executable, and a dependency-free Node.js API. Keeping Chromium separate prevents normal browser compromise from directly exposing Pi provider credentials or mounted workspaces.

## Pi contract

The bootstrap keeps its changes narrow:

1. It creates and validates directories below `/home/data`.
2. It preserves the user's Pi settings and adds the image-owned browser, guardrail, question, MCP, and subagent extensions.
3. It adds the baked Signet connector only when a daemon URL is configured.
4. It defaults subagents to inherited thinking without overriding an explicit user setting.
5. It reconciles an image-managed Exa entry into the standard global MCP JSONC file while preserving existing servers and custom Exa definitions.
6. It removes exact paths for remote-workspace and plan extensions retired from earlier drafts.
7. It starts Synara and forwards termination signals.

Pi retains its default project trust, built-in tools, model selection, retry policy, compaction, telemetry settings, skills, and agent instructions. Subagent roles do not pin a model, and bundled role thinking defaults are cleared so the current session remains authoritative.

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

The image-managed MCP default lives at `/home/data/.config/mcp/mcp.json`. It is added or removed with `MEWA_EXA_ENABLED`, while Pi's global and project MCP override files remain available at their normal higher-precedence locations.

Browser artifacts, profiles, and sockets stay on bounded tmpfs. A successful close deletes them immediately. Failed best-effort cleanup can retain screenshots until the browser container restarts.

## Browser protocol

The controller calls two authenticated endpoints:

- `POST /v1/browser` validates and executes one command.
- `GET /v1/artifacts/<session>/<name>` returns a screenshot.

The API does not expose arbitrary browser CLI flags, JavaScript evaluation, local files, profiles, downloads, or raw process execution. It limits command duration, response size, stored state, artifact bytes, and session count. A successful `close` removes both browser state and artifacts.

## Extension boundaries

Remote host execution, SFTP fallback, custom plan mode, LSPs, and general host-control tools are not part of this image. Exa is the only image-provided MCP server. Signet remains opt-in through its daemon URL. Additional runtimes, MCP servers, agents, and extensions should be added through normal Pi configuration or an independently reviewed derived image.
