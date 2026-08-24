---
id: submodule-server-auth
type: submodule-design
status: active
title: auth — provider status + in-app login
parent: module-server
depends-on: [module-contracts]
references: [submodule-server-agent]
tags: [v1, auth, pi]
---

## Responsibility

Everything about model-provider credentials: the read side rendered by the Welcome strip
(`provider.status`) and the write side that configures credentials from inside the app. OAuth sign-in,
interactive API-key entry, and logout all go through Pi's `ModelRuntime`. The host never parses
`auth.json` or `models.json` and never sends credential values over the wire.

## Boundary

- **Owns:**
  - `providerStatus` — `getProviderStatus()` builds the wire `ProviderStatusReport` from the current
    runtime. Rows contain provider id, display name, configured state, auth kind (`oauth`, `api-key`,
    `env`, or `other`), and capability flags (`canOAuth`, `canApiKey`, `canLogout`). Every read revalidates
    through the `agent` runtime facade with network disabled, so external Pi credential changes become
    visible without duplicating Pi's storage logic.
  - `providerLogin` — `startLogin(providerId, type = "oauth")` returns a `loginId` synchronously and runs
    `runtime.login()` detached. OAuth and interactive API-key flows use the same `provider.login` channel.
    Pi's `AuthInteraction` maps notifications, URLs, device codes, progress, selections, and text/secret
    prompts to `LoginFrame` values. `resolveLogin()` answers a parked prompt, `cancelLogin()` aborts and
    settles it, `cancelAllLogins()` drains flows during host shutdown, and `logoutProvider()` delegates to
    `runtime.logout()`.
- **Public surface (barrel):** `getProviderStatus`, `buildProviderReport` and `ProviderStatusSources`;
  `startLogin`, `resolveLogin`, `cancelLogin`, `cancelAllLogins`, `logoutProvider`, and
  `setLoginPublisher`.
- **Allowed deps:** `contracts` wire types, the `agent` barrel for the current runtime/auth facade, and
  `@earendil-works/pi-ai` auth interaction types.
- **Forbidden:** reaching into `agent` internals, importing `host` or other sibling features, deep-importing
  Pi's TUI, or placing a credential value on the wire.

## Get right

- `loginStart` must not await the provider flow. Return the handle and run `login()` detached.
- Pre-session reads and writes capture the current runtime. Pi remains the source of truth for credentials,
  availability, auth capabilities, and persistence.
- API keys persist only through Pi's interactive `login(id, "api_key", interaction)` flow. Do not use a
  canned one-prompt answer, because several providers require multiple prompts.
- Cancellation settles both the parked interaction and its abort signal.
- Frames accumulate client-side until exactly one terminal `success` or `error` outcome is emitted.

## Consumed by

`host` wires the `provider.*` handlers and `provider.login` channel. `agent` does not depend on `auth`.
