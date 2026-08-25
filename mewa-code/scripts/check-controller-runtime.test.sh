#!/usr/bin/env bash
set -euo pipefail

script=${BASH_SOURCE[0]}
root=$(cd "$(dirname "$script")/.." && pwd)
checker="$root/scripts/check-controller-runtime.sh"
fixture=$(mktemp -d "${TMPDIR:-/tmp}/mewa-controller-runtime-test.XXXXXX")
trap 'rm -rf "$fixture"' EXIT

mkdir -p "$fixture/extensions" "$fixture/node_modules/runtime" "$fixture/node_modules/legal/docs"
touch "$fixture/extensions/mewa-browser.js" "$fixture/extensions/mewa-web-access.js"
printf '%s\n' '{"runtime":true}' > "$fixture/node_modules/runtime/package.json"
printf '%s\n' 'export default 1;' > "$fixture/node_modules/runtime/index.js"
printf '%s\n' 'license text' > "$fixture/node_modules/legal/docs/LICENSE.txt"
printf '%s\n' 'notice text' > "$fixture/node_modules/legal/docs/NOTICE.md"
printf 'wasm' > "$fixture/node_modules/runtime/module.wasm"
printf 'native' > "$fixture/node_modules/runtime/module.node"

bash "$checker" "$fixture"

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

echo "check-controller-runtime: positive and negative fixtures passed"
