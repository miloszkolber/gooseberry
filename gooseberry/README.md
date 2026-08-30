# Application workspace

One Go module builds the application and browser service. The React frontend uses TypeScript, Zustand and Vite; Bun handles frontend builds and tests.

Run the [development checks](../docs/development.md) with the pinned Go and Bun versions. `bun run build` writes both executables to `dist/` and frontend assets to `webui/dist/`.

See [architecture](../docs/architecture.md) for source layout and state ownership, or [deployment](../docs/deployment.md) to run the services.
