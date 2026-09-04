export interface SveltePluginOptions {
  dev?: boolean;
}

export interface BunPlugin {
  name: string;
  setup(build: unknown): void;
}

export declare function sveltePlugin(options?: SveltePluginOptions): BunPlugin;
