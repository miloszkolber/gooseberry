# Integration

Gooseberry integrates with the unchanged upstream Goose v1.48.0 distribution through its ACP service boundary. Install Goose at `/usr/local/bin/goose` and run:

```bash
goose serve --enable-scheduler
```

The service listens on `127.0.0.1:3284`. `GOOSE_SERVER__SECRET_KEY` authenticates ACP, and `GOOSEBERRY_GOOSE_SECRET_KEY` supplies the matching controller credential.

Goose remains authoritative for sessions, history, providers, models, tools, compaction, permissions, recipes, and scheduler state. Gooseberry exposes projects, goals and tasks, custom-agent summon, Git and files, and focused UI controls. Objective updates use MCP. Browser automation uses a lazy Goose skill and the separate `gooseberry-browser` HTTP service.

The distribution installs Gooseberry custom agents and the browser skill in the technical user's standard Goose configuration directory. Vanilla Goose behavior remains available outside Gooseberry.
