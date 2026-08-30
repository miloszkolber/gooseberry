# Goose integration and distribution

Gooseberry builds upstream [Goose](https://github.com/aaif-goose/goose) with its Rust runtime code unchanged. [`goose/version`](../goose/version) owns the release pin and [`goose/source-commit`](../goose/source-commit) owns its exact source commit. The build verifies the tag-to-commit identity and permits only the generated-lockfile correction described below.

## Focused native binary

The distribution builds upstream `goose-cli` with `code-mode,aws-providers,nostr,rustls-tls,system-keyring` and no default feature bundle. It keeps Goose's native CLI/service and selected provider/tool capabilities without Rust code changes. Optional self-update and telemetry features are not selected; deployment updates are operator-managed.

Each Linux x86-64 or arm64 archive contains only the `goose` executable. Packaging removes unneeded symbols with `strip --strip-unneeded` before the version and live ACP checks; the selected runtime features remain unchanged. Release assets also include `SHA256SUMS`, `GOOSE-PROVENANCE`, `LICENSE` and `NOTICE.md`. Provenance records the upstream repository, version, commit and lockfile-adjustment identity. Checksums detect corruption; their trust still depends on the authenticated release source, not an independent signature authority.

The installer verifies provenance, archive checksum, archive member safety and exact executable version before atomically replacing `/usr/local/bin/goose`. It installs the bundled agents and browser skill in the technical user's standard Goose configuration. Private releases require authenticated download; [deployment](deployment.md) describes the local-bundle installation path without passing a GitHub token to `sudo`.

## Generated-lockfile exception

The distribution permits one build-metadata correction for Goose v1.48.0: its generated `Cargo.lock` records the first-party `goose-roaming` package as `1.47.0`, while the workspace package version is `1.48.0`. The checked correction changes only that package-version entry so Cargo can build with `--locked`. It does not change Rust code, the workspace manifest, third-party dependency versions or checksums.

[`source-policy.sh`](../goose/source-policy.sh) requires a clean pinned checkout, permits only the [checked patch](../goose/cargo-lock-v1.48.0.patch), verifies the entire original and corrected lockfile by hash, and rejects other tracked or untracked source changes after the build. Ignored build outputs are allowed. Other upstream commits require a clean checkout without this adjustment; the exception does not permit regenerating the lockfile or updating dependencies.

The mandatory provenance field is `cargo-lock-adjustment=goose-roaming-1.47.0-to-1.48.0` for the allowlisted release/commit pair and `cargo-lock-adjustment=none` otherwise. The installer and release checks derive the expected value from the same source-policy helper.

## Service and additions

The systemd user service runs `goose serve --host 127.0.0.1 --port 3284 --enable-scheduler`. Its host and port are explicit CLI arguments; `GOOSE_SERVER__SECRET_KEY` supplies ACP authentication. Gooseberry connects through authenticated WebSocket ACP. Goose retains sessions, history, credentials, providers, models, tools, permissions, recipes, agents and scheduler state.

Gooseberry adds admitted directory projects, objectives/tasks, supporting questions, read-only file/Git views and browser presentation. Its custom agents remain ordinary Goose agents. Browser automation is a lazy skill calling the HTTP API inside the Gooseberry container; objective updates use session-scoped MCP. Vanilla Goose remains usable directly. See [integration](integration.md) and [ACP coverage](acp.md).

## Scheduled release flow

The repository workflows define two schedules, in UTC:

| Workflow | Schedule | Work |
| --- | --- | --- |
| Goose distribution | Daily at 03:17 | Check the latest stable upstream release, build and verify a candidate when needed, then promote its pin and publish the checked distribution. |
| Container images | Sunday at 04:37 | Validate source and rebuild the multi-architecture Gooseberry image, bypassing the runtime-stage cache to refresh installed Debian packages. |

GitHub schedules operate from the default branch and require Actions to be enabled. They are not a precise deployment clock. Pull requests validate without publishing. Relevant default-branch pushes and manual workflow dispatches also run the pipelines. A manual Goose distribution run accepts an optional stable upstream release tag; blank uses the current pin.

The Goose pipeline:

1. Resolves a stable upstream release to an immutable commit and refuses a downgrade or a moved current pin.
2. Applies only the approved lockfile correction when required, verifies source integrity, builds the focused CLI natively for both Linux architectures and checks Gooseberry's required ACP method registrations.
3. Exercises the production ACP adapter against the actual binary: bad-secret rejection, authenticated WebSocket initialization, session/provider/default projections, a disposable preference write/read, reconnect persistence and selected administration response shapes.
4. Advances only the two pin files after successful builds, then publishes the complete checked release. Published assets are verified rather than silently replaced; incomplete drafts can be completed.
5. Explicitly invokes the Gooseberry image workflow for the resulting source commit, including source validation. It does not rely on a bot-generated push triggering another workflow.

A scheduled run skips rebuilding when the current pin is already the latest stable release and has all required published assets. Every newly accepted upstream version is built and checked; this is not an automatic download of an untested executable. The image pipeline publishes architecture variants and a source-commit tag, and promotes `latest` only while that source is still the default-branch tip.

The workflow token needs content-write permission for pin promotion/releases and package-write permission for GHCR. Branch protection that disallows the bot's pin update stops promotion; an operator must resolve that policy rather than expecting an unreviewed bypass. If the default branch advances during a Goose build, publication stops so an obsolete source snapshot cannot move the pin; rerun against the current branch.

## What the checks do not prove

Method registration and a provider-free runtime probe are meaningful compatibility gates, not certification of every provider, tool, browser interaction or future schema. Changes to upstream payloads and behavior still need focused fixture updates and review. The pipeline uses disposable state and does not call a paid model.

Repository automation never installs a binary on your host or restarts an existing deployment. Operators choose an update window, back up state, install the selected pin and restart services as described in [deployment](deployment.md).
