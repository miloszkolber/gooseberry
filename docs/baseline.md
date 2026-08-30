# Product baseline

Gooseberry is a Web UI for Goose. Goose stores conversations and manages providers, credentials, models, tools, permissions, agents, recipes and schedules. Gooseberry stores project associations, objectives and presentation settings.

## Projects

A project contains one or more allowed directory roots and can include any number of Git repositories. Users choose and name projects in the UI. Each root must be mounted read-only in the container at its host path.

File previews, images, Markdown links, diffs and filesystem updates keep their root or repository identity. The UI provides read-only browsing, source highlighting, Git branch/HEAD information, status and uncommitted changes. Discovery results carry warnings when a limit or repository error prevents a full read. File and Git mutations go through Goose tools.

Desktop has project, content and activity panes. Narrow layouts switch between those panes. Larger views and syntax grammars load on demand; the initial JavaScript budget is 500,000 raw bytes.

## Conversations

Projects group persistent Goose sessions, including concurrent chats. The UI shows streamed replies and thinking, tool calls/results, images, permission requests, errors, usage and context. Controls include steering, interruption, follow-up queues, model/thinking choices, forks, rename, archive/restore, history search, slash commands and agent mentions.

Each chat can have one user-set goal and an ordered list of agent-managed tasks: `pending`, `active` or `done`. Session-scoped MCP lets agents update tasks and ask supporting questions. The distribution includes the Goose agents `scout`, `builder`, `strategist` and `auditor`, plus a browser skill that calls Gooseberry's browser HTTP API.

Goose stores the transcript. The controller keeps working copies with count and memory limits; inactive copies can be loaded again from Goose. Active work, queues and pending replies are retained. Follow-up queues survive a browser reconnect but not a controller restart.

## Settings

Settings exposes provider setup and native login flows, model choices and metadata, model visibility, ACP readiness, two supported preferences and global provider/model defaults. Prices appear only when Goose supplies valid values.

Users can edit the supported fields of writable global or project agents, manage recipes and schedules, enable or remove extensions, inspect active-session tools and change Goose's global tool permissions. Optional Signet settings and a health check are also available. Goose stores the underlying configuration and credentials.

## Runtime and scope

A native Goose user service and one host-networked `gooseberry` container form the deployment. The container runs one Go executable with application/MCP and browser HTTP listeners. Application and browser state live under `${GOOSEBERRY_DATA_PATH}/app` and `${GOOSEBERRY_DATA_PATH}/browser`.

There is no terminal, file editor, language server, debugger or collaborative IDE in the Web UI. Gooseberry does not run its own providers or keep a second Goose transcript store.

This is a single-user application. Goose has the Linux user's host permissions; Chromium shares the container's UID and mounted files. See [security](security.md), [deployment](deployment.md) and [ACP coverage](acp.md).
