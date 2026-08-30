# Goose distribution

The distribution builds [Goose](https://github.com/aaif-goose/goose) without changing its Rust runtime code. [`goose/version`](../goose/version) pins the release; [`goose/source-commit`](../goose/source-commit) pins its source commit. The build checks that the tag and commit agree.

## Build and installation

The CLI uses these upstream features with the default bundle disabled:

```text
code-mode,aws-providers,nostr,rustls-tls,system-keyring
```

Optional self-update and telemetry features are not selected. Updates are installed by the user, not by the running service.

Linux x86-64 and arm64 archives each contain one `goose` executable. Unneeded symbols are stripped before version and live ACP checks. Release assets also include checksums, provenance and legal notices. `GOOSE-PROVENANCE` records the upstream repository, version, commit and any allowed lockfile adjustment. A checksum verifies the downloaded bytes; trust in their origin still depends on the release source.

The installer verifies those records, the archive contents and the executable version before replacing `/usr/local/bin/goose`. It also installs the bundled Goose agents and browser skill in the user's configuration directory. The [setup guide](deployment.md) explains private downloads without passing a GitHub token to `sudo`.

## One lockfile correction

Goose v1.48.0's generated `Cargo.lock` names the first-party `goose-roaming` package as `1.47.0`, while the workspace package is `1.48.0`. The [allowed patch](../goose/cargo-lock-v1.48.0.patch) changes only that entry so Cargo can build with `--locked`. Rust code, manifests, third-party versions and checksums stay unchanged.

[`source-policy.sh`](../goose/source-policy.sh) permits this correction only for the exact approved release/commit pair. It requires a clean checkout, checks the complete lockfile hashes before and after the patch, and rejects other source changes after compilation. Ignored build output is allowed. Other commits must build without an adjustment.

Provenance must contain `cargo-lock-adjustment=goose-roaming-1.47.0-to-1.48.0` for that pair, or `cargo-lock-adjustment=none` otherwise. The installer and release checks use the same helper to determine the expected value. The exception does not authorize regenerating the lockfile or updating dependencies.

## Running Goose

The systemd user service runs:

```bash
goose serve --host 127.0.0.1 --port 3284 --enable-scheduler
```

`GOOSE_SERVER__SECRET_KEY` authenticates ACP. Gooseberry connects over WebSocket and leaves Goose in charge of its sessions, configuration and tools. The bundled agents are ordinary Goose agents; the browser skill calls Gooseberry's HTTP API. See [integration](integration.md).

## Releases

| Workflow | UTC schedule | Purpose |
| --- | --- | --- |
| Goose distribution | Daily, 03:17 | Check, build and verify new stable Goose releases. |
| Container images | Sunday, 04:37 | Validate source and rebuild the image, refreshing runtime packages. |

Schedules use the default branch and require GitHub Actions to be enabled. Relevant pushes and manual dispatches also run the workflows; pull requests validate without publishing. A manual Goose run accepts a stable release tag, or uses the current pin when left blank.

A Goose update resolves the upstream tag to a commit, checks source integrity, and builds both architectures natively. The resulting binaries are tested through the production ACP adapter: authentication rejection/acceptance, session and provider reads, defaults, a temporary preference write/read, reconnect persistence and selected administration responses. Required method registrations are checked against upstream source.

After those checks pass, the workflow updates the two pin files, publishes the complete release and explicitly starts the Gooseberry image build for that commit. Existing published assets are verified rather than replaced; incomplete drafts can be completed. If the latest stable version already has a complete verified release, the daily job does not rebuild it.

The image build publishes architecture variants and a source-commit tag. It updates `latest` only if that source is still the default-branch tip. Scheduled image builds bypass the runtime-stage cache to refresh Debian packages.

The workflow needs content-write permission for pins/releases and package-write permission for GHCR. Branch protection can block pin updates. A branch change during the Goose build also stops publication; rerun against the new tip. Neither case bypasses verification.

These checks do not exercise every model, tool or future response shape. They use temporary state and make no paid model call. Repository releases never install a host binary or restart a deployment; follow the [update procedure](deployment.md).
