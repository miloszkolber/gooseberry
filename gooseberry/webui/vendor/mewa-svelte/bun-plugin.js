import { compile } from "svelte/compiler";

/**
 * Compile client-side `.svelte` files through Bun without Vite or SvelteKit.
 */
export function sveltePlugin({ dev = false } = {}) {
  return {
    name: "mewa-svelte",
    setup(build) {
      build.onLoad({ filter: /\.svelte$/ }, async ({ path }) => {
        const source = await Bun.file(path).text();
        const compiled = compile(source, {
          css: "injected",
          dev,
          filename: path,
          generate: "client"
        });

        return {
          contents: compiled.js.code,
          loader: "js"
        };
      });
    }
  };
}
