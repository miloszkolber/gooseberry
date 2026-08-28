# Gooseberry Goose distribution

`version` and `source-commit` pin the unchanged upstream `aaif-goose/goose` release and source commit. The release workflow verifies the source and publishes `GOOSE-PROVENANCE` with the Linux archives and checksums. Run `sudo ./goose/install-goose.sh` to install `/usr/local/bin/goose`, the Gooseberry agents, and the browser skill. Set `GOOSE_HOME` when installing for another technical user. `GOOSE_REPOSITORY` overrides the distribution repository when needed.

Create `.gooseberry`, then run `./scripts/setup-deployment.sh` as the non-root technical user. Setup synchronizes `~/.config/goose/gooseberry.env` with mode `0600`. Install `goose/systemd/goose.service`, then start it with `systemctl --user daemon-reload && systemctl --user enable --now goose.service`. Rerun setup after changing the Goose secret or browser authentication.
