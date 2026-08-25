# Current rewrite state

This document records implementation reality on `rewrite/mewa-code-foundation`. It is not a source of product scope; [`product-baseline.md`](product-baseline.md) is authoritative.

## Retained foundation

The branch already provides several pieces worth keeping:

- a Bun monorepo with a headless controller, Web UI, shared contracts, and in-process Pi SDK host;
- browser and ACP as supported interfaces, with no Mewa TUI;
- persistent Pi sessions, streaming event projection, multi-image handling, and Pi-backed usage/context display;
- a complete provider settings surface that lists every Pi-registered/catalogued/credentialed provider and exposes Pi-supported OAuth/API-key actions;
- a complete model catalog surface with availability, context/output limits, text/image modality, reasoning support, Pi-reported pricing, search, refresh, and persistent hide/show preferences;
- transparent SSH-backed Pi Bash using Pi's normal public tool definition rather than a model-visible SSH tool;
- same-path mount admission and protected-state guards;
- local Git/files/worktree infrastructure inherited from ThinkRail;
- an isolated `mewa-browser` service and first-class browser result rendering;
- optional Signet integration and web access;
- an ephemeral session-goal extension;
- structured in-process child Pi sessions and a dedicated subagent UI card;
- multi-stage non-root controller/browser images and exact dependency catalog pins;
- WebSocket/controller authentication and loopback-first Compose defaults.

## Conflicts to remove

The current foundation still includes behavior outside the baseline:

- Web UI terminal and PTY runtime have been removed; remaining work should not reintroduce terminal surfaces.
- Monaco and file editing have been removed; the remaining workspace shell still needs to collapse into the focused project/session layout;
- branch/worktree management controls rather than observational Git projection;
- repository/workspace identity coupled too tightly to one working tree;
- theme registry/settings and extra font families have been removed; the UI now follows the system color scheme with one bundled mono face;
- skills and Pi-profile controls have been removed from active chat/settings; inherited worktree creation code still carries obsolete controls and will be deleted with worktree management;
- configurable toggles for capabilities that should be part of the fixed Mewa profile;
- direct provider/model IDs in the current subagent tool rather than typed roles and model groups; model visibility is currently a UI preference and is intentionally separate from this future routing policy;
- a single generic child role rather than scout/builder/strategist/auditor policy;
- no lightweight task list alongside the session goal;
- no scheduled atomic Pi-family update workflow; the inherited release-version helper has been removed and will be replaced with a focused Pi updater;
- broad inherited tests and runtime checks that should shrink with removed features;

## Near-term invariant

Until the simplification is complete:

- preserve the existing Pi SDK/session projection and ACP connector;
- preserve SSH Bash behavior and browser isolation;
- do not add new workbench/editor/terminal dependencies;
- avoid migrations that make projects more repository-specific;
- delete obsolete tests with their features;
- keep documentation aligned with the target rather than the imported foundation;
- keep Pi authoritative for provider/model registries and credentials while Mewa only projects metadata and model visibility.
