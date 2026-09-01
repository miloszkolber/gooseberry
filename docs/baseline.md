# Product baseline

Gooseberry groups Goose conversations and agent work by project.

## Projects and files

A project has one or more admitted directory roots and may span several repositories. Roots are mounted read-only at their host paths.

The UI provides file/image previews, source highlighting, branch information, uncommitted changes, selected commits and comparisons from an explicit branch base or pinned commit. Renames retain both paths; binary, oversized and unavailable previews explain their limits. Files, links and updates retain root/repository identity. Goose tools perform mutations.

Desktop uses project, content and activity panes; narrow screens switch between them.

## Conversations

Concurrent persistent chats support streaming replies and thinking, tool results, images, permissions, questions, usage/context, steering, interruption, queued follow-ups, model/thinking choices, forks, rename, archive, search, slash commands and agent mentions. Summon calls show a bounded, best-effort list of recent child tool requests when Goose reports them.

Each chat has a user-set goal and ordered agent-managed tasks: `pending`, `active` or `done`. Session-scoped MCP lets agents update tasks and ask questions. Browser MCP provides automation and screenshots. Completed Goose App tools can open an interactive view in an isolated browser-origin sandbox.

Goose stores transcripts. The Web UI opens each chat at its newest bounded page, loads earlier user rounds on demand and refreshes open chats after reconnect. Gooseberry stores ordered follow-up queues and resumes them after browser or controller restarts. A delivery interrupted at the ACP boundary is reconciled from the transcript or held for explicit retry or removal.

## Settings

Settings includes provider setup/login, model visibility and metadata, readiness, preferences and defaults. Users can edit supported agent fields, manage extensions, recipes and schedules, inspect tools and change permissions. Optional Signet configuration is available.

Goose owns the underlying configuration and credentials. [ACP coverage](acp.md) records supported controls and integration limits.

## Runtime

The single-user deployment uses host Goose and separate application/browser containers built from one Go module. State stays in each service's own directory.

The Web UI is a read-only project workspace; host Goose tools retain the user's permissions. See [deployment](deployment.md) and [security](security.md).
