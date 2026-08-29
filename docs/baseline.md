# Gooseberry baseline

Gooseberry is a focused Web UI for Goose. Goose v1.48.0 runs unchanged on the host and remains the authority for sessions, history, providers, models, tools, compaction, permissions, recipes, and scheduler state. Gooseberry owns projects, goals, tasks, presentation, integrations, and UI state.

## Projects and files

A project contains one or more absolute directory roots visible to the controller through operator-provided read-only same-path mounts. Projects are created in the UI and are not tied to a repository. Sessions retain a working directory under a project root. Gooseberry provides bounded read-only file browsing and Shiki previews. Git discovery, branch/HEAD, status, changed files, and readable diffs are observational. Agents change files and Git through Goose tools.

## Sessions and features

Projects can contain multiple persistent and concurrent Goose sessions. Gooseberry presents streamed text, thinking, tool calls, results, errors, completion, model identity, reasoning, context, and usage reported by Goose. Messages support multiple images. Session controls include steering, interruption, model and reasoning changes, loading persisted Goose sessions, Goose slash-command completion, and bounded incremental history search.

Each session may have one goal and an ordered task list with `pending`, `active`, and `done` states. Objective updates use MCP. Custom agents (`scout`, `builder`, `strategist`, and `auditor`) run through Goose. The browser capability is a lazy skill backed by the separate Go browser HTTP service. Settings project Goose provider status, API-key configuration, native OAuth/device-code authentication, models, recipes, and schedules. Schedule controls include run, pause, resume, inspection, termination, recent sessions, update, and deletion.

## Runtime and trust

Install the pinned distribution at `/usr/local/bin/goose` and run `goose serve --enable-scheduler` on loopback. The controller connects to `ws://127.0.0.1:3284/acp`. Controller and browser services run as non-root, read-only, host-networked Docker containers. `${GOOSEBERRY_DATA_PATH}/app` is Gooseberry state and `${GOOSEBERRY_DATA_PATH}/browser` is browser state. Goose keeps its standard user configuration and state in the technical user's home.

Gooseberry is a trusted single-user development appliance. See [`security.md`](security.md) and [`deployment.md`](deployment.md).
