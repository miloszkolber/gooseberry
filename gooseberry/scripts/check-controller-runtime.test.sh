#!/usr/bin/env bash
set -euo pipefail

script=${BASH_SOURCE[0]}
root=$(cd "$(dirname "$script")/.." && pwd)
checker="$root/scripts/check-controller-runtime.sh"
fixture=$(mktemp -d "${TMPDIR:-/tmp}/gooseberry-controller-runtime-test.XXXXXX")
trap 'rm -rf "$fixture"' EXIT

mkdir -p "$fixture/web" "$fixture/node_modules/runtime" "$fixture/node_modules/legal/docs"
printf '%s\n' '{"runtime":true}' > "$fixture/node_modules/runtime/package.json"
printf '%s\n' 'export default 1;' > "$fixture/node_modules/runtime/index.js"
printf '%s\n' 'export default 1;' > "$fixture/gooseberry.js"
printf '%s\n' 'license text' > "$fixture/node_modules/legal/docs/LICENSE.txt"
printf '%s\n' 'notice text' > "$fixture/node_modules/legal/docs/NOTICE.md"
printf 'wasm' > "$fixture/node_modules/runtime/module.wasm"
printf 'native' > "$fixture/node_modules/runtime/module.node"

bash "$checker" "$fixture"

rm -rf "$fixture/web"
if bash "$checker" "$fixture" >/dev/null 2>&1; then
	echo "runtime checker accepted a runtime without static UI" >&2
	exit 1
fi
mkdir "$fixture/web"

mkdir -p "$fixture/node_modules/@earendil-works/agent-core"
if bash "$checker" "$fixture" >/dev/null 2>&1; then
	echo "runtime checker accepted legacy dependencies" >&2
	exit 1
fi
rm -rf "$fixture/node_modules/@earendil-works"

mkdir -p "$fixture/extensions"
if bash "$checker" "$fixture" >/dev/null 2>&1; then
	echo "runtime checker accepted extension runtime files" >&2
	exit 1
fi
rm -rf "$fixture/extensions"

for path in \
	"node_modules/runtime/README.md" \
	"node_modules/runtime/CHANGELOG.md" \
	"node_modules/runtime/source.ts" \
	"node_modules/runtime/types.d.ts" \
	"node_modules/runtime/source.js.map" \
	"node_modules/runtime/package-lock.json" \
	"node_modules/runtime/spec.test.js" \
	"node_modules/runtime/docs/example.js" \
	"node_modules/runtime/fixtures/fixture.json"; do
	rm -rf "$fixture/node_modules/runtime/docs" "$fixture/node_modules/runtime/fixtures"
	mkdir -p "$(dirname "$fixture/$path")"
	printf '%s\n' 'non-runtime fixture' > "$fixture/$path"
	if bash "$checker" "$fixture" >/dev/null 2>&1; then
		echo "runtime checker accepted $path" >&2
		exit 1
	fi
	rm -f "$fixture/$path"
done

empty_source="$fixture/empty-source"
empty_runtime="$fixture/empty-runtime"
mkdir -p "$empty_source/@gooseberry/controller"
sh "$root/scripts/prune-runtime-dependencies.sh" "$empty_source" "$empty_runtime"
if [ ! -d "$empty_runtime/node_modules" ]; then
	echo "runtime pruning removed the empty node_modules root required by the Docker copy" >&2
	exit 1
fi

echo "check-controller-runtime: positive and negative fixtures passed"
