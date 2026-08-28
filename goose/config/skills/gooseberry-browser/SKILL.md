---
name: gooseberry-browser
description: Lazy guidance for focused Gooseberry browser checks.
---
# Gooseberry browser

Use this skill only when browser verification is requested. POST JSON to `${GOOSEBERRY_BROWSER_URL:-http://127.0.0.1:8787}/v1/browser` with bearer `${GOOSEBERRY_BROWSER_TOKEN}` and `{ "command": "...", "session": "...", "args": ["..."] }`.

Use only focused commands: `open`, `click`, `type`, `press`, `wait`, `snapshot`, and `screenshot`. Keep sessions isolated and interactions bounded to visual QA. Screenshot responses provide an artifact URL. Report that URL rather than inventing an image.

The Goose service environment must define `GOOSEBERRY_BROWSER_URL` and `GOOSEBERRY_BROWSER_TOKEN` alongside `GOOSE_SERVER__SECRET_KEY` in its EnvironmentFile. Do not claim MCP or unsupported commands.
