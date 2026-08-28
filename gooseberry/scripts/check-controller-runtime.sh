#!/usr/bin/env bash
set -euo pipefail

root=${1:?controller runtime root is required}

if [[ ! -d "$root" ]]; then
	echo "controller runtime root is not a directory: $root" >&2
	exit 1
fi

for path in "gooseberry.js" "web"; do
	if [[ ! -e "$root/$path" ]]; then
		echo "controller runtime is missing $path" >&2
		exit 1
	fi
done

# Goose is host-native. The controller only carries its bundled application,
# static UI, and production dependencies, never legacy or extension runtimes.
for path in \
	"extensions" \
	"node_modules/@earendil-works"; do
	if [[ -e "$root/$path" ]]; then
		echo "unrelated controller runtime content is present at $path" >&2
		exit 1
	fi
done

is_legal_file() {
	local base=${1##*/}
	shopt -s nocasematch
	[[ "$base" =~ ^(license|notice)([._-].*)?$ ]]
}

is_non_runtime_file() {
	local base=${1##*/}
	local lower
	lower=$(printf '%s' "$base" | tr '[:upper:]' '[:lower:]')
	case "$lower" in
		readme*|changelog*|history*|contributing*|security*|code_of_conduct*|*.md|*.markdown|*.rst|*.adoc|*.map|*.d.ts|*.ts|*.tsx|*.mts|*.cts|*.test.*|*.spec.*|*.log|.npmrc|.yarnrc*|.pnp.*|.yarn-integrity|.package-lock.json|package-lock.json|npm-shrinkwrap.json|yarn.lock|pnpm-lock.yaml|bun.lockb)
			return 0
			;;
	esac
	return 1
}

runtime_error=0
while IFS= read -r -d '' path; do
	if is_legal_file "$path"; then continue; fi
	if is_non_runtime_file "$path"; then
		echo "non-runtime controller content is present at ${path#"$root/"}" >&2
		runtime_error=1
	fi
done < <(find "$root" -type f -print0)

while IFS= read -r -d '' path; do
	case "${path##*/}" in
		test|tests|__tests__|fixture|fixtures|__fixtures__|example|examples|doc|docs|documentation|benchmark|benchmarks|coverage|.cache|cache|__pycache__|.pytest_cache)
			has_non_legal_file=0
			while IFS= read -r -d '' nested; do
				if ! is_legal_file "$nested"; then
					has_non_legal_file=1
					break
				fi
			done < <(find "$path" -type f -print0)
			if ((has_non_legal_file)); then
				echo "non-runtime controller directory is present at ${path#"$root/"}" >&2
				runtime_error=1
			fi
			;;
	esac
done < <(find "$root" -type d -print0)

if ((runtime_error)); then exit 1; fi
