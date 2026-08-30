#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
tmp=$(mktemp -d "${TMPDIR:-/tmp}/gooseberry-setup.XXXXXX")
trap 'rm -rf "$tmp"' EXIT HUP INT TERM

mode_of() {
	stat -c %a "$1" 2>/dev/null || stat -f %Lp "$1"
}

make_fixture() {
	root=$1
	mkdir -p "$root/scripts"
	cp "$repo_root/scripts/setup-deployment.sh" "$root/scripts/setup-deployment.sh"
}

write_env() {
	fixture=$1
	data=$2
	goose=${3:-operator-goose-secret-0123456789abcdef0123456789}
	{
		printf 'GOOSEBERRY_DATA_PATH=%s\n' "$data"
		printf 'GOOSEBERRY_GOOSE_SECRET_KEY=%s\n' "$goose"
		printf 'GOOSEBERRY_AUTH_ENABLED=false\n'
		printf 'GOOSEBERRY_BROWSER_AUTH=false\n'
	} > "$fixture/.gooseberry"
}

run_setup() {
	fixture=$1
	HOME="$fixture/home" XDG_CONFIG_HOME="$fixture/non-default-config" "$fixture/scripts/setup-deployment.sh"
}

make_configured_fixture() {
	name=$1
	fixture=$tmp/$name
	make_fixture "$fixture"
	write_env "$fixture" "$fixture/state"
}

# Setup requires an explicit host-specific configuration and takes no project or data arguments.
make_fixture "$tmp/missing-config"
if run_setup "$tmp/missing-config" >"$tmp/missing-config.out" 2>&1; then
	echo "setup unexpectedly accepted a missing .gooseberry" >&2
	exit 1
fi
grep -F 'create a regular .gooseberry' "$tmp/missing-config.out" >/dev/null
if HOME="$tmp/missing-config/home" "$tmp/missing-config/scripts/setup-deployment.sh" extra >"$tmp/arguments.out" 2>&1; then
	echo "setup unexpectedly accepted an argument" >&2
	exit 1
fi

# The flat layout is created from .gooseberry. Browser authentication is optional and disabled by default.
make_fixture "$tmp/ok"
write_env "$tmp/ok" "$tmp/ok-state"
before=$(sha256sum "$tmp/ok/.gooseberry")
run_setup "$tmp/ok" >/dev/null
after=$(sha256sum "$tmp/ok/.gooseberry")
[ "$before" = "$after" ]
[ "$(mode_of "$tmp/ok/.gooseberry")" = 600 ]
[ -d "$tmp/ok-state/app" ]
[ -d "$tmp/ok-state/browser/artifacts" ]
[ -d "$tmp/ok-state/browser/state" ]
[ ! -e "$tmp/ok-state/gooseberry" ]
[ "$(mode_of "$tmp/ok/home/.config/goose")" = 700 ]
[ "$(mode_of "$tmp/ok/home/.config/goose/gooseberry.env")" = 600 ]
[ ! -e "$tmp/ok/non-default-config/goose/gooseberry.env" ]
grep -Fx 'GOOSEBERRY_BROWSER_AUTH=false' "$tmp/ok/home/.config/goose/gooseberry.env" >/dev/null
grep -Fx 'GOOSEBERRY_BROWSER_TOKEN=' "$tmp/ok/home/.config/goose/gooseberry.env" >/dev/null
printf 'UNRELATED_ENTRY=preserved\n' >> "$tmp/ok/home/.config/goose/gooseberry.env"
run_setup "$tmp/ok" >/dev/null
grep -Fx 'UNRELATED_ENTRY=preserved' "$tmp/ok/home/.config/goose/gooseberry.env" >/dev/null

# Browser credentials are only required and synchronized when browser authentication is enabled.
make_fixture "$tmp/browser-auth"
write_env "$tmp/browser-auth" "$tmp/browser-auth-state"
cat >> "$tmp/browser-auth/.gooseberry" <<'EOF'
GOOSEBERRY_AUTH_ENABLED=true
GOOSEBERRY_TOKEN=operator-controller-token-0123456789abcdef012345
GOOSEBERRY_BROWSER_AUTH=true
GOOSEBERRY_BROWSER_TOKEN=operator-browser-token-0123456789abcdef0123456789
EOF
if run_setup "$tmp/browser-auth" >"$tmp/browser-auth.out" 2>&1; then
	echo "setup unexpectedly accepted duplicate authentication entries" >&2
	exit 1
fi
grep -F 'at most one GOOSEBERRY_AUTH_ENABLED' "$tmp/browser-auth.out" >/dev/null
sed '/^GOOSEBERRY_AUTH_ENABLED=false$/d; /^GOOSEBERRY_BROWSER_AUTH=false$/d' \
	"$tmp/browser-auth/.gooseberry" > "$tmp/browser-auth/.gooseberry.next"
mv "$tmp/browser-auth/.gooseberry.next" "$tmp/browser-auth/.gooseberry"
run_setup "$tmp/browser-auth" >/dev/null
grep -Fx 'GOOSEBERRY_BROWSER_AUTH=true' "$tmp/browser-auth/home/.config/goose/gooseberry.env" >/dev/null
grep -Fx 'GOOSEBERRY_BROWSER_TOKEN=operator-browser-token-0123456789abcdef0123456789' "$tmp/browser-auth/home/.config/goose/gooseberry.env" >/dev/null

# Managed Goose entries must be unambiguous so unrelated entries survive safely.
printf 'GOOSEBERRY_BROWSER_AUTH=false\n' >> "$tmp/browser-auth/home/.config/goose/gooseberry.env"
if run_setup "$tmp/browser-auth" >"$tmp/duplicate-goose-env.out" 2>&1; then
	echo "setup unexpectedly accepted duplicate Goose service environment entries" >&2
	exit 1
fi
grep -F 'duplicate GOOSEBERRY_BROWSER_AUTH' "$tmp/duplicate-goose-env.out" >/dev/null

# Runtime settings and project allowlists do not belong in .gooseberry.
make_configured_fixture unsupported-key
printf 'GOOSEBERRY_PORT=7312\n' >> "$tmp/unsupported-key/.gooseberry"
if run_setup "$tmp/unsupported-key" >"$tmp/unsupported-key.out" 2>&1; then
	echo "setup unexpectedly accepted a runtime setting" >&2
	exit 1
fi
grep -F 'unsupported key: GOOSEBERRY_PORT' "$tmp/unsupported-key.out" >/dev/null

# Remote controller exposure requires authentication or an explicit unsafe acknowledgement.
make_configured_fixture remote-without-protection
printf 'GOOSEBERRY_CONTROLLER_HOST=0.0.0.0\n' >> "$tmp/remote-without-protection/.gooseberry"
if run_setup "$tmp/remote-without-protection" >"$tmp/remote-without-protection.out" 2>&1; then
	echo "setup unexpectedly accepted an unprotected remote controller" >&2
	exit 1
fi
grep -F 'remote controller binding requires authentication' "$tmp/remote-without-protection.out" >/dev/null
printf 'GOOSEBERRY_ALLOW_UNAUTHENTICATED_REMOTE=true\n' >> "$tmp/remote-without-protection/.gooseberry"
run_setup "$tmp/remote-without-protection" >/dev/null

# Existing historical layouts are refused rather than overwritten.
make_configured_fixture legacy-nested-layout
mkdir -p "$tmp/legacy-nested-layout/state/gooseberry/app"
if run_setup "$tmp/legacy-nested-layout" >"$tmp/legacy-nested-layout.out" 2>&1; then
	echo "setup unexpectedly accepted nested deployment state" >&2
	exit 1
fi
grep -F 'flat layout' "$tmp/legacy-nested-layout.out" >/dev/null
make_configured_fixture legacy-pixie-layout
mkdir -p "$tmp/legacy-pixie-layout/state/pixie/app"
if run_setup "$tmp/legacy-pixie-layout" >"$tmp/legacy-pixie-layout.out" 2>&1; then
	echo "setup unexpectedly accepted legacy runtime state" >&2
	exit 1
fi
grep -F 'flat layout' "$tmp/legacy-pixie-layout.out" >/dev/null

# Compose uses one container, fixed numeric ownership and both flat state mounts.
grep -Fx 'ExecStart=/usr/local/bin/goose serve --host 127.0.0.1 --port 3284 --enable-scheduler' "$repo_root/goose/systemd/goose.service" >/dev/null
grep -F '${GOOSEBERRY_DATA_PATH:?set GOOSEBERRY_DATA_PATH in .gooseberry}/app:/var/lib/gooseberry' "$repo_root/docker-compose.yaml" >/dev/null
grep -F '${GOOSEBERRY_DATA_PATH:?set GOOSEBERRY_DATA_PATH in .gooseberry}/browser:/var/lib/gooseberry-browser' "$repo_root/docker-compose.yaml" >/dev/null
if grep -Eq '\.config/goose|^    gooseberry-browser:' "$repo_root/docker-compose.yaml"; then
	echo "compose exposes Goose configuration or retains a separate browser container" >&2
	exit 1
fi
if grep -Eq 'GOOSEBERRY_(UID|GID|PROJECT_PATH|MOUNT_ROOTS|AUTH_MAX_AGE_DAYS|GOOSE_URL|BROWSER_URL)' "$repo_root/docker-compose.yaml"; then
	echo "compose retains deprecated deployment configuration" >&2
	exit 1
fi
if grep -F 'GOOSEBERRY_PORT' "$repo_root/docker-compose.yaml" >/dev/null; then
	echo "compose retains the removed controller port setting" >&2
	exit 1
fi

echo "setup-deployment tests: OK"
