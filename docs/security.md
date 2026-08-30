# Security

Gooseberry is for one trusted user. Goose tools run with that user's host permissions. A read-only file UI does not restrict what the host agent can do.

## Shared container

The controller, browser API and Chromium share a container UID and filesystem. Browser subprocesses get a restricted environment and separate session home directories, but can read mounted project files and application data. Read-only mounts prevent writes, not reading or sending data elsewhere.

The default Compose file does not mount Goose configuration. Settings go through ACP, and Goose keeps its credentials on the host. Avoid adding broad home-directory mounts that would expose them again.

The image runs as a non-root user with a read-only root filesystem and limited writable tmpfs areas. Command restrictions, quotas and URL checks reduce accidental misuse; they are not a browser sandbox. Network egress restrictions, including access to private services or cloud metadata, remain a deployment responsibility.

## Credentials

| Connection | Authentication |
| --- | --- |
| Goose ACP | `GOOSE_SERVER__SECRET_KEY`, matched by the controller's `GOOSEBERRY_GOOSE_SECRET_KEY`. |
| Web UI | Optional `GOOSEBERRY_AUTH_ENABLED` and `GOOSEBERRY_TOKEN`; off for the default loopback listener. |
| Browser API | Separate `GOOSEBERRY_BROWSER_AUTH` and `GOOSEBERRY_BROWSER_TOKEN`; off on loopback by default. |
| Objective/question MCP | Always uses a session-specific bearer token. UI and browser tokens do not grant this access. |
| Model providers | Goose validates and stores credentials submitted through setup. |

Controller and browser tokens must differ. A non-loopback controller bind requires authentication unless `GOOSEBERRY_ALLOW_UNAUTHENTICATED_REMOTE=true` is explicitly set. Use authenticated HTTPS for remote access, set the trusted `GOOSEBERRY_PUBLIC_ORIGIN`, and keep same-origin checks enabled. WebSocket upgrades check that exact public origin even when a proxy forwards a different internal Host. Controller cookies last 90 days.

Protect `.gooseberry`, Goose's user configuration/state and the Gooseberry state directory. Setup writes `~/.config/goose/gooseberry.env` with mode `0600`.

Provider secrets pass through the browser and controller only during an explicit setup request. They are forwarded to Goose and excluded from replay storage, logs and browser snapshots. Native login flows do not give the browser direct access to Goose's configuration files.

## Files and Git

Each read checks the allowed root and resolved path. A cached result does not bypass authorization, and limits apply while reading, not only to the initial file size. The HTTP file route serves supported image formats with same-origin and no-store protections, not arbitrary downloads.

Git commands receive a restricted environment, ignore global/system configuration and disable hooks and filesystem monitors. Discovery and output have limits. The UI only observes Git; mutations use Goose tools.

## Administration

Session operations require the recorded project/session association and an allowed directory. Permission and question replies are single-use. Locks and connection generations prevent concurrent or stale operations from bypassing these checks.

The browser receives selected extension/tool fields, not raw commands, URLs, environment values, secrets, schemas or upstream warnings. Recipe saves retain Goose's security scan.

Agent editing uses opaque IDs, then rechecks the authorized source and its writability inside the mutation lock. Project editing requires an explicitly selected allowed root. Instructions are limited plain text; source paths, arbitrary properties and supporting files remain server-side.

Only `autoCompactThreshold` and `gooseThinkingEffort` are exposed as preferences. Provider-default changes require a configured, available provider. Readiness reports return booleans rather than raw diagnostics.

See [deployment](deployment.md) for access and backups, and [development](development.md) for security-related checks.
