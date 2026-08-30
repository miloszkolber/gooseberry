# Security

Gooseberry is for one trusted user. Goose tools run with that user's host permissions. A read-only file UI does not restrict what the host agent can do.

## Service isolation

The application and browser run in separate containers. Only the application mounts project roots and application state. The browser mounts its own state and artifacts; it has no mount for project files, application data or Goose configuration.

Neither container mounts Goose configuration. Settings go through ACP, and Goose keeps its provider credentials on the host. Avoid broad home-directory mounts that would expose them. Compose passes explicit environment variables to each service; the browser does not receive the Goose secret or controller login token.

Both images run as a non-root user with a read-only root filesystem and limited writable tmpfs areas. Browser subprocesses get a restricted environment and separate session home directories, but all browser sessions still share one container UID and filesystem. Their session IDs are not separate security identities.

Chromium runs with `--no-sandbox`, so its internal sandbox is disabled. Container and mount isolation remain, but they are not a substitute for Chromium's sandbox.

Host networking allows access to local services. Command restrictions, quotas and URL checks do not provide network isolation. Egress restrictions, including access to private services or cloud metadata, remain a deployment responsibility. Page content is untrusted, and actions on websites still need the user's authorization.

## Credentials

| Connection | Authentication |
| --- | --- |
| Goose ACP | `GOOSE_SERVER__SECRET_KEY`, matched by the controller's `GOOSEBERRY_GOOSE_SECRET_KEY`. |
| Web UI | Optional `GOOSEBERRY_AUTH_ENABLED` and `GOOSEBERRY_TOKEN`; off for the default loopback listener. |
| Browser MCP, HTTP and artifacts | Compose requires a separate `GOOSEBERRY_BROWSER_TOKEN` and sets `GOOSEBERRY_BROWSER_AUTH=true`. Goose's private MCP configuration and the application's artifact proxy use that token. |
| Objective/question MCP | Always uses a session-specific bearer token. UI and browser tokens do not grant this access. |
| Model providers | Goose validates and stores credentials submitted through setup. |

Controller and browser tokens must differ. A non-loopback controller bind requires authentication unless `GOOSEBERRY_ALLOW_UNAUTHENTICATED_REMOTE=true` is explicitly set. Use authenticated HTTPS for remote access, set the trusted `GOOSEBERRY_PUBLIC_ORIGIN`, and keep same-origin checks enabled. WebSocket upgrades check that exact public origin even when a proxy forwards a different internal Host. Controller cookies last 90 days.

Browser MCP checks Host and Origin as well as authentication. Set `GOOSEBERRY_BROWSER_PUBLIC_ORIGIN` for an authenticated reverse proxy. A non-loopback browser bind requires authentication; there is no unsafe-network override. The standalone browser supports unauthenticated loopback for local development, but the supplied Compose deployment does not use it.

Protect `.gooseberry`, Goose's user configuration/state and both service state directories. Keep environment and configuration files containing tokens readable only by your user. The MCP registration can reference the browser token through `env_keys` and header expansion; keep its value in Goose's private environment or secret store, not in prompts, tool arguments, agent files or shared examples.

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
