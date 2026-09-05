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
export GOOSEBERRY_AUTH_ENABLED=false GOOSEBERRY_CONTROLLER_HOST=127.0.0.1
export GOOSEBERRY_ALLOW_UNAUTHENTICATED_REMOTE=false GOOSEBERRY_PUBLIC_ORIGIN=
export GOOSEBERRY_MCP_TOKEN=ci-mcp-token-0123456789abcdef0123456789
export GOOSEBERRY_MCP_URL=http://127.0.0.1:8787 GOOSEBERRY_MCP_PUBLIC_ORIGIN=
export GOOSEBERRY_MCP_AUTH=true GOOSEBERRY_MCP_HOST=127.0.0.1 GOOSEBERRY_MCP_PORT=8787

compose --env-file /dev/null -f "$repo_root/docker-compose.yaml" config --format json > "$fixture/compose.json"
# Compose versions omit different boolean defaults; compare against the same parser's explicit false.
jq '.services[].volumes[].bind.create_host_path = false' "$fixture/compose.json" |
	compose --env-file /dev/null -f - config --format json > "$fixture/safe-binds.json"
jq -e --arg root "$repo_root" --arg data "$GOOSEBERRY_DATA_PATH" --slurpfile safe "$fixture/safe-binds.json" '
  (.services | keys) == ["gooseberry", "mcp"] and
  all(.services | to_entries[]; .key as $service | .value |
    .user == "1000:1000" and .read_only == true and .network_mode == "host" and
    .cap_drop == ["ALL"] and .security_opt == ["no-new-privileges:true"] and
    (.mem_limit | tonumber) > 0 and (.cpus | tonumber) > 0 and .pids_limit > 0 and
    .build.context == $root and .build.dockerfile == "gooseberry/Dockerfile" and
    .logging.driver == "local" and .logging.options."max-size" == "10m" and
    .logging.options."max-file" == "3" and
    (has("env_file") | not) and
    (.volumes | length) == 1 and
    .volumes[0].type == "bind" and (.volumes[0].bind | type) == "object" and
    .volumes[0].bind.create_host_path == $safe[0].services[$service].volumes[0].bind.create_host_path
  ) and
  .services.gooseberry.build.target == "gooseberry" and
  .services.mcp.build.target == "mcp" and
  .services.mcp.container_name == "gooseberry-mcp" and
  .services.mcp.image == "ghcr.io/miloszkolber/gooseberry-mcp:latest" and
  (.services.browser == null) and
  (.services.gooseberry.mem_limit | tonumber) == 1073741824 and
  (.services.gooseberry.cpus | tonumber) == 2 and
  .services.gooseberry.pids_limit == 256 and
  (.services.mcp.mem_limit | tonumber) == 2147483648 and
  (.services.mcp.cpus | tonumber) == 2 and
  .services.mcp.pids_limit == 512 and
  .services.gooseberry.volumes[0].source == ($data + "/app") and
  .services.gooseberry.volumes[0].target == "/var/lib/gooseberry" and
  .services.mcp.volumes[0].source == ($data + "/browser") and
  .services.mcp.volumes[0].target == "/var/lib/gooseberry-browser" and
  .services.gooseberry.environment.GOOSEBERRY_GOOSE_SECRET_KEY == env.GOOSEBERRY_GOOSE_SECRET_KEY and
  .services.gooseberry.environment.GOOSEBERRY_MCP_URL == env.GOOSEBERRY_MCP_URL and
  .services.gooseberry.environment.GOOSEBERRY_MCP_TOKEN == env.GOOSEBERRY_MCP_TOKEN and
  .services.gooseberry.environment.GOOSEBERRY_MCP_PUBLIC_ORIGIN == env.GOOSEBERRY_MCP_PUBLIC_ORIGIN and
  (.services.gooseberry.environment.GOOSEBERRY_BROWSER_TOKEN == null) and
  (.services.gooseberry.environment.GOOSEBERRY_BROWSER_AUTH == null) and
  (.services.mcp.environment | keys) == [
    "GOOSEBERRY_MCP_AUTH", "GOOSEBERRY_MCP_DISABLED_MODULES", "GOOSEBERRY_MCP_HOST",
    "GOOSEBERRY_MCP_MODULES", "GOOSEBERRY_MCP_PORT", "GOOSEBERRY_MCP_PUBLIC_ORIGIN",
    "GOOSEBERRY_MCP_TOKEN"
  ] and
  .services.mcp.environment.GOOSEBERRY_MCP_AUTH == "true" and
  .services.mcp.environment.GOOSEBERRY_MCP_TOKEN == env.GOOSEBERRY_MCP_TOKEN and
  any(.services.mcp.tmpfs[]; startswith("/dev/shm:size=256m"))
' "$fixture/compose.json" > /dev/null || {
	echo "Compose service isolation checks failed" >&2
	exit 1
}
test ! -e "$GOOSEBERRY_DATA_PATH"

if GOOSEBERRY_MCP_TOKEN= compose --env-file /dev/null -f "$repo_root/docker-compose.yaml" config --quiet > "$fixture/missing-token.log" 2>&1; then
	echo "Compose accepted a missing MCP credential" >&2
	exit 1
fi
echo "Compose service isolation checks passed"
