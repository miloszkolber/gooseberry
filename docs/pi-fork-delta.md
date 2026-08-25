# Pi package fork delta

Mewa currently consumes the exact, version-aligned `@earendil-works/pi-agent-core`, `pi-ai`, and `pi-coding-agent` family. Returning to the direct upstream namespace is not yet safe because Mewa uses public surfaces carried by this family that are not all available in the corresponding upstream stable release:

- the reusable `ModelRuntime` and complete provider/model projection, including availability and provider authentication adapters;
- runtime-generation preparation and replacement without mutating live sessions;
- explicit built-in tool allow/deny controls used to enforce read-only subagent roles;
- resource-loader overrides and source metadata used by the fixed Web UI runtime;
- Bun OAuth and provider compatibility registration.

Mewa does not patch these packages in this repository. The package family is pinned atomically in the workspace catalog. The scheduled `update-pi-family.yml` workflow finds the newest common stable version, updates all three pins and the lockfile together, runs the compatibility suite, and opens a pull request. This file must be re-audited whenever the direct upstream package family exposes the required surfaces; once it does, the namespace migration should be atomic and this exception removed.
