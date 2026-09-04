# mewa-svelte 0.1.1

This optional GitHub release package connects dependency-aware mewa_ui behaviors to the Svelte 5 lifecycle.

Use `mewa(behavior)` with Svelte's `{@attach ...}` syntax. Import the behavior from the matching `mewa-ui/components/*.js` entry so Mewa behavior dependencies stay composed.

```svelte
<script>
  import { mewa } from "./vendor/mewa-svelte/index.js";
  import { behavior as toggleBehavior } from "./vendor/mewa-ui/components/toggle.js";
</script>

<button class="toggle" type="button" aria-pressed="false" {@attach mewa(toggleBehavior)}>
  Pin result
</button>
```

The runtime attachment does not import Svelte or mewa-ui. Svelte remains a peer dependency so the application owns its framework version.

For a client-side application compiled by Bun, import `sveltePlugin` from `bun-plugin.js` and pass it to `Bun.build()`. The plugin compiles `.svelte` files with `svelte/compiler`; it does not require Vite or SvelteKit.

Read `manifest.json` for the compatibility contract. Use `checksums.json` to verify every packaged file.
