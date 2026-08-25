# Security and trust model

## Scope

Mewa Code is a trusted single-user development tool. It is not a sandbox for hostile repositories or prompts and is not designed for multi-tenant use.

Pi may read and change admitted project files and execute commands with the configured host SSH account's permissions. Anyone able to operate an authenticated Mewa session can exercise that authority.

## Authority boundaries

- **Pi file/search tools and Mewa file/Git projection:** permissions of the non-root controller user on admitted same-path mounts.
- **Pi Bash:** permissions of the configured SSH user on the host.
- **Browser QA:** the bounded command policy of the isolated `mewa-browser` service.
- **Web UI/ACP:** authenticated clients can direct Pi sessions within admitted project roots.

Do not grant the SSH account privileges agents should not have. Docker-group membership, broad passwordless sudo, or access to sensitive service sockets is effectively host-root authority.

## Credentials and state

- Pi/provider credentials and canonical sessions remain under Pi-owned state, outside project roots.
- Mewa state remains outside project roots.
- SSH private key and known-hosts files are read-only deployment secrets.
- Controller and browser authentication material is separate from provider and SSH credentials.
- `mewa-browser` receives no SSH material, Pi/provider state, or repository mounts.
- The Web client never bundles provider runtime implementations or credentials.

The protected-state guard denies direct project-scoped file/search access to Pi and Mewa state roots, resolves existing symlinks, and blocks visible shell references as defense in depth. It is not a complete shell sandbox; filesystem layout and least-privilege host permissions are the stronger boundary.

## SSH policy

`mewa-remote` uses the system OpenSSH client with:

- an explicit host, user, and port;
- an explicit private key and known-hosts file;
- strict host-key checking;
- batch mode and disabled user SSH configuration;
- bounded connection/keepalive/command timeouts;
- cancellation and streaming output handling;
- a minimal child environment.

Provider keys, controller/browser tokens, Pi state paths, and unrelated environment values are not forwarded. Remote commands run through the configured Bash shell in an admitted working directory.

SSH is an implementation boundary, not a model-facing tool. Mewa does not use SFTP.

## Project admission

A project may contain one or more absolute roots. Every root and session working directory must:

- exist and resolve below a configured same-path mount root;
- not be `/`;
- not overlap Pi, Mewa, browser, or secret state;
- remain within its admitted root after realpath/symlink resolution.

Nested Git discovery and file preview are bounded by depth/count/size limits and never escape project roots.

## Browser isolation

`mewa-browser` runs separately, non-root, with a read-only root and bounded tmpfs/state. It exposes only selected HTTP(S) visual-QA operations and rejects arbitrary CLI flags, JavaScript evaluation, raw process execution, local/executable URL schemes, credential-bearing URLs, unsafe artifacts, traversal, and unbounded storage/output.

The browser boundary protects controller credentials and repositories; it is not destination-network isolation. Use network policy or a trusted proxy when prompts must not reach private/LAN/cloud-metadata addresses.

## Service exposure

- Bind the controller to loopback by default.
- Require an explicit trusted authentication/identity boundary before non-loopback exposure.
- Use TLS at a trusted reverse proxy for remote browser access.
- Keep controller, browser, SSH, provider, and Signet credentials independently rotatable.
- Do not add product analytics, tracking pixels, hidden telemetry, or credential-bearing logs.

Prompts and selected context are sent to the configured model provider under that provider's terms. Web access and Signet communicate with their configured external services.

## Container restrictions

Controller and browser images should run as non-root with read-only roots, `no-new-privileges`, disabled core dumps, and only explicit bounded writable mounts/tmpfs. Do not mount Docker, D-Bus, journal, device, host-root, or unrelated credential sockets into either service.

Final images must not retain source trees, tests, build toolchains, package caches, or obsolete PTY/editor dependencies.
