# Architecture

```text
Web UI ── Gooseberry controller ── Goose ACP ── /usr/local/bin/goose
   │             │                 ├─ providers/models
   │             │                 ├─ sessions/history/tools
   │             │                 └─ recipes/scheduler/permissions
   │             ├─ projects, goals/tasks, Git and file projections
   │             └─ objective MCP
   └─ lazy browser skill ── gooseberry-browser HTTP service
```

Goose runs unchanged as a host user service on loopback. Gooseberry controller and browser services use host networking. The controller adapts Goose ACP messages to the authenticated Web UI and stores only Gooseberry-owned presentation and project metadata.

## Projects and state

Projects contain admitted absolute roots and are not tied to one repository. Gooseberry stores project registry, session-to-project metadata, goals/tasks, UI preferences, and optional Signet settings under `/var/lib/gooseberry`. Compose maps `${GOOSEBERRY_DATA_PATH}/gooseberry/app` there. Goose retains its canonical sessions and configuration in the technical user's normal home state.

## Browser boundary

`gooseberry-browser` is a separate non-root, read-only container with only its browser state mount. It exposes bounded HTTP visual-QA operations. It receives no project mounts, Goose state, or credentials.

## Models and agents

Goose is the sole provider/model authority. Gooseberry projects sanitized information and stores model visibility. Custom agents are Goose agents installed by the distribution. Gooseberry summons them and presents their progress without creating a second runtime.
