# Contributing to Mewa Code

Contributions are licensed under the [Apache License 2.0](../LICENSE) and follow the [Code of Conduct](code-of-conduct.md).

## Development setup

Requirements are Bun 1.3 or newer, Node.js 22.19 or newer for Pi, Git, and an authenticated Pi provider for agent-backed runs.

```bash
git clone <repo-url>
cd mewa_code
cd mewa-code
bun install
bun run dev
```

## Scope

Read [`product-baseline.md`](product-baseline.md) before changing behavior. [`foundation-inventory.md`](foundation-inventory.md) describes inherited coupling but does not grant product scope.

Keep changes focused. Remove dependencies, protocol methods, documentation, and tests with deleted features. Product and engineering documentation belongs under `docs/`.

## Verification

Run the narrowest relevant check while developing. Add or retain tests for observable product behavior and meaningful failures, not inherited coverage totals.

Use repository-wide type checking or builds when a change crosses package boundaries. Run the focused `mewa-browser` checks when changing its service. Agent-backed tests require explicit intent because they use provider credentials and tokens.

## Submitting changes

1. Create a branch from `main`.
2. Follow [`AGENTS.md`](../AGENTS.md) and the product baseline.
3. Update documentation and focused tests when behavior changes.
4. Open a pull request describing what changed and why.
