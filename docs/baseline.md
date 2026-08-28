# Gooseberry baseline

Gooseberry is a focused Web UI for Goose. Goose v1.48.0 runs unchanged on the host and remains the authority for sessions, history, providers, models, tools, compaction, permissions, recipes, and scheduler state. Gooseberry owns projects, goals, tasks, presentation, integrations, and UI state.

## Projects and files

A project contains one or more admitted absolute directory roots. Sessions belong to a project and retain a working directory under an admitted root. Gooseberry provides bounded read-only file browsing and Shiki previews. Git discovery, branch/HEAD, status, changed files, and readable diffs are observational. Agents change files and Git through Goose tools.

## Sessions

Projects can contain multiple persistent and concurrent Goose sessions. Gooseberry presents streamed text, thinking, tool calls, results, errors, completion, model identity, reasoning, context, and usage reported by Goose. Messages support multiple images. Session controls include steering, interruption, model/reasoning changes, and loading persisted Goose sessions.

## Gooseberry features

Each session may have one goal and an ordered task list with `pending`, `active`, and `done` states. Objective updates use MCP. Custom agents (`scout`, `builder`, `strategist`, and `auditor`) are available through Goose and can be summoned in Goose sessions. The browser capability is a lazy skill backed by the separate browser HTTP service. Recipe and schedule settings expose the supported Goose controls only.

## Providers and models

Gooseberry displays provider and model information supplied by Goose and stores only presentation visibility. It does not implement provider login, provider runtimes, or a competing catalog. Model capability and pricing fields are shown only when Goose reports them. See [`models.md`](models.md).

## Runtime and state

Install the pinned distribution at `/usr/local/bin/goose` and run `goose serve --enable-scheduler` on loopback. The controller connects to `ws://127.0.0.1:3284/acp`. Controller and browser services run in host-networked Docker containers. `${GOOSEBERRY_DATA_PATH}/gooseberry/app` is Gooseberry state, `${GOOSEBERRY_DATA_PATH}/gooseberry/browser` is browser state, and Goose keeps its standard user state in the technical user's home.

## Trust

Gooseberry is a trusted single-user development appliance. The authenticated technical user grants Goose and Gooseberry the permissions of the configured host account. See [`security.md`](security.md) and [`deployment.md`](deployment.md).
