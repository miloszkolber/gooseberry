---
id: module-ci-release
type: module-design
status: draft
title: CI and deferred distribution
parent: architecture
---

## Current automation

`.github/workflows/ci.yml` is the only enabled workflow. Pull requests to `main` run dependency and binary-seam checks, lint, type checking, unit tests, no-agent browser tests, and source-built binary smoke coverage. It uses no model-provider credentials.

`CODEOWNERS` records the initial Mewa repository owner only. GitHub branch-protection and review rules are external repository settings and are not asserted by this source tree.

## Deferred distribution

No workflow publishes binaries, installers, releases, a website, or preview deployments. The imported build and checksum actions remain developer-facing implementation material, not an active release pipeline. Root installer entry points are intentionally absent, and the CLI self-update path is disabled.

Before distribution is enabled, the release design must be reviewed against the actual target platforms and must:

- package Apache-2.0 `LICENSE`, `NOTICE.md`, and applicable third-party notices with every artifact
- sign or clearly document unsigned artifacts
- publish checksums and verify them end to end
- activate installer and update commands only after their real URLs work
- verify each native artifact on its target platform
- define the real website origin before enabling a site workflow

## Boundary

Automation may invoke the same repository checks and build scripts developers run. It must not add release-only product behavior or claim that absent infrastructure is active.
