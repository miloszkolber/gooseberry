# Current rewrite state

This document records implementation reality on `rewrite/mewa-code-foundation`. It is not a source of product scope; [`product-baseline.md`](product-baseline.md) is authoritative.

## Retained foundation

The branch already provides several pieces worth keeping:

- a Bun monorepo with a headless controller, Web UI, shared contracts, and in-process Pi SDK host;
- browser and ACP as supported interfaces, with no Mewa TUI;
- persistent Pi sessions, streaming event projection, multi-image handling, Pi-backed model/provider information, and usage/context display;
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
- Monaco editor/save behavior and workbench/layout concepts;
- branch/worktree management controls rather than observational Git projection;
- repository/workspace identity coupled too tightly to one working tree;
- theme registry/settings and multiple font families;
- skills and Pi-profile management UI;
- configurable toggles for capabilities that should be part of the fixed Mewa profile;
- direct provider/model IDs in the current subagent tool rather than typed roles and model groups;
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
- keep documentation aligned with the target rather than the imported foundation.
