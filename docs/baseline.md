# Product baseline

Gooseberry is a focused Web UI for Goose. The pinned upstream Goose runtime remains authoritative for sessions, history, providers, models, credentials, extensions, tools, compaction, permissions, recipes and schedules. Its Rust code stays unchanged under the [distribution build policy](goose.md). Gooseberry owns projects, objectives, presentation and its integrations.

## Projects and navigation

A project contains one or more admitted absolute directory roots. It may contain no Git repository, one repository or several. Operators expose roots through read-only container mounts at the same host paths; users select and name projects in the UI.

Files, diffs, images, Markdown links and live updates retain their root or repository identity. File browsing is bounded and read-only. Git views show repository discovery, branch/HEAD, status, changed files and readable diffs; agents perform mutations through Goose tools. Incomplete discovery carries a warning rather than silently appearing complete. Source highlighting loads supported grammars on demand.

The desktop shell provides project navigation, content and activity panes. Narrow screens provide reachable pane switching. Settings and large content surfaces load on demand. The production build limits the initial JavaScript closure to 500,000 raw bytes.

## Conversations and objectives

Projects group persistent, concurrent Goose sessions. Chats present streamed text and thinking, tool calls and results, permission requests, errors, usage, context and reported model identity. Turns support multiple images. Users can steer or interrupt work, manage follow-up queues, change model/thinking choices, fork a settled session, rename, archive, restore and search history. Completions project Goose slash commands and agent mentions.

Each session may have one user-set goal and ordered agent-owned tasks with `pending`, `active` or `done` states. A session-scoped MCP service supplies objectives and lets agents ask supporting questions. The distribution includes `scout`, `builder`, `strategist` and `auditor` Goose agents. Browser automation is a lazy Goose skill backed by the browser HTTP API.

Goose is the session store. Browser tabs lease controller projections; inactive projections are bounded and reconstructible from Goose. Active work, queues and pending replies are not evicted. Follow-up queues are controller-memory state: browser reconnects preserve them, but a controller restart does not.

## Settings

Settings project Goose provider status, credential setup, native OAuth/device-code authentication, ACP readiness, model metadata and visibility, two allowlisted preferences, and global provider/model defaults. Canonical model details and prices appear only when Goose reports valid values.

The agent catalog edits bounded plain-text instructions and a small metadata subset for writable global agents or agents in an admitted project directory. Settings also expose recipes, schedules, sanitized global and active-session extension controls, the active session's tool inventory and Goose's global tool permissions. Optional Signet settings and its health check remain available. Goose retains raw configuration, credentials, source paths and persistent runtime state; Gooseberry does not maintain parallel registries.

## Runtime and limits

One native Goose user service listens on loopback. One non-root, read-only, host-networked `gooseberry` container runs one Go executable with application/MCP and browser HTTP listeners. Application state lives under `${GOOSEBERRY_DATA_PATH}/app`; browser state lives under `${GOOSEBERRY_DATA_PATH}/browser`. Goose keeps its standard user configuration and state.

This is a trusted single-user appliance. Chromium shares the container filesystem and UID. Bounded HTTP commands and filtered subprocess environments do not provide browser filesystem isolation. Goose tools have the technical user's host permissions.

The scope excludes a terminal, file editor, language server, debugger, collaborative IDE, custom provider runtime and generic administration framework. See [ACP coverage](acp.md) for exact projected and omitted capabilities, [security](security.md) for authority boundaries and [deployment](deployment.md) for supported operations.
