#!/usr/bin/env bash
set -euo pipefail

root=${1:?controller runtime root is required}

for path in \
	"extensions/mewa-web-access.js" \
	"extensions/pi-subagents/index.ts" \
	"extensions/pi-subagents/src" \
	"extensions/pi-subagents/agents" \
	"extensions/pi-subagents/prompts" \
	"extensions/pi-subagents/package.json"; do
	if [[ ! -e "$root/$path" ]]; then
		echo "controller runtime is missing $path" >&2
		exit 1
	fi
done

# The curated extensions are bundled/copied above. Their published package
# roots, tests, and documentation must not be present in node_modules.
for path in \
	"node_modules/pi-web-access" \
	"node_modules/pi-subagents" \
	"extensions/pi-subagents/README.md" \
	"extensions/pi-subagents/CHANGELOG.md" \
	"extensions/pi-subagents/LICENSE" \
	"extensions/pi-subagents/test"; do
	if [[ -e "$root/$path" ]]; then
		echo "unrelated controller runtime content is present at $path" >&2
		exit 1
	fi
done
