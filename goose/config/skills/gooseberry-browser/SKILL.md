---
name: gooseberry-browser
description: Lazy guidance for focused Gooseberry browser checks.
---
# Gooseberry browser

Use this skill only when browser verification is requested. POST JSON to `http://127.0.0.1:8787/v1/browser` with `{ "command": "...", "session": "...", "args": ["..."] }`. When `GOOSEBERRY_BROWSER_AUTH=true`, include `Authorization: Bearer ${GOOSEBERRY_BROWSER_TOKEN}`. Otherwise make the unauthenticated loopback request.

Use only focused commands: `open`, `click`, `type`, `press`, `wait`, `snapshot`, and `screenshot`. Keep sessions isolated and interactions bounded to visual QA. Screenshot responses provide an artifact URL. Report that URL rather than inventing an image.

The Goose service environment needs `GOOSEBERRY_BROWSER_AUTH=false` by default. When it is `true`, it must also define a strong `GOOSEBERRY_BROWSER_TOKEN`. Do not claim MCP or unsupported commands.
