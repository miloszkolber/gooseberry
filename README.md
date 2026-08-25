# Mewa Code

Mewa Code is a focused Web UI and ACP host for the Pi Coding Agent. It is intended to replace the parts of OpenChamber that are useful for day-to-day coding: directory-based projects, persistent sessions, goals and tasks, integrated subagents, multi-image prompts, Pi-reported usage, complete provider/model management, local Git visibility, and read-only file browsing.

Pi remains the agent runtime. Mewa adds a small product shell and a curated set of SDK extensions without replacing Pi's normal provider, model, session, tool, retry, compaction, or trust behavior.

## Runtime model

- The controller embeds Pi through its SDK.
- Pi's normal `bash` tool executes transparently through SSH on the development host.
- Repository files, Git status and diffs, and file previews use approved same-path mounts.
- Chromium runs in the separate `mewa-browser` service.
- Provider and model settings project Pi's complete registries, supported authentication actions, capabilities, limits, availability, and pricing; model hiding remains a Mewa-only preference.
- Browser and ACP are the supported interfaces. There is no TUI or Web UI terminal.

## Deployment

Prepare one admitted root and strict host SSH credentials with the idempotent setup helper:

```bash
./scripts/setup-deployment.sh /absolute/project-root core host.docker.internal
# Install the printed public key for that host account, then:
docker compose pull
docker compose up -d --no-build
```

The controller binds to loopback by default. If `MEWA_CODE_TOKEN` is omitted, it generates a persistent login token on first start; retrieve it with `docker compose exec mewa cat /var/lib/mewa/controller-token`. Provider authentication and model visibility are managed from the Web UI through Pi-backed APIs. Signet memory is optional.

For local image development, use `docker compose up -d --build` instead. The authoritative scope is [`docs/product-baseline.md`](docs/product-baseline.md), and the implemented state is summarized in [`docs/current-state.md`](docs/current-state.md).

## License

Apache-2.0. See [`NOTICE.md`](NOTICE.md) for attribution and provenance.
