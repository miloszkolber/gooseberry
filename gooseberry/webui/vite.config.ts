import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [react(), tailwindcss()],
	resolve: {
		alias: {
			"@": fileURLToPath(new URL("./src", import.meta.url)),
		},
	},
	server: {
		port: 24269,
		strictPort: true,
		proxy: {
			"/auth": "http://127.0.0.1:7312",
			"/files": "http://127.0.0.1:7312",
			"/v1/artifacts": "http://127.0.0.1:7312",
			"/ws": {
				target: "ws://127.0.0.1:7312",
				ws: true,
			},
		},
	},
	build: {
		outDir: "dist",
		manifest: true,
	},
});
