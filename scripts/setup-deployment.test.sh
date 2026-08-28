#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
tmp=$(mktemp -d "${TMPDIR:-/tmp}/gooseberry-setup.XXXXXX")
trap 'rm -rf "$tmp"' EXIT HUP INT TERM

make_fixture() {
	root=$1
	mkdir -p "$root/scripts"
	cp "$repo_root/scripts/setup-deployment.sh" "$root/scripts/setup-deployment.sh"
}

write_env() {
	fixture=$1
	project=$2
	data=$3
	controller=${4:-operator-controller-token-0123456789abcdef012345}
	goose=${5:-operator-goose-secret-0123456789abcdef0123456789}
	browser=${6:-operator-browser-token-0123456789abcdef0123456789}
	{
		printf 'GOOSEBERRY_PROJECT_PATH=%s\n' "$project"
		printf 'GOOSEBERRY_MOUNT_ROOTS=%s\n' "$project"
		printf 'GOOSEBERRY_DATA_PATH=%s\n' "$data"
		printf 'GOOSEBERRY_UID=%s\n' "$(id -u)"
		printf 'GOOSEBERRY_GID=%s\n' "$(id -g)"
		printf 'GOOSEBERRY_AUTH_ENABLED=true\n'
		printf 'GOOSEBERRY_TOKEN=%s\n' "$controller"
		printf 'GOOSEBERRY_BROWSER_TOKEN=%s\n' "$browser"
		printf 'GOOSEBERRY_GOOSE_URL=ws://127.0.0.1:3284/acp\n'
		printf 'GOOSEBERRY_GOOSE_SECRET_KEY=%s\n' "$goose"
	} > "$fixture/.gooseberry"
}

expect_failure() {
	name=$1
	project=$2
	data=$3
	make_fixture "$tmp/$name"
	if HOME="$tmp/$name/home" XDG_CONFIG_HOME="$tmp/$name/non-default-config" "$tmp/$name/scripts/setup-deployment.sh" "$project" "$data" >"$tmp/$name.out" 2>&1; then
		echo "setup unexpectedly accepted $name" >&2
		exit 1
	fi
}

run_setup() {
	fixture=$1
	shift
	HOME="$fixture/home" XDG_CONFIG_HOME="$fixture/non-default-config" "$fixture/scripts/setup-deployment.sh" "$@"
}

# A first run creates configuration and a browser token but refuses to create state until an operator
# supplies both controller credentials.
make_fixture "$tmp/first"
if run_setup "$tmp/first" "$repo_root" "$tmp/first-state" >"$tmp/first.out" 2>&1; then
	echo "setup unexpectedly accepted missing controller and Goose credentials" >&2
	exit 1
fi
grep -Fx 'GOOSEBERRY_AUTH_ENABLED=true' "$tmp/first/.gooseberry" >/dev/null
grep -Fx 'GOOSEBERRY_GOOSE_URL=ws://127.0.0.1:3284/acp' "$tmp/first/.gooseberry" >/dev/null
[ "$(grep -c '^GOOSEBERRY_UID=' "$tmp/first/.gooseberry")" -eq 1 ]
[ "$(grep -c '^GOOSEBERRY_GID=' "$tmp/first/.gooseberry")" -eq 1 ]
[ "$(grep -c '^GOOSEBERRY_BROWSER_TOKEN=' "$tmp/first/.gooseberry")" -eq 1 ]
[ ! -d "$tmp/first-state" ]

# Gooseberry refuses to read, migrate, or overwrite the legacy Pixie environment file.
make_fixture "$tmp/legacy-env"
printf 'PIXIE_TOKEN=legacy-controller-token-0123456789abcdef0123456789\n' > "$tmp/legacy-env/.pixie"
if run_setup "$tmp/legacy-env" "$repo_root" "$tmp/legacy-env-state" >"$tmp/legacy-env.out" 2>&1; then
	echo "setup unexpectedly accepted legacy Pixie configuration" >&2
	exit 1
fi
grep -q 'Legacy Pixie deployment configuration' "$tmp/legacy-env.out"

controller_token=operator-controller-token-0123456789abcdef012345
goose_secret=operator-goose-secret-0123456789abcdef0123456789
printf 'GOOSEBERRY_TOKEN=%s\nGOOSEBERRY_GOOSE_SECRET_KEY=%s\n' "$controller_token" "$goose_secret" >> "$tmp/first/.gooseberry"
if run_setup "$tmp/first" "$repo_root" "$tmp/first-state" >"$tmp/duplicate.out" 2>&1; then
	echo "setup unexpectedly accepted duplicate Goose configuration" >&2
	exit 1
fi
grep -q 'exactly one GOOSEBERRY_GOOSE_SECRET_KEY' "$tmp/duplicate.out"

# A valid user-managed .gooseberry is preserved byte-for-byte on repeat, except for its mode.
make_fixture "$tmp/ok"
write_env "$tmp/ok" "$repo_root" "$tmp/ok-state"
printf 'GOOSEBERRY_PUBLIC_ORIGIN=https://gooseberry.example.test\n' >> "$tmp/ok/.gooseberry"
before=$(sha256sum "$tmp/ok/.gooseberry")
run_setup "$tmp/ok" "$repo_root" "$tmp/ok-state" >/dev/null
after=$(sha256sum "$tmp/ok/.gooseberry")
[ "$before" = "$after" ]
[ "$(stat -c %a "$tmp/ok/.gooseberry")" = 600 ]
[ -d "$tmp/ok-state/gooseberry/app" ]
[ -d "$tmp/ok-state/gooseberry/browser/artifacts" ]
[ ! -e "$tmp/ok-state/gooseberry/pi" ]
[ "$(stat -c %a "$tmp/ok/home/.config/goose")" = 700 ]
[ "$(stat -c %a "$tmp/ok/home/.config/goose/gooseberry.env")" = 600 ]
[ ! -e "$tmp/ok/non-default-config/goose/gooseberry.env" ]
grep -Fx 'GOOSE_SERVER__SECRET_KEY=operator-goose-secret-0123456789abcdef0123456789' "$tmp/ok/home/.config/goose/gooseberry.env" >/dev/null
grep -Fx 'GOOSEBERRY_BROWSER_URL=http://127.0.0.1:8787' "$tmp/ok/home/.config/goose/gooseberry.env" >/dev/null
grep -Fx 'GOOSEBERRY_BROWSER_TOKEN=operator-browser-token-0123456789abcdef0123456789' "$tmp/ok/home/.config/goose/gooseberry.env" >/dev/null
[ "$(stat -c %u "$tmp/ok-state/gooseberry/app")" = "$(id -u)" ]
[ "$(stat -c %u "$tmp/ok-state/gooseberry/browser")" = "$(id -u)" ]
printf 'UNRELATED_ENTRY=preserved\n' >> "$tmp/ok/home/.config/goose/gooseberry.env"
before=$(sha256sum "$tmp/ok/.gooseberry")
run_setup "$tmp/ok" "$repo_root" "$tmp/ok-state" >/dev/null
after=$(sha256sum "$tmp/ok/.gooseberry")
[ "$before" = "$after" ]
grep -Fx 'UNRELATED_ENTRY=preserved' "$tmp/ok/home/.config/goose/gooseberry.env" >/dev/null

# Setup replaces copied identity values with the technical user's current UID/GID.
make_fixture "$tmp/stale-identity"
write_env "$tmp/stale-identity" "$repo_root" "$tmp/stale-identity-state"
sed -i 's/^GOOSEBERRY_UID=.*/GOOSEBERRY_UID=99999/; s/^GOOSEBERRY_GID=.*/GOOSEBERRY_GID=99999/' "$tmp/stale-identity/.gooseberry"
run_setup "$tmp/stale-identity" "$repo_root" "$tmp/stale-identity-state" >/dev/null
grep -Fx "GOOSEBERRY_UID=$(id -u)" "$tmp/stale-identity/.gooseberry" >/dev/null
grep -Fx "GOOSEBERRY_GID=$(id -g)" "$tmp/stale-identity/.gooseberry" >/dev/null

# Rotation updates only the service-facing credentials and preserves unrelated entries.
new_goose=rotated-goose-secret-0123456789abcdef0123456789
new_browser=rotated-browser-token-0123456789abcdef0123456789
sed -i "s/^GOOSEBERRY_GOOSE_SECRET_KEY=.*/GOOSEBERRY_GOOSE_SECRET_KEY=$new_goose/; s/^GOOSEBERRY_BROWSER_TOKEN=.*/GOOSEBERRY_BROWSER_TOKEN=$new_browser/" "$tmp/ok/.gooseberry"
run_setup "$tmp/ok" "$repo_root" "$tmp/ok-state" >/dev/null
grep -Fx "GOOSE_SERVER__SECRET_KEY=$new_goose" "$tmp/ok/home/.config/goose/gooseberry.env" >/dev/null
grep -Fx "GOOSEBERRY_BROWSER_TOKEN=$new_browser" "$tmp/ok/home/.config/goose/gooseberry.env" >/dev/null
grep -Fx 'UNRELATED_ENTRY=preserved' "$tmp/ok/home/.config/goose/gooseberry.env" >/dev/null

# Ambiguous required entries are refused without replacing the existing service environment.
printf 'GOOSEBERRY_BROWSER_TOKEN=duplicate-entry-0123456789abcdef0123456789\n' >> "$tmp/ok/home/.config/goose/gooseberry.env"
if run_setup "$tmp/ok" "$repo_root" "$tmp/ok-state" >"$tmp/duplicate-env.out" 2>&1; then
	echo "setup unexpectedly accepted duplicate Goose service environment entries" >&2
	exit 1
fi
grep -q 'duplicate GOOSEBERRY_BROWSER_TOKEN' "$tmp/duplicate-env.out"

# Disabled UI authentication does not remove the required Goose credential.
make_fixture "$tmp/auth-disabled"
write_env "$tmp/auth-disabled" "$repo_root" "$tmp/disabled-state"
sed -i 's/^GOOSEBERRY_AUTH_ENABLED=true$/GOOSEBERRY_AUTH_ENABLED=false/' "$tmp/auth-disabled/.gooseberry"
sed -i '/^GOOSEBERRY_TOKEN=/d' "$tmp/auth-disabled/.gooseberry"
run_setup "$tmp/auth-disabled" "$repo_root" "$tmp/disabled-state" >/dev/null

# Tokens are independently scoped. The browser token may not reuse the controller token.
make_fixture "$tmp/shared-token"
write_env "$tmp/shared-token" "$repo_root" "$tmp/shared-token-state" "$controller_token" "$goose_secret" "$controller_token"
if run_setup "$tmp/shared-token" "$repo_root" "$tmp/shared-token-state" >"$tmp/shared-token.out" 2>&1; then
	echo "setup unexpectedly accepted shared controller and browser tokens" >&2
	exit 1
fi
grep -q 'must be distinct' "$tmp/shared-token.out"

expect_failure root "$repo_root" /
expect_failure dotdot "$repo_root" "$tmp/parent/../state"
mkdir "$tmp/real"
ln -s "$tmp/real" "$tmp/state-link"
expect_failure symlink "$repo_root" "$tmp/state-link"

# Data and admitted mounts must stay disjoint now that no protected-state guard is configured.
mkdir -p "$tmp/project-with-data/data"
make_fixture "$tmp/nested-data"
write_env "$tmp/nested-data" "$tmp/project-with-data" "$tmp/project-with-data/data"
if run_setup "$tmp/nested-data" "$tmp/project-with-data" "$tmp/project-with-data/data" >"$tmp/nested-data.out" 2>&1; then
	echo "setup unexpectedly accepted data below a project mount" >&2
	exit 1
fi
grep -q 'must be disjoint' "$tmp/nested-data.out"

# Legacy Pixie runtime state is a breaking layout and is never migrated or deleted.
make_fixture "$tmp/legacy-pixie-layout"
write_env "$tmp/legacy-pixie-layout" "$repo_root" "$tmp/legacy-pixie-layout-state"
mkdir -p "$tmp/legacy-pixie-layout-state/pixie/app"
if run_setup "$tmp/legacy-pixie-layout" "$repo_root" "$tmp/legacy-pixie-layout-state" >"$tmp/legacy-pixie-layout.out" 2>&1; then
	echo "setup unexpectedly accepted legacy runtime state" >&2
	exit 1
fi
grep -q 'Legacy Pixie runtime state' "$tmp/legacy-pixie-layout.out"
[ -d "$tmp/legacy-pixie-layout-state/pixie/app" ]

# Generated IDs remove the image's former fixed-1000 assumption, and project mounts stay read-only.
grep -F 'user: "${GOOSEBERRY_UID:?run ./scripts/setup-deployment.sh to set GOOSEBERRY_UID}:${GOOSEBERRY_GID:?run ./scripts/setup-deployment.sh to set GOOSEBERRY_GID}"' "$repo_root/compose.yaml" >/dev/null
grep -F '${GOOSEBERRY_PROJECT_PATH:?set an absolute host project path}:${GOOSEBERRY_PROJECT_PATH:?set an absolute host project path}:ro' "$repo_root/compose.yaml" >/dev/null
if grep -Eq 'uid=1000|gid=1000' "$repo_root/compose.yaml"; then
	echo "compose retains a fixed UID/GID assumption" >&2
	exit 1
fi

echo "setup-deployment tests: OK"
