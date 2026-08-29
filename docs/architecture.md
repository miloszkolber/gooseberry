# Architecture

```text
Web UI ── Gooseberry controller ── Goose ACP ── /usr/local/bin/goose
   │             │                 ├─ providers/models
   │             │                 ├─ sessions/history/tools
   │             │                 └─ recipes/scheduler/permissions
   │             ├─ projects, follow-up queues, goals/tasks, Git and file projections
   │             └─ objective and supporting-question MCP
   └─ lazy browser skill ── gooseberry-browser HTTP service
```

Goose runs unchanged as a host user service on loopback. The controller and browser run as separate host-networked Docker services. The controller adapts Goose ACP messages to the Web UI and stores only Gooseberry project and presentation metadata.

## Projects and state

Projects are created in the UI and contain absolute directory roots plus presentation-only names and icons. The controller can use only directories mounted read-only at the same host path. Gooseberry state is stored under `/var/lib/gooseberry` from `${GOOSEBERRY_DATA_PATH}/app`. The controller reads the technical user's standard Goose configuration from `/home/goose/.config/goose`, while Goose keeps its canonical sessions and configuration in the user's home. Project-session records contain only project association, working directory, and optional immediate fork parent metadata. Follow-up queues are intentionally process-memory state, not a second persistent session store.

## Browser boundary

`gooseberry-browser` is a small Go service in a separate non-root, read-only container with only its browser-state mount. It exposes bounded HTTP visual-QA operations and receives no project mounts, Goose configuration, provider credentials, Node runtime, or build toolchain.

## Models and agents

Goose is the sole provider and model authority. Gooseberry projects sanitized information and stores model visibility. Custom agents are Goose agents installed by the distribution. Gooseberry summons them and presents their progress without creating a second runtime.
