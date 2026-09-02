#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
fixture=$(mktemp -d "${TMPDIR:-/tmp}/gooseberry-compose.XXXXXX")
trap 'rm -rf "$fixture"' EXIT HUP INT TERM

compose() {
	if [ -n "${COMPOSE_BIN:-}" ]; then "$COMPOSE_BIN" "$@"; else docker compose "$@"; fi
}

export GOOSEBERRY_DATA_PATH="$fixture/data"
export GOOSEBERRY_GOOSE_SECRET_KEY=ci-goose-secret-0123456789abcdef0123456789
export GOOSEBERRY_TOKEN=ci-controller-token-0123456789abcdef0123456789
export GOOSEBERRY_BROWSER_TOKEN=ci-browser-token-0123456789abcdef0123456789
export GOOSEBERRY_AUTH_ENABLED=false GOOSEBERRY_CONTROLLER_HOST=127.0.0.1
export GOOSEBERRY_ALLOW_UNAUTHENTICATED_REMOTE=false GOOSEBERRY_PUBLIC_ORIGIN=
export GOOSEBERRY_BROWSER_HOST=127.0.0.1 GOOSEBERRY_BROWSER_PORT=8787
export GOOSEBERRY_BROWSER_URL=http://127.0.0.1:8787 GOOSEBERRY_BROWSER_PUBLIC_ORIGIN=

compose --env-file /dev/null -f "$repo_root/docker-compose.yaml" config --format json > "$fixture/compose.json"
# Compose versions omit different boolean defaults; compare against the same parser's explicit false.
jq '.services[].volumes[].bind.create_host_path = false' "$fixture/compose.json" |
	compose --env-file /dev/null -f - config --format json > "$fixture/safe-binds.json"
jq -e --arg root "$repo_root" --arg data "$GOOSEBERRY_DATA_PATH" --slurpfile safe "$fixture/safe-binds.json" '
  (.services | keys) == ["browser", "gooseberry"] and
  all(.services | to_entries[]; .key as $service | .value |
    .user == "1000:1000" and .read_only == true and .network_mode == "host" and
    .build.context == $root and .build.dockerfile == "gooseberry/Dockerfile" and
    .logging.driver == "local" and .logging.options."max-size" == "10m" and
    .logging.options."max-file" == "3" and
    (has("env_file") | not) and
    (.volumes | length) == 1 and
    .volumes[0].type == "bind" and (.volumes[0].bind | type) == "object" and
    .volumes[0].bind.create_host_path == $safe[0].services[$service].volumes[0].bind.create_host_path
  ) and
  .services.gooseberry.build.target == "gooseberry" and
  .services.browser.build.target == "browser" and
  .services.gooseberry.volumes[0].source == ($data + "/app") and
  .services.gooseberry.volumes[0].target == "/var/lib/gooseberry" and
  .services.browser.volumes[0].source == ($data + "/browser") and
  .services.browser.volumes[0].target == "/var/lib/gooseberry-browser" and
  .services.gooseberry.environment.GOOSEBERRY_GOOSE_SECRET_KEY == env.GOOSEBERRY_GOOSE_SECRET_KEY and
  .services.gooseberry.environment.GOOSEBERRY_BROWSER_TOKEN == env.GOOSEBERRY_BROWSER_TOKEN and
  .services.gooseberry.environment.GOOSEBERRY_BROWSER_AUTH == "true" and
  (.services.browser.environment | keys) == [
    "GOOSEBERRY_BROWSER_AUTH", "GOOSEBERRY_BROWSER_HOST", "GOOSEBERRY_BROWSER_PORT",
    "GOOSEBERRY_BROWSER_PUBLIC_ORIGIN", "GOOSEBERRY_BROWSER_TOKEN"
  ] and
  .services.browser.environment.GOOSEBERRY_BROWSER_AUTH == "true" and
  .services.browser.environment.GOOSEBERRY_BROWSER_TOKEN == env.GOOSEBERRY_BROWSER_TOKEN
' "$fixture/compose.json" > /dev/null || {
	echo "Compose service isolation checks failed" >&2
	exit 1
}
test ! -e "$GOOSEBERRY_DATA_PATH"

if GOOSEBERRY_BROWSER_TOKEN= compose --env-file /dev/null -f "$repo_root/docker-compose.yaml" config --quiet > "$fixture/missing-token.log" 2>&1; then
	echo "Compose accepted a missing browser credential" >&2
	exit 1
fi
echo "Compose service isolation checks passed"
