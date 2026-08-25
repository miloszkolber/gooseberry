# Mewa Code

Mewa Code is a focused Web UI and ACP host for the Pi Coding Agent. It is intended to replace the parts of OpenChamber that are useful for day-to-day coding: directory-based projects, persistent sessions, goals and tasks, integrated subagents, multi-image prompts, Pi-reported usage, local Git visibility, and read-only file browsing.

Pi remains the agent runtime. Mewa adds a small product shell and a curated set of SDK extensions without replacing Pi's normal provider, model, session, tool, retry, compaction, or trust behavior.

## Runtime model

- The controller embeds Pi through its SDK.
- Pi's normal `bash` tool executes transparently through SSH on the development host.
- Repository files, Git status and diffs, and file previews use approved same-path mounts.
- Chromium runs in the separate `mewa-browser` service.
- Browser and ACP are the supported interfaces. There is no TUI or Web UI terminal.

## Development status

The active rewrite is on `rewrite/mewa-code-foundation`. The authoritative scope is in [`docs/product-baseline.md`](docs/product-baseline.md), with implementation sequencing in [`docs/implementation-plan.md`](docs/implementation-plan.md).

## Local deployment

Copy `.env.example` to `.env`, configure the admitted project roots and SSH credentials, then start the controller and isolated browser service:

```bash
cp .env.example .env
docker compose up -d --build
```

The controller binds to loopback by default. Provider authentication is completed through Pi. Signet memory is optional.

## License

Apache-2.0. See [`NOTICE.md`](NOTICE.md) for attribution and provenance.
