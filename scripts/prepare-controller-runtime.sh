#!/usr/bin/env bash
set -euo pipefail

source_root=${1:?pi-subagents package root is required}
runtime_root=${2:?runtime destination is required}

mkdir -p "$runtime_root"
cp -a "$source_root/index.ts" "$runtime_root/"
cp -a "$source_root/src" "$runtime_root/"
cp -a "$source_root/async-retention-discovery-worker.mjs" "$runtime_root/"
cp -a "$source_root/inspector-runner.mjs" "$runtime_root/"

# These are read at runtime by the extension. Do not copy the package's
# README, changelog, installer, or test tree into the controller image.
mkdir -p "$runtime_root/agents" "$runtime_root/docs" "$runtime_root/prompts" "$runtime_root/skills"
for file in \
	delegate.md \
	oracle.md \
	researcher.md \
	reviewer.md \
	scout.md \
	worker.md; do
	cp -a "$source_root/agents/$file" "$runtime_root/agents/"
done
for file in \
	agents.md \
	configuration.md \
	extension-api.md \
	missions.md \
	models.md \
	observability.md \
	tool-reference.md \
	watchdog.md \
	workflows.md; do
	cp -a "$source_root/docs/$file" "$runtime_root/docs/"
done
for file in \
	council.md \
	gather-context-and-clarify.md \
	parallel-cleanup.md \
	parallel-research.md \
	parallel-review.md \
	review-loop.md; do
	cp -a "$source_root/prompts/$file" "$runtime_root/prompts/"
done
cp -a "$source_root/skills/council-mode" "$runtime_root/skills/"
cp -a "$source_root/skills/pi-subagents" "$runtime_root/skills/"

# preflight reads only the package identity. Keep package metadata minimal.
printf '%s\n' '{"name":"pi-subagents","version":"0.56.0","type":"module"}' > "$runtime_root/package.json"
