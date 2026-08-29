# Gooseberry baseline

Gooseberry is a focused Web UI for Goose. Goose v1.48.0 runs unchanged on the host and remains the authority for sessions, history, providers, models, extensions, tools, compaction, permissions, recipes, and scheduler state. Gooseberry owns projects, goals, tasks, presentation, integrations, and UI state.

## Projects and files

A project contains one or more absolute directory roots visible to the controller through operator-provided read-only same-path mounts. Projects are created in the UI, can have a presentation name and icon, and are not tied to a repository. Sessions retain a working directory under a project root and appear beneath their project in the navigation. Gooseberry provides bounded read-only file browsing and Shiki previews. Git discovery, branch/HEAD, status, changed files, and readable diffs are observational. Agents change files and Git through Goose tools.

## Sessions and features

Projects can contain multiple persistent and concurrent Goose sessions. Gooseberry presents streamed text, thinking, tool calls, results, errors, completion, model identity, reasoning, context, and runtime usage reported by Goose. Messages support multiple images. Session controls include steering, controller-memory follow-up queues, interruption, model and reasoning changes, loading persisted Goose sessions, native fork with immediate-parent lineage, rename, reversible archive and restore, Goose slash-command completion, exact Goose agent, recipe, and subrecipe `@` mention completion, and bounded incremental history search. Queued follow-ups survive browser refreshes but not a controller restart.

Each session may have one goal and an ordered task list with `pending`, `active`, and `done` states. Users set the goal, while agents own task creation and state through objective MCP. The same session-scoped MCP service lets an agent pause and ask the user supporting questions. Custom agents (`scout`, `builder`, `strategist`, and `auditor`) run through Goose. The browser capability is a lazy skill backed by the separate Go browser HTTP service. Settings project Goose provider status, API-key configuration, native OAuth/device-code authentication, ACP readiness, and models. Canonical metadata and per-million-token prices are shown when Goose reports them. Settings also project recipes, schedules, global extensions, active-session extensions, active-session tool inventory, and Goose's global tool permissions. Extension controls expose only sanitized identity and descriptive metadata, while Goose retains raw configuration and credentials. Schedule controls include run, pause, resume, inspection, termination, recent sessions, update, and deletion.

## Runtime and trust

Install the pinned distribution at `/usr/local/bin/goose` and run `goose serve --enable-scheduler` on loopback. The controller connects to `ws://127.0.0.1:3284/acp`. Controller and browser services run as non-root, read-only, host-networked Docker containers. `${GOOSEBERRY_DATA_PATH}/app` is Gooseberry state and `${GOOSEBERRY_DATA_PATH}/browser` is browser state. Goose keeps its standard user configuration and state in the technical user's home.

Gooseberry is a trusted single-user development appliance. See [`acp.md`](acp.md), [`security.md`](security.md), and [`deployment.md`](deployment.md).
