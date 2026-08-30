# Goose distribution

`version` and `source-commit` are the authoritative upstream release and source pins. The distribution builds [Goose](https://github.com/aaif-goose/goose) with unchanged Rust code and an explicit upstream feature set. Only the narrowly checked generated-lockfile correction documented in the [build policy](../docs/goose.md) is allowed; provenance records whether it applies.

The installer verifies checksums, provenance and the executable version before replacing `/usr/local/bin/goose`. It also installs `config/agents/` and the browser skill in the user's standard Goose configuration directory. Run setup as that non-root user before starting `systemd/goose.service`.

Private release downloads require authentication. The [deployment guide](../docs/deployment.md) uses `gh release download` as the ordinary user, then passes a local bundle through `GOOSE_RELEASE_BASE=file://...` to the installer. A GitHub token does not need to enter the privileged process.

See [Goose integration and releases](../docs/goose.md) for the selected build features, scheduled update policy, provenance and operator-controlled deployment.
